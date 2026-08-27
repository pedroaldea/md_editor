import { create } from "zustand";
import type {
  AppError,
  DocumentState,
  EditorSettings,
  OpenDocumentResult,
  ReaderPalette,
  ReaderPreferences,
  SaveResult,
  ThemeMode,
  UltraReadConfig
} from "../types/app";

export const THEME_MODE_STORAGE_KEY = "md-editor.theme-mode";
export const DEFAULT_THEME_MODE: ThemeMode = "dark";
export const READER_PREFERENCES_STORAGE_KEY = "md-editor.reader-preferences";
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 18,
  contentWidth: 960
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const isThemeMode = (value: unknown): value is ThemeMode => value === "light" || value === "dark";

const loadThemeMode = (): ThemeMode => {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_MODE;
  }

  try {
    const storedThemeMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return isThemeMode(storedThemeMode) ? storedThemeMode : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
};

const persistThemeMode = (themeMode: ThemeMode): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
  } catch {
    // Theme selection still works for the current session when storage is unavailable.
  }
};

const normalizeReaderPreferences = (value: unknown): ReaderPreferences => {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_READER_PREFERENCES;
  }

  const preferences = value as Partial<ReaderPreferences>;
  return {
    fontSize: typeof preferences.fontSize === "number" && Number.isFinite(preferences.fontSize)
      ? clamp(Math.round(preferences.fontSize), 15, 24)
      : DEFAULT_READER_PREFERENCES.fontSize,
    contentWidth: typeof preferences.contentWidth === "number" && Number.isFinite(preferences.contentWidth)
      ? clamp(Math.round(preferences.contentWidth / 80) * 80, 640, 1280)
      : DEFAULT_READER_PREFERENCES.contentWidth
  };
};

const loadReaderPreferences = (): ReaderPreferences => {
  if (typeof window === "undefined") {
    return DEFAULT_READER_PREFERENCES;
  }

  try {
    const stored = window.localStorage.getItem(READER_PREFERENCES_STORAGE_KEY);
    return stored ? normalizeReaderPreferences(JSON.parse(stored)) : DEFAULT_READER_PREFERENCES;
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
};

const persistReaderPreferences = (preferences: ReaderPreferences): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(READER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Reading preferences still work for the current session when storage is unavailable.
  }
};

interface DocumentStore {
  document: DocumentState;
  themeMode: ThemeMode;
  readerPalette: ReaderPalette;
  readerPreferences: ReaderPreferences;
  ultraRead: UltraReadConfig;
  editorSettings: EditorSettings;
  status: string;
  error: AppError | null;
  setContent: (content: string) => void;
  loadDocument: (document: OpenDocumentResult) => void;
  loadDocumentDirty: (document: OpenDocumentResult) => void;
  markSaved: (result: SaveResult) => void;
  markPersisted: (result: SaveResult) => void;
  markRecovered: (content: string) => void;
  newDocument: () => void;
  setThemeMode: (themeMode: ThemeMode) => void;
  setReaderPalette: (palette: ReaderPalette) => void;
  setReaderFontSize: (fontSize: number) => void;
  setReaderContentWidth: (contentWidth: number) => void;
  setUltraReadEnabled: (enabled: boolean) => void;
  setUltraReadFixation: (fixation: number) => void;
  setUltraReadMinWordLength: (minWordLength: number) => void;
  setUltraReadFocusWeight: (focusWeight: number) => void;
  setEditorFontSize: (fontSize: number) => void;
  setEditorLineNumbers: (lineNumbers: boolean) => void;
  setEditorWordWrap: (wordWrap: boolean) => void;
  setEditorHighlightActiveLine: (highlightActiveLine: boolean) => void;
  setEditorSettings: (settings: EditorSettings) => void;
  setStatus: (status: string) => void;
  setError: (error: AppError | null) => void;
  reset: () => void;
}

const createInitialDocument = (): DocumentState => ({
  path: null,
  content: "",
  dirty: false,
  mtimeMs: null,
  lastSavedAtMs: null,
  recovered: false
});

const createInitialState = () => ({
  document: createInitialDocument(),
  themeMode: loadThemeMode(),
  readerPalette: "void" as ReaderPalette,
  readerPreferences: loadReaderPreferences(),
  ultraRead: {
    enabled: false,
    fixation: 0.45,
    minWordLength: 4,
    focusWeight: 760
  } as UltraReadConfig,
  editorSettings: {
    fontSize: 16,
    lineNumbers: true,
    wordWrap: true,
    highlightActiveLine: true
  } as EditorSettings,
  status: "Ready",
  error: null as AppError | null
});

