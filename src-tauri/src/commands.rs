use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{ErrorKind, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFileEntry {
    pub path: String,
    pub name: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    pub line: u32,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImageAsset {
    pub path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub id: String,
    pub created_at_ms: u64,
    pub reason: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkValidationIssue {
    pub line: u32,
    pub link: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkValidationReport {
    pub checked_external: bool,
    pub issues: Vec<LinkValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateDto {
    pub workspace_folder: Option<String>,
    pub active_path: Option<String>,
    pub draft_content: Option<String>,
    pub read_mode: bool,
    pub focus_mode: bool,
    pub focus_preview_only: bool,
    pub split_ratio: f64,
    pub reader_palette: String,
    pub ultra_read_enabled: bool,
    pub ultra_read_fixation: f64,
    pub ultra_read_min_word_length: u32,
    pub ultra_read_focus_weight: u32,
    pub cosmic_open: bool,
    pub cosmic_playing: bool,
    pub cosmic_wpm: u32,
    pub cosmic_index: usize,
    pub cosmic_bionic: bool,
    pub cosmic_palette: String,
    pub cosmic_word_size: u32,
    pub cosmic_base_weight: u32,
    pub cosmic_focus_weight: u32,
    pub cosmic_fixation: f64,
    pub cosmic_min_word_length: u32,
    pub active_block_index: usize,
    pub preview_scroll_ratio: Option<f64>,
    pub editor_scroll_ratio: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotRecord {
    id: String,
    created_at_ms: u64,
    reason: String,
    size_bytes: u64,
    file_path: String,
    content_hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct HistoryIndex {
    files: HashMap<String, Vec<SnapshotRecord>>,
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

fn hash_u64(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn atomic_write_bytes(path: &Path, content: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(AppErrorCode::Io, "Missing parent directory"))?;

    fs::create_dir_all(parent).map_err(|error| map_io_error(&error))?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.bin");
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
            .write_all(content)
            .map_err(|error| map_io_error(&error))?;
        temp_file.sync_all().map_err(|error| map_io_error(&error))?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        map_io_error(&error)
    })?;

    Ok(())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), AppError> {
    atomic_write_bytes(path, content.as_bytes())
}

fn read_utf8(path: &Path) -> Result<String, AppError> {
    let bytes = fs::read(path).map_err(|error| map_io_error(&error))?;
    String::from_utf8(bytes)
        .map_err(|_| AppError::new(AppErrorCode::InvalidEncoding, "File must be UTF-8"))
}

fn recovery_draft_path() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join("recovery-draft.md"))
}

fn app_support_dir() -> Result<PathBuf, AppError> {
    let home_path = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| AppError::new(AppErrorCode::Io, "Could not resolve HOME directory"))?;

    Ok(home_path
        .join("Library")
        .join("Application Support")
        .join("Md Editor"))
}

fn app_log_path() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join("md-editor.log"))
}

fn history_dir() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join("history"))
}

fn history_index_path() -> Result<PathBuf, AppError> {
    Ok(history_dir()?.join("index.json"))
}

fn session_state_path() -> Result<PathBuf, AppError> {
    Ok(app_support_dir()?.join("session.json"))
}

fn append_log(action: &str, details: &str) {
    let path = match app_log_path() {
        Ok(path) => path,
        Err(_) => return,
    };
    let parent = match path.parent() {
        Some(parent) => parent,
        None => return,
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }

    let timestamp = match now_ms() {
        Ok(ms) => ms,
        Err(_) => 0,
    };
    let message = format!("[{timestamp}] {action}: {details}\n");

    let mut file = match OpenOptions::new().create(true).append(true).open(path) {
        Ok(file) => file,
        Err(_) => return,
    };
    let _ = file.write_all(message.as_bytes());
}

fn is_markdown_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    extension == "md" || extension == "markdown"
}

fn is_text_openable_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    matches!(extension.as_str(), "md" | "markdown" | "txt")
}

fn is_image_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg")
}

fn should_skip_dir(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    name.starts_with('.') || name == "node_modules" || name == "target"
}

