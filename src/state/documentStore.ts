import { create } from "zustand";
import type {
  AppError,
  DocumentState,
  OpenDocumentResult,
  SaveResult,
  ThemeMode
} from "../types/app";

interface DocumentStore {
  document: DocumentState;
  themeMode: ThemeMode;
  status: string;
  error: AppError | null;
  setContent: (content: string) => void;
  loadDocument: (document: OpenDocumentResult) => void;
  markSaved: (result: SaveResult) => void;
  markRecovered: (content: string) => void;
  newDocument: () => void;
  setThemeMode: (mode: ThemeMode) => void;
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

const initialState = {
  document: createInitialDocument(),
  themeMode: "system" as ThemeMode,
  status: "Ready",
  error: null as AppError | null
};

export const useDocumentStore = create<DocumentStore>((set) => ({
  ...initialState,
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
  setThemeMode: (mode: ThemeMode) =>
    set({
      themeMode: mode
    }),
  setStatus: (status: string) =>
    set({
      status
    }),
  setError: (error: AppError | null) =>
    set({
      error
    }),
  reset: () => set(initialState)
}));
