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

export interface SearchHit {
  path: string;
  name: string;
  relativePath: string;
  line: number;
  snippet: string;
}

export interface SavedImageAsset {
  path: string;
  relativePath: string;
}

export interface SnapshotEntry {
  id: string;
  createdAtMs: number;
  reason: string;
  sizeBytes: number;
}

export interface LinkValidationIssue {
  line: number;
  link: string;
  severity: "error" | "warning";
  message: string;
}

export interface LinkValidationReport {
  checkedExternal: boolean;
  issues: LinkValidationIssue[];
}

export type ExportProfile = "clean-markdown" | "html" | "pdf-print";

export interface SessionState {
  workspaceFolder: string | null;
  activePath: string | null;
  draftContent: string | null;
  readMode: boolean;
  focusMode: boolean;
  focusPreviewOnly: boolean;
  splitRatio: number;
  readerPalette: ReaderPalette;
  ultraReadEnabled: boolean;
  ultraReadFixation: number;
  ultraReadMinWordLength: number;
  ultraReadFocusWeight: number;
  cosmicOpen: boolean;
  cosmicPlaying: boolean;
  cosmicWpm: number;
  cosmicIndex: number;
  cosmicBionic: boolean;
  cosmicPalette: ReaderPalette;
  cosmicWordSize: number;
  cosmicBaseWeight: number;
  cosmicFocusWeight: number;
  cosmicFixation: number;
  cosmicMinWordLength: number;
  activeBlockIndex: number;
  previewScrollRatio: number | null;
  editorScrollRatio: number | null;
}

export interface CommandPaletteItem {
  id: string;
  type: "action" | "file" | "heading";
  title: string;
  subtitle?: string;
  keywords: string[];
  run: () => void | Promise<void>;
}