fn collect_markdown_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<MarkdownFileEntry>,
) -> Result<(), AppError> {
    let entries = fs::read_dir(current).map_err(|error| map_io_error(&error))?;
    for entry_result in entries {
        let entry = entry_result.map_err(|error| map_io_error(&error))?;
        let path = entry.path();

        if path.is_dir() {
            if should_skip_dir(&path) {
                continue;
            }
            collect_markdown_files(root, &path, files)?;
            continue;
        }

        if !path.is_file() || !is_markdown_file(&path) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("untitled.md")
            .to_string();

        files.push(MarkdownFileEntry {
            path: path.to_string_lossy().to_string(),
            name,
            relative_path,
        });
    }

    Ok(())
}

fn load_recovery_draft_from_path(path: &Path) -> Result<Option<String>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let content = read_utf8(path)?;

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

fn build_snippet(content: &str, byte_index: usize) -> String {
    let mut char_index = 0usize;
    for (idx, _) in content.char_indices() {
        if idx >= byte_index {
            break;
        }
        char_index += 1;
    }

    let chars: Vec<char> = content.chars().collect();
    let start = char_index.saturating_sub(80);
    let end = (char_index + 120).min(chars.len());
    let snippet: String = chars[start..end].iter().collect();
    snippet
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_stem(name: &str) -> String {
    let mut output = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            output.push(ch);
        } else if ch.is_whitespace() {
            output.push('-');
        }
    }

    let output = output.trim_matches('-').to_string();
    if output.is_empty() {
        "image".to_string()
    } else {
        output
    }
}

fn ext_from_mime(mime_type: &str) -> Option<&'static str> {
    let lower = mime_type.to_ascii_lowercase();
    if lower.contains("png") {
        Some("png")
    } else if lower.contains("jpeg") || lower.contains("jpg") {
        Some("jpg")
    } else if lower.contains("gif") {
        Some("gif")
    } else if lower.contains("webp") {
        Some("webp")
    } else if lower.contains("bmp") {
        Some("bmp")
    } else if lower.contains("svg") {
        Some("svg")
    } else {
        None
    }
}

fn ext_from_path(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

fn next_asset_path(document_path: &Path, preferred_name: &str, extension: &str) -> Result<PathBuf, AppError> {
    let parent = document_path
        .parent()
        .ok_or_else(|| AppError::new(AppErrorCode::Io, "Document path has no parent"))?;

    let assets_dir = parent.join("assets");
    fs::create_dir_all(&assets_dir).map_err(|error| map_io_error(&error))?;

    let now = now_ms()?;
    let stem = sanitize_stem(preferred_name);
    let mut candidate = assets_dir.join(format!("{}-{}.{}", stem, now, extension));
    let mut counter = 1u32;
    while candidate.exists() {
        candidate = assets_dir.join(format!("{}-{}-{}.{}", stem, now, counter, extension));
        counter += 1;
    }

    Ok(candidate)
}

fn save_asset_bytes(
    document_path: &Path,
    preferred_name: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<SavedImageAsset, AppError> {
    let destination = next_asset_path(document_path, preferred_name, extension)?;
    atomic_write_bytes(&destination, bytes)?;

    let parent = document_path
        .parent()
        .ok_or_else(|| AppError::new(AppErrorCode::Io, "Document path has no parent"))?;
    let relative_path = destination
        .strip_prefix(parent)
        .unwrap_or(&destination)
        .to_string_lossy()
        .to_string();

    Ok(SavedImageAsset {
        path: destination.to_string_lossy().to_string(),
        relative_path,
    })
}

fn load_history_index() -> Result<HistoryIndex, AppError> {
    let index_path = history_index_path()?;
    if !index_path.exists() {
        return Ok(HistoryIndex::default());
    }

    let raw = read_utf8(&index_path)?;
    serde_json::from_str::<HistoryIndex>(&raw)
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))
}

fn save_history_index(index: &HistoryIndex) -> Result<(), AppError> {
    let serialized = serde_json::to_string_pretty(index)
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))?;
    let index_path = history_index_path()?;
    atomic_write(&index_path, &serialized)
}

