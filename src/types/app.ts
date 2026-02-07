export type ThemeMode = "system" | "light" | "dark";

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