export const useDocumentStore = create<DocumentStore>((set) => ({
  ...createInitialState(),
  setContent: (content: string) =>
    set((state) => {
      if (state.document.content === content) {
        return state;
      }

      return {
        document: {
          ...state.document,
          content,
          dirty: true
        }
      };
    }),
  loadDocument: (document: OpenDocumentResult) =>
    set({
      document: {
        path: document.path,
        content: document.content,
        dirty: false,
        mtimeMs: document.mtimeMs,
        lastSavedAtMs: Date.now(),
        recovered: false
      },
      error: null
    }),
  loadDocumentDirty: (document: OpenDocumentResult) =>
    set({
      document: {
        path: document.path,
        content: document.content,
        dirty: true,
        mtimeMs: document.mtimeMs,
        lastSavedAtMs: null,
        recovered: false
      },
      error: null
    }),
  markSaved: (result: SaveResult) =>
    set((state) => ({
      document: {
        ...state.document,
        path: result.path,
        dirty: false,
        mtimeMs: result.mtimeMs,
        lastSavedAtMs: result.savedAtMs,
        recovered: false
      },
      error: null
    })),
  markPersisted: (result: SaveResult) =>
    set((state) => ({
      document: {
        ...state.document,
        path: result.path,
        mtimeMs: result.mtimeMs,
        lastSavedAtMs: result.savedAtMs,
        recovered: false
      },
      error: null
    })),
  markRecovered: (content: string) =>
    set({
      document: {
        path: null,
        content,
        dirty: content.length > 0,
        mtimeMs: null,
        lastSavedAtMs: null,
        recovered: true
      }
    }),
  newDocument: () =>
    set({
      document: createInitialDocument(),
      error: null
    }),
  setThemeMode: (themeMode: ThemeMode) => {
    persistThemeMode(themeMode);
    set({ themeMode });
  },
  setReaderPalette: (palette: ReaderPalette) =>
    set({
      readerPalette: palette
    }),
  setReaderFontSize: (fontSize: number) =>
    set((state) => {
      const readerPreferences = normalizeReaderPreferences({
        ...state.readerPreferences,
        fontSize
      });
      persistReaderPreferences(readerPreferences);
      return { readerPreferences };
    }),
  setReaderContentWidth: (contentWidth: number) =>
    set((state) => {
      const readerPreferences = normalizeReaderPreferences({
        ...state.readerPreferences,
        contentWidth
      });
      persistReaderPreferences(readerPreferences);
      return { readerPreferences };
    }),
  setUltraReadEnabled: (enabled: boolean) =>
    set((state) => ({
      ultraRead: {
        ...state.ultraRead,
        enabled
      }
    })),
  setUltraReadFixation: (fixation: number) =>
    set((state) => ({
      ultraRead: {
        ...state.ultraRead,
        fixation
      }
    })),
  setUltraReadMinWordLength: (minWordLength: number) =>
    set((state) => ({
      ultraRead: {
        ...state.ultraRead,
        minWordLength
      }
    })),
  setUltraReadFocusWeight: (focusWeight: number) =>
    set((state) => ({
      ultraRead: {
        ...state.ultraRead,
        focusWeight
      }
    })),
  setEditorFontSize: (fontSize: number) =>
    set((state) => ({
      editorSettings: {
        ...state.editorSettings,
        fontSize
      }
    })),
  setEditorLineNumbers: (lineNumbers: boolean) =>
    set((state) => ({
      editorSettings: {
        ...state.editorSettings,
        lineNumbers
      }
    })),
  setEditorWordWrap: (wordWrap: boolean) =>
    set((state) => ({
      editorSettings: {
        ...state.editorSettings,
        wordWrap
      }
    })),
  setEditorHighlightActiveLine: (highlightActiveLine: boolean) =>
    set((state) => ({
      editorSettings: {
        ...state.editorSettings,
        highlightActiveLine
      }
    })),
  setEditorSettings: (editorSettings: EditorSettings) =>
    set({
      editorSettings
    }),
  setStatus: (status: string) =>
    set({
      status
    }),
  setError: (error: AppError | null) =>
    set({
      error
    }),
  reset: () => set(createInitialState())
}));