fn snapshot_dir_for_document(path: &str) -> Result<PathBuf, AppError> {
    let key = format!("{:x}", hash_u64(path));
    Ok(history_dir()?.join(key))
}

fn split_link_and_anchor(link: &str) -> (String, Option<String>) {
    if let Some(anchor) = link.strip_prefix('#') {
        return (String::new(), Some(anchor.to_string()));
    }

    if let Some(index) = link.find('#') {
        (
            link[..index].to_string(),
            Some(link[index + 1..].to_string()),
        )
    } else {
        (link.to_string(), None)
    }
}

fn slugify_heading(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if (ch.is_whitespace() || ch == '-' || ch == '_') && !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    slug
}

fn heading_slugs(markdown: &str) -> HashSet<String> {
    let mut slugs = HashSet::new();

    for line in markdown.lines() {
        let trimmed = line.trim_start();
        let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }

        let content = trimmed[hashes..].trim();
        if content.is_empty() {
            continue;
        }

        let slug = slugify_heading(content);
        if !slug.is_empty() {
            slugs.insert(slug);
        }
    }

    slugs
}

fn normalize_link_target(raw: &str) -> String {
    let mut value = raw.trim().to_string();
    if value.starts_with('<') && value.ends_with('>') && value.len() > 2 {
        value = value[1..value.len() - 1].to_string();
    }

    if let Some(index) = value.find(char::is_whitespace) {
        value = value[..index].to_string();
    }

    value
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn extract_markdown_links(markdown: &str) -> Vec<(u32, String)> {
    let markdown_link_regex = Regex::new(r#"!?\[[^\]]*\]\(([^\)]+)\)"#).expect("valid regex");
    let auto_link_regex = Regex::new(r#"<(https?://[^>\s]+)>"#).expect("valid regex");

    let mut links = Vec::new();

    for (index, line) in markdown.lines().enumerate() {
        let line_number = (index + 1) as u32;

        for captures in markdown_link_regex.captures_iter(line) {
            if let Some(target) = captures.get(1) {
                let value = normalize_link_target(target.as_str());
                if !value.is_empty() {
                    links.push((line_number, value));
                }
            }
        }

        for captures in auto_link_regex.captures_iter(line) {
            if let Some(target) = captures.get(1) {
                links.push((line_number, target.as_str().to_string()));
            }
        }
    }

    links
}

fn parse_external_host_port(url: &str) -> Option<(String, u16)> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest
        .split('/')
        .next()
        .unwrap_or(rest)
        .split('?')
        .next()
        .unwrap_or(rest)
        .split('#')
        .next()
        .unwrap_or(rest);

    let authority = authority.rsplit('@').next().unwrap_or(authority);

    let default_port = if scheme.eq_ignore_ascii_case("https") {
        443
    } else {
        80
    };

    if authority.starts_with('[') {
        let end = authority.find(']')?;
        let host = authority[1..end].to_string();
        let port = authority[end + 1..]
            .strip_prefix(':')
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(default_port);
        return Some((host, port));
    }

    if let Some((host, port)) = authority.rsplit_once(':') {
        if let Ok(parsed_port) = port.parse::<u16>() {
            return Some((host.to_string(), parsed_port));
        }
    }

    Some((authority.to_string(), default_port))
}

fn external_url_reachable(url: &str) -> bool {
    let (host, port) = match parse_external_host_port(url) {
        Some(parsed) => parsed,
        None => return false,
    };

    let addrs = match (host.as_str(), port).to_socket_addrs() {
        Ok(iter) => iter.collect::<Vec<_>>(),
        Err(_) => return false,
    };

    for addr in addrs.into_iter().take(3) {
        if TcpStream::connect_timeout(&addr, Duration::from_secs(2)).is_ok() {
            return true;
        }
    }

    false
}

fn is_external_link(link: &str) -> bool {
    link.starts_with("http://") || link.starts_with("https://")
}

fn is_ignored_link(link: &str) -> bool {
    link.starts_with("mailto:") || link.starts_with("tel:") || link.starts_with("javascript:")
}

#[tauri::command]
pub fn open_document(path: String) -> Result<OpenDocumentResult, AppError> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        append_log("open_document_failed", "file not found");
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Document does not exist",
        ));
    }

    let content = read_utf8(&file_path)?;
    let mtime_ms = modified_ms(&file_path)?;
    append_log("open_document", &file_path.to_string_lossy());

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
        append_log("save_document_failed", "file not found");
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Cannot save because file no longer exists",
        ));
    }

    if let Some(expected) = expected_mtime_ms {
        let current = modified_ms(&file_path)?;
        if current != expected {
            append_log("save_document_failed", "mtime conflict");
            return Err(AppError::new(
                AppErrorCode::Conflict,
                "File changed on disk. Reopen or Save As to avoid overwriting.",
            ));
        }
    }

    atomic_write(&file_path, &content)?;
    let mtime_ms = modified_ms(&file_path)?;
    append_log("save_document", &file_path.to_string_lossy());

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
    append_log("save_as_document", &file_path.to_string_lossy());

    Ok(SaveResult {
        path: file_path.to_string_lossy().to_string(),
        mtime_ms: modified_ms(&file_path)?,
        saved_at_ms: now_ms()?,
    })
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<SaveResult, AppError> {
    let file_path = PathBuf::from(path);
    atomic_write(&file_path, &content)?;
    append_log("write_text_file", &file_path.to_string_lossy());

    Ok(SaveResult {
        path: file_path.to_string_lossy().to_string(),
        mtime_ms: modified_ms(&file_path)?,
        saved_at_ms: now_ms()?,
    })
}

