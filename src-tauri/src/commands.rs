use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    FileNotFound,
    PermissionDenied,
    Conflict,
    InvalidEncoding,
    Io,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl AppError {
    fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentResult {
    pub path: String,
    pub content: String,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub mtime_ms: u64,
    pub saved_at_ms: u64,
}

fn map_io_error(error: &std::io::Error) -> AppError {
    match error.kind() {
        ErrorKind::NotFound => AppError::new(AppErrorCode::FileNotFound, error.to_string()),
        ErrorKind::PermissionDenied => {
            AppError::new(AppErrorCode::PermissionDenied, error.to_string())
        }
        _ => AppError::new(AppErrorCode::Io, error.to_string()),
    }
}

fn modified_ms(path: &Path) -> Result<u64, AppError> {
    let modified = fs::metadata(path)
        .map_err(|error| map_io_error(&error))?
        .modified()
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))?;

    system_time_to_ms(modified)
}

fn system_time_to_ms(system_time: SystemTime) -> Result<u64, AppError> {
    let duration = system_time
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))?;

    Ok(duration.as_millis() as u64)
}

fn now_ms() -> Result<u64, AppError> {
    system_time_to_ms(SystemTime::now())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(AppErrorCode::Io, "Missing parent directory"))?;

    fs::create_dir_all(parent).map_err(|error| map_io_error(&error))?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.md");
    let temp_name = format!(".{}.{}.tmp", file_name, std::process::id());
    let temp_path = parent.join(temp_name);

    {
        let mut temp_file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| map_io_error(&error))?;

        temp_file
            .write_all(content.as_bytes())
            .map_err(|error| map_io_error(&error))?;
        temp_file.sync_all().map_err(|error| map_io_error(&error))?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        map_io_error(&error)
    })?;

    Ok(())
}

fn recovery_draft_path() -> Result<PathBuf, AppError> {
    let home_path = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| AppError::new(AppErrorCode::Io, "Could not resolve HOME directory"))?;

    Ok(home_path
        .join("Library")
        .join("Application Support")
        .join("Md Editor")
        .join("recovery-draft.md"))
}

fn load_recovery_draft_from_path(path: &Path) -> Result<Option<String>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(path).map_err(|error| map_io_error(&error))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::new(AppErrorCode::InvalidEncoding, "Draft must be UTF-8"))?;

    if content.is_empty() {
        return Ok(None);
    }

    Ok(Some(content))
}

fn store_recovery_draft_at_path(path: &Path, content: &str) -> Result<(), AppError> {
    if content.trim().is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|error| map_io_error(&error))?;
        }
        return Ok(());
    }

    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(AppErrorCode::Io, "Invalid recovery draft location"))?;

    fs::create_dir_all(parent).map_err(|error| map_io_error(&error))?;
    atomic_write(path, content)
}

#[tauri::command]
pub fn open_document(path: String) -> Result<OpenDocumentResult, AppError> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Document does not exist",
        ));
    }

    let bytes = fs::read(&file_path).map_err(|error| map_io_error(&error))?;
    let content = String::from_utf8(bytes)
        .map_err(|_| AppError::new(AppErrorCode::InvalidEncoding, "File must be UTF-8"))?;
    let mtime_ms = modified_ms(&file_path)?;

    Ok(OpenDocumentResult {
        path: file_path.to_string_lossy().to_string(),
        content,
        mtime_ms,
    })
}

#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_mtime_ms: Option<u64>,
) -> Result<SaveResult, AppError> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Cannot save because file no longer exists",
        ));
    }

    if let Some(expected) = expected_mtime_ms {
        let current = modified_ms(&file_path)?;
        if current != expected {
            return Err(AppError::new(
                AppErrorCode::Conflict,
                "File changed on disk. Reopen or Save As to avoid overwriting.",
            ));
        }
    }

    atomic_write(&file_path, &content)?;
    let mtime_ms = modified_ms(&file_path)?;

    Ok(SaveResult {
        path: file_path.to_string_lossy().to_string(),
        mtime_ms,
        saved_at_ms: now_ms()?,
    })
}

#[tauri::command]
pub fn save_as_document(path: String, content: String) -> Result<SaveResult, AppError> {
    let file_path = PathBuf::from(path);
    atomic_write(&file_path, &content)?;

    Ok(SaveResult {
        path: file_path.to_string_lossy().to_string(),
        mtime_ms: modified_ms(&file_path)?,
        saved_at_ms: now_ms()?,
    })
}

#[tauri::command]
pub fn load_recovery_draft() -> Result<Option<String>, AppError> {
    let path = recovery_draft_path()?;
    load_recovery_draft_from_path(&path)
}

#[tauri::command]
pub fn store_recovery_draft(content: String) -> Result<(), AppError> {
    let path = recovery_draft_path()?;
    store_recovery_draft_at_path(&path, &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn opens_saved_document_roundtrip() {
        let temp_dir = tempdir().expect("temp dir");
        let file_path = temp_dir.path().join("roundtrip.md");
        let path = file_path.to_string_lossy().to_string();

        let save_result = save_as_document(path.clone(), "# Hello\n\nWorld".to_string())
            .expect("save should succeed");
        let open_result = open_document(path).expect("open should succeed");

        assert_eq!(open_result.content, "# Hello\n\nWorld");
        assert_eq!(save_result.path, open_result.path);
    }

    #[test]
    fn rejects_conflicting_save() {
        let temp_dir = tempdir().expect("temp dir");
        let file_path = temp_dir.path().join("conflict.md");
        let path = file_path.to_string_lossy().to_string();

        let first = save_as_document(path.clone(), "one".to_string()).expect("first save");
        sleep(Duration::from_millis(4));
        save_as_document(path.clone(), "two".to_string()).expect("second save");

        let error = save_document(path, "three".to_string(), Some(first.mtime_ms))
            .expect_err("should detect conflict");

        assert_eq!(error.code, AppErrorCode::Conflict);
    }

    #[test]
    fn recovery_draft_roundtrip() {
        let temp_dir = tempdir().expect("temp dir");
        let draft_path = temp_dir.path().join("draft.md");

        store_recovery_draft_at_path(&draft_path, "Recovered").expect("store draft");
        let loaded = load_recovery_draft_from_path(&draft_path).expect("load draft");

        assert_eq!(loaded, Some("Recovered".to_string()));

        store_recovery_draft_at_path(&draft_path, "").expect("clear draft");
        let cleared = load_recovery_draft_from_path(&draft_path).expect("load cleared");
        assert_eq!(cleared, None);
    }
}
