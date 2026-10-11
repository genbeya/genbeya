//! Child processes for src/platforms/tauri/tauri-machine.ts: buffered runs
//! (git) and long-lived processes with piped stdio (WSL/SSH shells).

use crate::files::{body, header, Failure};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use wait_timeout::ChildExt;

const STDOUT: u8 = 0;
const STDERR: u8 = 1;
const EXIT: u8 = 2;

// The page shares the webview with repository content (Markdown, diagrams,
// code), so these commands are the security boundary: they start only what
// the backend starts (src/access/hosts) and set only the git environment of
// host.ts. Arguments are not checked, and file paths (files.rs) are not
// scoped yet.
#[cfg(windows)]
const PROGRAMS: &[&str] = &["git", "ssh", "wsl", "wsl.exe"];
#[cfg(not(windows))]
const PROGRAMS: &[&str] = &["git", "ssh"];
// GIT_SEQUENCE_EDITOR is a command, but no more power than the unchecked arguments:
// interactive rebases write their prepared todo list with it (operation-access.ts).
const ENVIRONMENT: &[&str] = &[
    "GIT_TERMINAL_PROMPT",
    "GIT_OPTIONAL_LOCKS",
    "GCM_INTERACTIVE",
    "GIT_EDITOR",
    "GIT_SEQUENCE_EDITOR",
];

/// How long a timed-out run waits for its output after the kill. Grandchildren
/// (git-remote-https, ssh, credential helpers) inherit the pipes and can keep
/// them open long after the child is gone.
const GRACE: Duration = Duration::from_secs(1);

struct Running {
    /// Locked on its own, so a write blocked on a full pipe holds up only this process.
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
pub struct Processes {
    next: AtomicU32,
    running: Mutex<HashMap<u32, Running>>,
}

impl Processes {
    /// Kills every running process, so no WSL or SSH shell outlives the app.
    pub fn kill_all(&self) {
        let Ok(running) = self.running.lock() else { return };
        for process in running.values() {
            // A locked child is being reaped already.
            if let Ok(mut child) = process.child.try_lock() {
                let _ = child.kill();
            }
        }
    }
}

fn check(program: &str, env: &HashMap<String, String>) -> Result<(), Failure> {
    if !PROGRAMS.contains(&program) {
        return Err(Failure::invalid(&format!("GitDesk does not run {program}.")));
    }
    match env.keys().find(|key| !ENVIRONMENT.contains(&key.as_str())) {
        Some(key) => Err(Failure::invalid(&format!("GitDesk does not set {key}."))),
        None => Ok(()),
    }
}

fn command(program: &str, args: &[String]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn start_failure(program: &str, cwd: Option<&str>, error: std::io::Error) -> String {
    match cwd {
        Some(cwd) if !Path::new(cwd).is_dir() => format!("{cwd} does not exist."),
        _ if error.kind() == std::io::ErrorKind::NotFound => {
            format!("{program} was not found. Install it and add it to PATH.")
        }
        _ => error.to_string(),
    }
}

fn read_all(mut source: impl Read + Send + 'static) -> Receiver<Vec<u8>> {
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        let mut data = Vec::new();
        let _ = source.read_to_end(&mut data);
        let _ = send.send(data);
    });
    receive
}

/// `[code: i32][stderr length: u32][stderr][stdout]`
fn frame(code: i32, stdout: &[u8], stderr: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + stdout.len() + stderr.len());
    out.extend(code.to_le_bytes());
    out.extend((stderr.len() as u32).to_le_bytes());
    out.extend(stderr);
    out.extend(stdout);
    out
}

fn run(program: String, args: Vec<String>, cwd: Option<String>, env: HashMap<String, String>, timeout: u64) -> Vec<u8> {
    let mut command = command(&program, &args);
    command.envs(env).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(cwd) = &cwd {
        command.current_dir(cwd);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return frame(127, b"", start_failure(&program, cwd.as_deref(), error).as_bytes()),
    };
    let stdout = read_all(child.stdout.take().unwrap());
    let stderr = read_all(child.stderr.take().unwrap());
    let status = if timeout > 0 {
        child.wait_timeout(Duration::from_millis(timeout)).ok().flatten()
    } else {
        child.wait().ok()
    };
    let timed_out = status.is_none();
    let (stdout, mut stderr) = if timed_out {
        let _ = child.kill();
        let _ = child.wait();
        // Keep what arrives within the grace period; readers still blocked are left behind.
        let deadline = Instant::now() + GRACE;
        let collect = |output: Receiver<Vec<u8>>| {
            output.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap_or_default()
        };
        (collect(stdout), collect(stderr))
    } else {
        (stdout.recv().unwrap_or_default(), stderr.recv().unwrap_or_default())
    };
    if timed_out && stderr.is_empty() {
        stderr = format!("{program} timed out.").into_bytes();
    }
    frame(status.and_then(|s| s.code()).unwrap_or(if timed_out { 124 } else { 1 }), &stdout, &stderr)
}