#[tauri::command]
pub fn load_recovery_draft() -> Result<Option<String>, AppError> {
    let path = recovery_draft_path()?;
    append_log("load_recovery_draft", &path.to_string_lossy());
    load_recovery_draft_from_path(&path)
}

#[tauri::command]
pub fn store_recovery_draft(content: String) -> Result<(), AppError> {
    let path = recovery_draft_path()?;
    store_recovery_draft_at_path(&path, &content)?;
    append_log(
        "store_recovery_draft",
        if content.trim().is_empty() { "clear" } else { "write" },
    );
    Ok(())
}

#[tauri::command]
pub fn list_markdown_files(directory: String) -> Result<Vec<MarkdownFileEntry>, AppError> {
    let folder_path = PathBuf::from(directory);
    if !folder_path.exists() || !folder_path.is_dir() {
        append_log("list_markdown_files_failed", "directory missing");
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Folder does not exist",
        ));
    }

    let mut files = Vec::new();
    collect_markdown_files(&folder_path, &folder_path, &mut files)?;
    files.sort_by_key(|entry| entry.relative_path.to_lowercase());

    append_log("list_markdown_files", &format!("{} files", files.len()));
    Ok(files)
}

#[tauri::command]
pub fn search_workspace(
    directory: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, AppError> {
    let folder_path = PathBuf::from(directory);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Folder does not exist",
        ));
    }

    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();

    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let max_results = limit.unwrap_or(200).max(1) as usize;

    let mut files = Vec::new();
    collect_markdown_files(&folder_path, &folder_path, &mut files)?;

    let mut hits = Vec::new();
    for entry in files {
        if hits.len() >= max_results {
            break;
        }

        let path = PathBuf::from(&entry.path);
        let content = match read_utf8(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let lower_content = content.to_ascii_lowercase();
        if !tokens.iter().all(|token| lower_content.contains(token)) {
            continue;
        }

        let first_index = lower_content.find(&tokens[0]).unwrap_or(0);
        let line = (lower_content[..first_index]
            .bytes()
            .filter(|byte| *byte == b'\n')
            .count()
            + 1) as u32;

        let snippet = build_snippet(&content, first_index);
        hits.push(SearchHit {
            path: entry.path,
            name: entry.name,
            relative_path: entry.relative_path,
            line,
            snippet,
        });
    }

    append_log("search_workspace", &format!("query={query}; hits={}", hits.len()));
    Ok(hits)
}

