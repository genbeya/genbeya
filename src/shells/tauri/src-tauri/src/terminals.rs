//! Pseudo-terminals for src/platforms/tauri/tauri-machine.ts: the shells of
//! the integrated terminal, with their output streamed to the webview.

use crate::files::Failure;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

const DATA: u8 = 0;
const EXIT: u8 = 2;

// A shell runs whatever is typed into it; that is what a terminal is for, and
// on this runtime the page could already run git with any arguments. So the
// limit is on what a terminal may start: only the shells Genbeya opens
// (src/access/hosts/terminal-commands.ts), i.e. the user's own shell, and wsl
// or ssh for repositories on other machines, with the terminal environment of
// terminal-session.ts. A script injected into the page cannot start other
// programs this way, or change how a shell starts through its environment.
const ENVIRONMENT: &[&str] = &["TERM", "COLORTERM"];

/// The programs a terminal may start: the shells `default_shell` can choose,
/// plus wsl and ssh.
fn shells(windows: bool, comspec: Option<&str>, shell: Option<&str>) -> Vec<String> {
    let (fixed, user): (&[&str], _) = if windows {
        (&["pwsh.exe", "powershell.exe", "wsl", "wsl.exe", "ssh"], comspec)
    } else {
        (&["ssh", "/bin/sh"], shell)
    };
    fixed.iter().map(|program| program.to_string()).chain(user.filter(|program| !program.is_empty()).map(String::from)).collect()
}

/// The user's shell, as the Machine port describes it (and as node-machine.ts picks it).
fn default_shell(windows: bool, comspec: Option<&str>, shell: Option<&str>, found: impl Fn(&str) -> bool) -> String {
    if !windows {
        return shell.filter(|program| !program.is_empty()).unwrap_or("/bin/sh").to_string();
    }
    ["pwsh.exe", "powershell.exe"]
        .into_iter()
        .find(|program| found(program))
        .or(comspec)
        .unwrap_or("powershell.exe")
        .to_string()
}

