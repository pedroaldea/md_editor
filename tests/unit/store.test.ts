import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "../../src/state/documentStore";

describe("document store", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
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

  it("loads recovered drafts as unsaved content", () => {
    useDocumentStore.getState().markRecovered("recovered text");
    const state = useDocumentStore.getState();
    expect(state.document.path).toBeNull();
    expect(state.document.recovered).toBe(true);
    expect(state.document.dirty).toBe(true);
  });
});