#[tauri::command]
pub fn save_image_asset(
    document_path: String,
    file_name: String,
    mime_type: String,
    base64_data: String,
) -> Result<SavedImageAsset, AppError> {
    let document_path = PathBuf::from(document_path);
    if !document_path.exists() || !is_text_openable_file(&document_path) {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Document path does not exist",
        ));
    }

    let clean_base64 = base64_data
        .split(",")
        .last()
        .unwrap_or(base64_data.as_str())
        .trim()
        .to_string();
    let bytes = BASE64_STANDARD
        .decode(clean_base64.as_bytes())
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))?;

    let source_name = if file_name.trim().is_empty() {
        "image".to_string()
    } else {
        file_name
    };

    let extension = ext_from_mime(&mime_type)
        .map(|value| value.to_string())
        .or_else(|| ext_from_path(Path::new(&source_name)))
        .unwrap_or_else(|| "png".to_string());

    let preferred_name = Path::new(&source_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");

    let saved = save_asset_bytes(&document_path, preferred_name, &extension, &bytes)?;
    append_log("save_image_asset", &saved.path);
    Ok(saved)
}

#[tauri::command]
pub fn import_image_asset(document_path: String, source_path: String) -> Result<SavedImageAsset, AppError> {
    let document_path = PathBuf::from(document_path);
    let source_path = PathBuf::from(source_path);

    if !document_path.exists() {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Document path does not exist",
        ));
    }

    if !source_path.exists() || !source_path.is_file() || !is_image_file(&source_path) {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Image source does not exist",
        ));
    }

    let bytes = fs::read(&source_path).map_err(|error| map_io_error(&error))?;
    let extension = ext_from_path(&source_path).unwrap_or_else(|| "png".to_string());
    let preferred_name = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");

    let saved = save_asset_bytes(&document_path, preferred_name, &extension, &bytes)?;
    append_log("import_image_asset", &saved.path);
    Ok(saved)
}

#[tauri::command]
pub fn create_snapshot(path: String, content: String, reason: String) -> Result<SnapshotEntry, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::new(AppErrorCode::Io, "Snapshot path is empty"));
    }

    let now = now_ms()?;
    let mut index = load_history_index()?;
    let records = index.files.entry(path.clone()).or_default();

    let content_hash = hash_u64(&content);
    if let Some(last) = records.last() {
        if last.content_hash == content_hash {
            return Ok(SnapshotEntry {
                id: last.id.clone(),
                created_at_ms: last.created_at_ms,
                reason: last.reason.clone(),
                size_bytes: last.size_bytes,
            });
        }

        if reason == "autosave" && last.reason == "autosave" {
            if now.saturating_sub(last.created_at_ms) < 60_000 {
                return Ok(SnapshotEntry {
                    id: last.id.clone(),
                    created_at_ms: last.created_at_ms,
                    reason: last.reason.clone(),
                    size_bytes: last.size_bytes,
                });
            }
        }
    }

    let snapshot_id = format!("{}-{:x}", now, hash_u64(&format!("{}:{}", path, now)));
    let snapshot_folder = snapshot_dir_for_document(&path)?;
    fs::create_dir_all(&snapshot_folder).map_err(|error| map_io_error(&error))?;

    let snapshot_file = snapshot_folder.join(format!("{}.mdsnap", snapshot_id));
    atomic_write(&snapshot_file, &content)?;

    let size_bytes = content.as_bytes().len() as u64;
    records.push(SnapshotRecord {
        id: snapshot_id.clone(),
        created_at_ms: now,
        reason: reason.clone(),
        size_bytes,
        file_path: snapshot_file.to_string_lossy().to_string(),
        content_hash,
    });

    if records.len() > 50 {
        let overflow = records.len() - 50;
        let to_remove: Vec<SnapshotRecord> = records.drain(0..overflow).collect();
        for stale in to_remove {
            let stale_path = PathBuf::from(stale.file_path);
            let _ = fs::remove_file(stale_path);
        }
    }

    save_history_index(&index)?;
    append_log("create_snapshot", &format!("{} ({})", path, reason));

    Ok(SnapshotEntry {
        id: snapshot_id,
        created_at_ms: now,
        reason,
        size_bytes,
    })
}

