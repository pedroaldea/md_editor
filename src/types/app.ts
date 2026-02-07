export type ThemeMode = "system" | "light" | "dark";
export type ReaderPalette = "void" | "paper" | "mist";

export interface UltraReadConfig {
  enabled: boolean;
  fixation: number;
  minWordLength: number;
  focusWeight: number;
}

export type AppErrorCode =
  | "FILE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "CONFLICT"
  | "INVALID_ENCODING"
  | "IO";

export interface AppError {
  code: AppErrorCode;
  message: string;
}

export interface DocumentState {
  path: string | null;
  content: string;
  dirty: boolean;
  mtimeMs: number | null;
  lastSavedAtMs: number | null;
  recovered: boolean;
}

export interface OpenDocumentResult {
  path: string;
  content: string;
  mtimeMs: number;
}

export interface SaveResult {
  path: string;
  mtimeMs: number;
  savedAtMs: number;
}

export interface MarkdownFileEntry {
  path: string;
  name: string;
  relativePath: string;
}