#[tauri::command]
pub async fn proc_run(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    timeout_ms: u64,
) -> Result<Response, Failure> {
    check(&command, &env)?;
    let reply = tauri::async_runtime::spawn_blocking(move || run(command, args, cwd, env, timeout_ms))
        .await
        .map_err(|e| Failure::invalid(&e.to_string()))?;
    Ok(Response::new(reply))
}

fn pump(mut source: impl Read + Send + 'static, kind: u8, events: Channel<InvokeResponseBody>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = vec![0u8; 64 * 1024];
        while let Ok(n) = source.read(&mut buffer[1..]) {
            if n == 0 {
                break;
            }
            buffer[0] = kind;
            if events.send(InvokeResponseBody::Raw(buffer[..=n].to_vec())).is_err() {
                break;
            }
        }
    })
}

#[tauri::command]
pub async fn proc_spawn(
    app: AppHandle,
    state: State<'_, Processes>,
    command: String,
    args: Vec<String>,
    events: Channel<InvokeResponseBody>,
) -> Result<u32, Failure> {
    check(&command, &HashMap::new())?;
    let mut child = self::command(&command, &args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| Failure::invalid(&start_failure(&command, None, error)))?;
    let id = state.next.fetch_add(1, Ordering::SeqCst);
    let output = pump(child.stdout.take().unwrap(), STDOUT, events.clone());
    let errors = pump(child.stderr.take().unwrap(), STDERR, events.clone());
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let child = Arc::new(Mutex::new(child));
    state.running.lock().unwrap().insert(id, Running { stdin, child: child.clone() });
    thread::spawn(move || {
        // Wait only once both pipes are closed, so kill() never contends for the lock.
        let _ = output.join();
        let _ = errors.join();
        let code = child.lock().unwrap().wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        app.state::<Processes>().running.lock().unwrap().remove(&id);
        let mut message = vec![EXIT];
        message.extend(code.to_le_bytes());
        let _ = events.send(InvokeResponseBody::Raw(message));
    });
    Ok(id)
}

#[tauri::command]
pub async fn proc_write(state: State<'_, Processes>, request: Request<'_>) -> Result<(), Failure> {
    let id: u32 = header(&request, "id")?.parse().map_err(|_| Failure::invalid("id"))?;
    let close = header(&request, "close")? == "1";
    let data = body(&request)?.to_vec();
    let stdin = state.running.lock().unwrap().get(&id).map(|p| p.stdin.clone());
    let stdin = stdin.ok_or_else(|| Failure::invalid("The process has exited."))?;
    // A full pipe blocks until the process reads, so write off the async workers.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), Failure> {
        let mut stdin = stdin.lock().unwrap();
        if let Some(pipe) = stdin.as_mut() {
            pipe.write_all(&data)?;
            pipe.flush()?;
        }
        if close {
            *stdin = None;
        }
        Ok(())
    })
    .await
    .map_err(|e| Failure::invalid(&e.to_string()))?
}

#[tauri::command]
pub async fn proc_kill(state: State<'_, Processes>, id: u32) -> Result<(), Failure> {
    let child = state.running.lock().unwrap().get(&id).map(|p| p.child.clone());
    if let Some(child) = child {
        let _ = child.lock().unwrap().kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(key: &str) -> HashMap<String, String> {
        HashMap::from([(key.to_string(), "0".to_string())])
    }

    #[test]
    fn starts_only_the_programs_and_environment_of_the_backend() {
        assert!(check("git", &env("GIT_TERMINAL_PROMPT")).is_ok());
        assert!(check("git", &env("GIT_EDITOR")).is_ok());
        assert!(check("git", &env("GIT_SEQUENCE_EDITOR")).is_ok());
        assert!(check("ssh", &HashMap::new()).is_ok());
        assert_eq!(check("wsl.exe", &HashMap::new()).is_ok(), cfg!(windows));
        assert!(check("cmd", &HashMap::new()).is_err());
        assert!(check("/usr/bin/git", &HashMap::new()).is_err());
        assert!(check("git", &env("GIT_SSH_COMMAND")).is_err());
    }

    #[test]
    fn a_timeout_returns_while_a_grandchild_holds_the_pipes() {
        // The shell is killed; the command it started keeps stderr open.
        let (shell, script) = if cfg!(windows) {
            ("cmd", ["/c", "ping -n 10 127.0.0.1 >nul & echo done"])
        } else {
            ("sh", ["-c", "sleep 10 >/dev/null; echo done"])
        };
        let started = Instant::now();
        let reply = run(shell.into(), script.map(String::from).to_vec(), None, HashMap::new(), 200);
        assert_eq!(i32::from_le_bytes(reply[..4].try_into().unwrap()), 124);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