#[tauri::command]
pub fn list_snapshots(path: String) -> Result<Vec<SnapshotEntry>, AppError> {
    let index = load_history_index()?;
    let records = index.files.get(&path).cloned().unwrap_or_default();

    let mut entries: Vec<SnapshotEntry> = records
        .into_iter()
        .map(|record| SnapshotEntry {
            id: record.id,
            created_at_ms: record.created_at_ms,
            reason: record.reason,
            size_bytes: record.size_bytes,
        })
        .collect();

    entries.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(entries)
}

#[tauri::command]
pub fn load_snapshot(path: String, snapshot_id: String) -> Result<OpenDocumentResult, AppError> {
    let index = load_history_index()?;
    let records = index.files.get(&path).ok_or_else(|| {
        AppError::new(AppErrorCode::FileNotFound, "No snapshots available for this document")
    })?;

    let record = records
        .iter()
        .find(|record| record.id == snapshot_id)
        .ok_or_else(|| AppError::new(AppErrorCode::FileNotFound, "Snapshot not found"))?;

    let snapshot_path = PathBuf::from(&record.file_path);
    if !snapshot_path.exists() {
        return Err(AppError::new(
            AppErrorCode::FileNotFound,
            "Snapshot file is missing on disk",
        ));
    }

    let content = read_utf8(&snapshot_path)?;
    let mtime_ms = if Path::new(&path).exists() {
        modified_ms(Path::new(&path))?
    } else {
        record.created_at_ms
    };

    Ok(OpenDocumentResult {
        path,
        content,
        mtime_ms,
    })
}

#[tauri::command]
pub fn validate_links(
    document_path: String,
    markdown: String,
    check_external: bool,
) -> Result<LinkValidationReport, AppError> {
    let document_path = PathBuf::from(document_path);
    let document_dir = document_path
        .parent()
        .ok_or_else(|| AppError::new(AppErrorCode::Io, "Document path has no parent"))?
        .to_path_buf();

    let current_anchor_slugs = heading_slugs(&markdown);
    let mut issues = Vec::new();

    for (line, link) in extract_markdown_links(&markdown) {
        if link.trim().is_empty() || is_ignored_link(&link) {
            continue;
        }

        if is_external_link(&link) {
            if check_external && !external_url_reachable(&link) {
                issues.push(LinkValidationIssue {
                    line,
                    link: link.clone(),
                    severity: "warning".to_string(),
                    message: "External URL did not respond to a quick reachability check".to_string(),
                });
            }
            continue;
        }

        let (path_part, anchor_part) = split_link_and_anchor(&link);
        let target_path = if path_part.is_empty() {
            document_path.clone()
        } else {
            document_dir.join(&path_part)
        };

        if !target_path.exists() {
            issues.push(LinkValidationIssue {
                line,
                link: link.clone(),
                severity: "error".to_string(),
                message: "Target file does not exist".to_string(),
            });
            continue;
        }

        if let Some(anchor) = anchor_part {
            if anchor.trim().is_empty() {
                continue;
            }

            let anchor = anchor.to_ascii_lowercase();
            let slug_set = if target_path == document_path {
                current_anchor_slugs.clone()
            } else if is_text_openable_file(&target_path) {
                match read_utf8(&target_path) {
                    Ok(content) => heading_slugs(&content),
                    Err(_) => HashSet::new(),
                }
            } else {
                HashSet::new()
            };

            if !slug_set.contains(&anchor) {
                issues.push(LinkValidationIssue {
                    line,
                    link: link.clone(),
                    severity: "error".to_string(),
                    message: "Anchor was not found in target document".to_string(),
                });
            }
        }
    }

    Ok(LinkValidationReport {
        checked_external: check_external,
        issues,
    })
}

#[tauri::command]
pub fn save_session_state(state: SessionStateDto) -> Result<(), AppError> {
    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))?;
    let path = session_state_path()?;
    atomic_write(&path, &serialized)?;
    append_log("save_session_state", "ok");
    Ok(())
}

