import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_MODE,
  THEME_MODE_STORAGE_KEY,
  useDocumentStore
} from "../../src/state/documentStore";

describe("document store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDocumentStore.getState().reset();
  });

  it("starts in the selected dark terminal theme", () => {
    expect(useDocumentStore.getState().themeMode).toBe(DEFAULT_THEME_MODE);
    expect(DEFAULT_THEME_MODE).toBe("dark");
  });

  it("persists the selected light or dark theme", () => {
    useDocumentStore.getState().setThemeMode("dark");

    expect(useDocumentStore.getState().themeMode).toBe("dark");
    expect(window.localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe("dark");

    useDocumentStore.getState().reset();
    expect(useDocumentStore.getState().themeMode).toBe("dark");
  });

  it("falls back to the selected default when persisted theme data is invalid", () => {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, "neon");
    useDocumentStore.getState().reset();

    expect(useDocumentStore.getState().themeMode).toBe("dark");
  });

  it("loads a document and tracks clean state", () => {
    useDocumentStore.getState().loadDocument({
      path: "/tmp/readme.md",
      content: "# hello",
      mtimeMs: 1000
    });

    const state = useDocumentStore.getState();
    expect(state.document.path).toBe("/tmp/readme.md");
    expect(state.document.dirty).toBe(false);
    expect(state.document.mtimeMs).toBe(1000);
  });

  it("marks document dirty on content change", () => {
    const { setContent } = useDocumentStore.getState();
    setContent("Draft");

    const state = useDocumentStore.getState();
    expect(state.document.content).toBe("Draft");
    expect(state.document.dirty).toBe(true);
  });

  it("marks saved metadata after save result", () => {
    const store = useDocumentStore.getState();
    store.setContent("hello");
    store.markSaved({
      path: "/tmp/new.md",
      mtimeMs: 2000,
      savedAtMs: 2500
    });

    const state = useDocumentStore.getState();
    expect(state.document.path).toBe("/tmp/new.md");
    expect(state.document.dirty).toBe(false);
    expect(state.document.lastSavedAtMs).toBe(2500);
  });

  it("keeps newer edits dirty when only save metadata is committed", () => {
    const store = useDocumentStore.getState();
    store.loadDocument({ path: "/tmp/current.md", content: "old", mtimeMs: 1000 });
    store.setContent("newer edit");
    store.markPersisted({ path: "/tmp/current.md", mtimeMs: 2000, savedAtMs: 2500 });

    const state = useDocumentStore.getState();
    expect(state.document.content).toBe("newer edit");
    expect(state.document.dirty).toBe(true);
    expect(state.document.mtimeMs).toBe(2000);
  });

  it("loads recovered drafts as unsaved content", () => {
    useDocumentStore.getState().markRecovered("recovered text");
    const state = useDocumentStore.getState();
    expect(state.document.path).toBeNull();
    expect(state.document.recovered).toBe(true);
    expect(state.document.dirty).toBe(true);
  });

  it("updates reader palette and ultra read settings", () => {
    const store = useDocumentStore.getState();
    store.setReaderPalette("paper");
    store.setUltraReadEnabled(true);
    store.setUltraReadFixation(0.6);
    store.setUltraReadMinWordLength(5);
    store.setUltraReadFocusWeight(840);

    const state = useDocumentStore.getState();
    expect(state.readerPalette).toBe("paper");
    expect(state.ultraRead.enabled).toBe(true);
    expect(state.ultraRead.fixation).toBe(0.6);
    expect(state.ultraRead.minWordLength).toBe(5);
    expect(state.ultraRead.focusWeight).toBe(840);
  });

  it("loads snapshot content as dirty state", () => {
    useDocumentStore.getState().loadDocumentDirty({
      path: "/tmp/history.md",
      content: "snapshot text",
      mtimeMs: 3000
    });

    const state = useDocumentStore.getState();
    expect(state.document.path).toBe("/tmp/history.md");
    expect(state.document.content).toBe("snapshot text");
    expect(state.document.dirty).toBe(true);
    expect(state.document.lastSavedAtMs).toBeNull();
  });
});