fn variable(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// A path that exists, or a program on PATH. Windows programs without an
/// extension are found as .exe, like portable-pty starts them.
fn found(program: &str) -> bool {
    let path = Path::new(program);
    if path.components().count() > 1 {
        return path.exists();
    }
    let name = if cfg!(windows) && path.extension().is_none() { format!("{program}.exe") } else { program.to_string() };
    // symlink_metadata also sees Windows app execution aliases (WindowsApps\pwsh.exe).
    std::env::var_os("PATH")
        .is_some_and(|folders| std::env::split_paths(&folders).any(|folder| folder.join(&name).symlink_metadata().is_ok()))
}

fn check(program: &str, env: &HashMap<String, String>) -> Result<(), Failure> {
    let allowed = shells(cfg!(windows), variable("COMSPEC").as_deref(), variable("SHELL").as_deref());
    if !allowed.iter().any(|shell| shell == program) {
        return Err(Failure::invalid(&format!("Genbeya does not open terminals with {program}.")));
    }
    match env.keys().find(|key| !ENVIRONMENT.contains(&key.as_str())) {
        Some(key) => Err(Failure::invalid(&format!("Genbeya does not set {key}."))),
        None => Ok(()),
    }
}

fn failure(error: impl std::fmt::Display) -> Failure {
    Failure::invalid(&error.to_string())
}

fn size(cols: u16, rows: u16) -> Result<PtySize, Failure> {
    if cols == 0 || rows == 0 {
        return Err(Failure::invalid("Invalid terminal size."));
    }
    Ok(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
}

struct Open {
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// Locked on its own, so a write blocked on a busy shell holds up nothing else.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Open>>>,
}

impl Terminals {
    /// Ends every terminal, so no shell outlives the app.
    pub fn kill_all(&self) {
        let Ok(open) = self.open.lock() else { return };
        for terminal in open.values() {
            if let Ok(mut killer) = terminal.killer.try_lock() {
                let _ = killer.kill();
            }
        }
    }

    fn get(&self, id: u32) -> Result<Arc<Open>, Failure> {
        self.open.lock().unwrap().get(&id).cloned().ok_or_else(|| Failure::invalid("The terminal has ended."))
    }
}

/// A program running on a new pseudo-terminal, with its output and exit.
struct Started {
    open: Open,
    output: Box<dyn Read + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

fn start(program: &str, args: &[String], cwd: Option<&str>, size: PtySize, env: &HashMap<String, String>) -> Result<Started, Failure> {
    if let Some(cwd) = cwd.filter(|cwd| !Path::new(cwd).is_dir()) {
        return Err(Failure::invalid(&format!("{cwd} does not exist.")));
    }
    if !found(program) {
        return Err(Failure::invalid(&format!("{program} was not found. Install it and add it to PATH.")));
    }
    let pair = native_pty_system().openpty(size).map_err(failure)?;
    let mut command = CommandBuilder::new(program);
    command.args(args);
    if let Some(cwd) = cwd {
        command.cwd(cwd);
    }
    for (key, value) in env {
        command.env(key, value);
    }
    let child = pair.slave.spawn_command(command).map_err(failure)?;
    // Only the child may hold the terminal's other end, or its output never ends.
    drop(pair.slave);
    let output = pair.master.try_clone_reader().map_err(failure)?;
    let writer = pair.master.take_writer().map_err(failure)?;
    let killer = child.clone_killer();
    let open = Open { master: Mutex::new(pair.master), writer: Arc::new(Mutex::new(writer)), killer: Mutex::new(killer) };
    Ok(Started { open, output, child })
}

#[tauri::command]
pub fn term_shell() -> String {
    default_shell(cfg!(windows), variable("COMSPEC").as_deref(), variable("SHELL").as_deref(), found)
}

#[allow(clippy::too_many_arguments)] // The fields of one call from the webview.
#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: State<'_, Terminals>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env: HashMap<String, String>,
    events: Channel<InvokeResponseBody>,
) -> Result<u32, Failure> {
    check(&command, &env)?;
    let Started { open, mut output, mut child } = start(&command, &args, cwd.as_deref(), size(cols, rows)?, &env)?;
    let mut killer = child.clone_killer();
    let id = state.next.fetch_add(1, Ordering::SeqCst);
    state.open.lock().unwrap().insert(id, Arc::new(open));
    let (exited, exit_code) = mpsc::channel();
    thread::spawn(move || {
        let code = child.wait().map(|status| status.exit_code() as i32).unwrap_or(-1);
        // Closing the terminal ends its output; Windows keeps it open until then.
        app.state::<Terminals>().open.lock().unwrap().remove(&id);
        let _ = exited.send(code);
    });
    thread::spawn(move || {
        let mut buffer = vec![0u8; 64 * 1024];
        while let Ok(n) = output.read(&mut buffer[1..]) {
            if n == 0 {
                break;
            }
            buffer[0] = DATA;
            if events.send(InvokeResponseBody::Raw(buffer[..=n].to_vec())).is_err() {
                // Nobody reads this terminal any more, and a shell whose output is not read blocks.
                let _ = killer.kill();
                break;
            }
        }
        // The exit follows the last output.
        let mut message = vec![EXIT];
        message.extend(exit_code.recv().unwrap_or(-1).to_le_bytes());
        let _ = events.send(InvokeResponseBody::Raw(message));
    });
    Ok(id)
}

#[tauri::command]
pub async fn term_write(state: State<'_, Terminals>, id: u32, data: String) -> Result<(), Failure> {
    let writer = state.get(id)?.writer.clone();
    // A busy shell blocks writes until it reads, so write off the async workers.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), Failure> {
        let mut writer = writer.lock().unwrap();
        writer.write_all(data.as_bytes())?;
        Ok(writer.flush()?)
    })
    .await
    .map_err(failure)?
}

#[tauri::command]
pub async fn term_resize(state: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), Failure> {
    let size = size(cols, rows)?;
    let terminal = state.get(id)?;
    let master = terminal.master.lock().unwrap();
    master.resize(size).map_err(failure)
}

#[tauri::command]
pub async fn term_kill(state: State<'_, Terminals>, id: u32) -> Result<(), Failure> {
    if let Ok(terminal) = state.get(id) {
        let _ = terminal.killer.lock().unwrap().kill();
    }
    Ok(())
}

