//! Child processes behind desktop/tauri/node/child_process.ts: buffered runs
//! (git) and long-lived processes with piped stdio (WSL/SSH shells).

use crate::files::{body, header, Failure};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use wait_timeout::ChildExt;

const STDOUT: u8 = 0;
const STDERR: u8 = 1;
const EXIT: u8 = 2;

struct Running {
    stdin: Option<ChildStdin>,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
pub struct Processes {
    next: AtomicU32,
    running: Mutex<HashMap<u32, Running>>,
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

fn read_all(mut source: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut data = Vec::new();
        let _ = source.read_to_end(&mut data);
        data
    })
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
    if timed_out {
        let _ = child.kill();
        let _ = child.wait();
    }
    let (stdout, mut stderr) = (stdout.join().unwrap_or_default(), stderr.join().unwrap_or_default());
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
    let mut child = self::command(&command, &args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| Failure::invalid(&start_failure(&command, None, error)))?;
    let id = state.next.fetch_add(1, Ordering::SeqCst);
    let output = pump(child.stdout.take().unwrap(), STDOUT, events.clone());
    let errors = pump(child.stderr.take().unwrap(), STDERR, events.clone());
    let stdin = child.stdin.take();
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
    let data = body(&request)?;
    let mut running = state.running.lock().unwrap();
    let process = running.get_mut(&id).ok_or_else(|| Failure::invalid("The process has exited."))?;
    if let Some(stdin) = process.stdin.as_mut() {
        stdin.write_all(data)?;
        stdin.flush()?;
    }
    if close {
        process.stdin = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn proc_kill(state: State<'_, Processes>, id: u32) -> Result<(), Failure> {
    let child = state.running.lock().unwrap().get(&id).map(|p| p.child.clone());
    if let Some(child) = child {
        let _ = child.lock().unwrap().kill();
    }
    Ok(())
}
