//! File system primitives for src/platforms/tauri/tauri-machine.ts. Errors carry
//! Node's error codes so resource access handles them like on Node.

use serde::Serialize;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Debug, Serialize)]
pub struct Failure {
    code: &'static str,
    message: String,
}

impl Failure {
    pub fn invalid(message: &str) -> Self {
        Failure { code: "EINVAL", message: message.into() }
    }
}

impl From<io::Error> for Failure {
    fn from(error: io::Error) -> Self {
        use io::ErrorKind::*;
        let code = match error.kind() {
            NotFound => "ENOENT",
            AlreadyExists => "EEXIST",
            PermissionDenied => "EPERM",
            DirectoryNotEmpty => "ENOTEMPTY",
            NotADirectory => "ENOTDIR",
            IsADirectory => "EISDIR",
            ResourceBusy => "EBUSY",
            _ => "EIO",
        };
        Failure { code, message: error.to_string() }
    }
}

/// A request header, percent-decoded.
pub fn header(request: &Request<'_>, name: &str) -> Result<String, Failure> {
    let value = request.headers().get(name).ok_or_else(|| Failure::invalid(name))?;
    let value = value.to_str().map_err(|_| Failure::invalid(name))?;
    Ok(percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned())
}

pub fn body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], Failure> {
    match request.body() {
        InvokeBody::Raw(data) => Ok(data),
        _ => Err(Failure::invalid("Expected binary data.")),
    }
}

#[derive(Serialize)]
pub struct Stat {
    kind: &'static str,
    size: u64,
}

#[tauri::command]
pub async fn fs_stat(path: PathBuf, follow: bool) -> Result<Stat, Failure> {
    let meta = if follow { fs::metadata(&path) } else { fs::symlink_metadata(&path) }?;
    let kind = meta.file_type();
    let kind = if kind.is_symlink() {
        "symlink"
    } else if kind.is_dir() {
        "dir"
    } else if kind.is_file() {
        "file"
    } else {
        "other"
    };
    Ok(Stat { kind, size: meta.len() })
}

#[tauri::command]
pub async fn fs_read(path: PathBuf) -> Result<Response, Failure> {
    Ok(Response::new(fs::read(path)?))
}

#[tauri::command]
pub async fn fs_write(request: Request<'_>) -> Result<(), Failure> {
    let path = header(&request, "path")?;
    let mut options = fs::OpenOptions::new();
    options.write(true);
    if header(&request, "exclusive")? == "1" {
        options.create_new(true);
    } else {
        options.create(true).truncate(true);
    }
    options.open(path)?.write_all(body(&request)?)?;
    Ok(())
}

#[tauri::command]
pub async fn fs_mkdir(path: PathBuf, recursive: bool) -> Result<(), Failure> {
    Ok(if recursive { fs::create_dir_all(path) } else { fs::create_dir(path) }?)
}

#[tauri::command]
pub async fn fs_readdir(path: PathBuf) -> Result<Vec<String>, Failure> {
    fs::read_dir(path)?
        .map(|entry| Ok(entry?.file_name().to_string_lossy().into_owned()))
        .collect()
}

#[tauri::command]
pub async fn fs_rename(from: PathBuf, to: PathBuf) -> Result<(), Failure> {
    Ok(fs::rename(from, to)?)
}

#[tauri::command]
pub async fn fs_remove(path: PathBuf, dir: bool) -> Result<(), Failure> {
    Ok(if dir { fs::remove_dir(path) } else { fs::remove_file(path) }?)
}