/// Ends every terminal. A reloaded page has forgotten the ids of the ones it
/// opened, so it calls this before it opens any (tauri-machine.ts).
#[tauri::command]
pub fn term_kill_all(state: State<'_, Terminals>) {
    state.kill_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_the_shells_of_the_terminal_commands() {
        let windows = shells(true, Some("C:\\Windows\\system32\\cmd.exe"), Some("/bin/zsh"));
        for program in ["pwsh.exe", "powershell.exe", "wsl", "wsl.exe", "ssh", "C:\\Windows\\system32\\cmd.exe"] {
            assert!(windows.contains(&program.to_string()), "{program}");
        }
        for program in ["cmd.exe", "/bin/zsh", "git", "bash.exe"] {
            assert!(!windows.contains(&program.to_string()), "{program}");
        }
        let unix = shells(false, Some("cmd.exe"), Some("/bin/zsh"));
        assert_eq!(unix, ["ssh", "/bin/sh", "/bin/zsh"]);
        assert_eq!(shells(false, None, Some("")), ["ssh", "/bin/sh"]);
    }

    #[test]
    fn sets_only_the_terminal_environment() {
        assert!(check("ssh", &HashMap::from([("TERM".into(), "xterm-256color".into())])).is_ok());
        assert!(check("ssh", &HashMap::from([("LD_PRELOAD".into(), "x".into())])).is_err());
        assert!(check("git", &HashMap::new()).is_err());
    }

    #[test]
    fn picks_the_users_shell() {
        let on = |programs: &'static [&str]| move |program: &str| programs.contains(&program);
        assert_eq!(default_shell(true, Some("cmd.exe"), None, on(&["pwsh.exe", "powershell.exe"])), "pwsh.exe");
        assert_eq!(default_shell(true, Some("cmd.exe"), None, on(&["powershell.exe"])), "powershell.exe");
        assert_eq!(default_shell(true, Some("cmd.exe"), None, on(&[])), "cmd.exe");
        assert_eq!(default_shell(false, None, Some("/bin/zsh"), on(&[])), "/bin/zsh");
        assert_eq!(default_shell(false, None, None, on(&[])), "/bin/sh");
    }

    #[test]
    fn runs_a_program_on_a_terminal_until_it_exits() {
        let (program, args) = if cfg!(windows) {
            ("cmd.exe", ["/c", "echo genbeya-terminal & exit 3"])
        } else {
            ("sh", ["-c", "echo genbeya-terminal; exit 3"])
        };
        let size = size(80, 24).unwrap();
        let Started { open, mut output, mut child } = start(program, &args.map(String::from), None, size, &HashMap::new()).unwrap();
        // Output is read while the terminal closes, as term_open does: Windows waits for it to be drained.
        let writer = open.writer.clone();
        let reader = thread::spawn(move || {
            let (mut bytes, mut buffer) = (Vec::new(), [0u8; 4096]);
            while let Ok(n @ 1..) = output.read(&mut buffer) {
                bytes.extend(&buffer[..n]);
                // ConPTY asks where the cursor is before it starts the program; xterm.js answers in the app.
                if buffer[..n].windows(4).any(|window| window == b"\x1b[6n") {
                    let _ = writer.lock().unwrap().write_all(b"\x1b[1;1R");
                }
            }
            String::from_utf8_lossy(&bytes).into_owned()
        });
        let code = child.wait().unwrap().exit_code();
        drop(open);
        let text = reader.join().unwrap();
        assert_eq!(code, 3);
        assert!(text.contains("genbeya-terminal"), "{text}");
    }

    #[test]
    fn ends_every_terminal() {
        // A shell that waits for input until it is ended.
        let program = if cfg!(windows) { "cmd.exe" } else { "sh" };
        let size = size(80, 24).unwrap();
        let Started { open, mut output, mut child } = start(program, &[], None, size, &HashMap::new()).unwrap();
        thread::spawn(move || while let Ok(1..) = output.read(&mut [0u8; 4096]) {});
        let terminals = Terminals::default();
        terminals.open.lock().unwrap().insert(0, Arc::new(open));
        terminals.kill_all();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while child.try_wait().unwrap().is_none() {
            assert!(std::time::Instant::now() < deadline, "the shell still runs");
            thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    #[test]
    fn explains_what_cannot_start() {
        let size = size(80, 24).unwrap();
        let missing = start("genbeya-no-such-program", &[], None, size, &HashMap::new()).err().unwrap();
        assert!(format!("{missing:?}").contains("was not found"));
        let folder = start("ssh", &[], Some("/genbeya/no/such/folder"), size, &HashMap::new()).err().unwrap();
        assert!(format!("{folder:?}").contains("does not exist"));
        assert!(super::size(0, 24).is_err());
    }
}