#[tauri::command]
pub fn load_session_state() -> Result<Option<SessionStateDto>, AppError> {
    let path = session_state_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = read_utf8(&path)?;
    let state = serde_json::from_str::<SessionStateDto>(&raw)
        .map_err(|error| AppError::new(AppErrorCode::Io, error.to_string()))?;
    Ok(Some(state))
}

#[tauri::command]
pub fn export_logs(destination_path: String) -> Result<(), AppError> {
    let source = app_log_path()?;
    let destination = PathBuf::from(destination_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| map_io_error(&error))?;
    }

    if !source.exists() {
        atomic_write(&destination, "No logs recorded yet.\n")?;
        return Ok(());
    }

    fs::copy(&source, &destination).map_err(|error| map_io_error(&error))?;
    append_log("export_logs", &destination.to_string_lossy());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
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

    #[test]
    fn lists_markdown_files_in_folder() {
        let temp_dir = tempdir().expect("temp dir");
        let folder = temp_dir.path();

        let root_file = folder.join("README.md");
        let nested_dir = folder.join("docs");
        let nested_file = nested_dir.join("guide.markdown");
        let ignored = folder.join("notes.txt");

        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::write(root_file, "root").expect("write root");
        fs::write(nested_file, "nested").expect("write nested");
        fs::write(ignored, "ignored").expect("write ignored");

        let files = list_markdown_files(folder.to_string_lossy().to_string()).expect("list files");
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|file| file.relative_path == "README.md"));
        assert!(files.iter().any(|file| file.relative_path == "docs/guide.markdown"));
    }

    #[test]
    fn search_workspace_finds_expected_match() {
        let temp_dir = tempdir().expect("temp dir");
        let folder = temp_dir.path();

        fs::write(folder.join("a.md"), "hello world\nalpha beta").expect("write a");
        fs::write(folder.join("b.md"), "another file").expect("write b");

        let hits = search_workspace(
            folder.to_string_lossy().to_string(),
            "hello alpha".to_string(),
            None,
        )
        .expect("search");

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "a.md");
    }

    #[test]
    fn snapshot_retention_prunes_to_fifty() {
        let path = "/tmp/fake.md".to_string();
        let mut permission_denied = false;
        for index in 0..55 {
            if let Err(error) =
                create_snapshot(path.clone(), format!("content-{index}"), "manual".to_string())
            {
                if error.code == AppErrorCode::PermissionDenied {
                    permission_denied = true;
                    break;
                }
                panic!("snapshot: {error:?}");
            }
        }

        if permission_denied {
            return;
        }

        let entries = list_snapshots(path).expect("list");
        assert!(entries.len() <= 50);
    }

    #[test]
    fn validate_links_flags_missing_local_target() {
        let temp_dir = tempdir().expect("temp dir");
        let document_path = temp_dir.path().join("doc.md");
        fs::write(&document_path, "[broken](./missing.md)").expect("write");

        let report = validate_links(
            document_path.to_string_lossy().to_string(),
            "[broken](./missing.md)".to_string(),
            false,
        )
        .expect("validate");

        assert!(!report.issues.is_empty());
        assert_eq!(report.issues[0].severity, "error");
    }

    #[test]
    fn save_and_import_image_assets() {
        let temp_dir = tempdir().expect("temp dir");
        let document_path = temp_dir.path().join("doc.md");
        fs::write(&document_path, "# doc").expect("write doc");

        let one_pixel_png =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgNf2N7kAAAAASUVORK5CYII=";

        let saved = save_image_asset(
            document_path.to_string_lossy().to_string(),
            "clip.png".to_string(),
            "image/png".to_string(),
            one_pixel_png.to_string(),
        )
        .expect("save image");

        assert!(Path::new(&saved.path).exists());

        let imported = import_image_asset(
            document_path.to_string_lossy().to_string(),
            saved.path.clone(),
        )
        .expect("import image");

        assert!(Path::new(&imported.path).exists());
    }
}
