import { create } from "zustand";
import type {
  AppError,
  DocumentState,
  OpenDocumentResult,
  ReaderPalette,
  SaveResult,
  UltraReadConfig
} from "../types/app";

interface DocumentStore {
  document: DocumentState;
  readerPalette: ReaderPalette;
  ultraRead: UltraReadConfig;
  status: string;
  error: AppError | null;
  setContent: (content: string) => void;
  loadDocument: (document: OpenDocumentResult) => void;
  markSaved: (result: SaveResult) => void;
  markRecovered: (content: string) => void;
  newDocument: () => void;
  setReaderPalette: (palette: ReaderPalette) => void;
  setUltraReadEnabled: (enabled: boolean) => void;
  setUltraReadFixation: (fixation: number) => void;
  setUltraReadMinWordLength: (minWordLength: number) => void;
  setUltraReadFocusWeight: (focusWeight: number) => void;
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
  readerPalette: "void" as ReaderPalette,
  ultraRead: {
    enabled: false,
    fixation: 0.45,
    minWordLength: 4,
    focusWeight: 760
  } as UltraReadConfig,
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
  setReaderPalette: (palette: ReaderPalette) =>
    set({
      readerPalette: palette
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
