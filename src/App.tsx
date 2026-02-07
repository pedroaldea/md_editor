import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import EditorPane from "./components/EditorPane";
import PreviewPane from "./components/PreviewPane";
import TopBar from "./components/TopBar";
import { getBlockIndexForLine, renderMarkdown } from "./lib/markdown";
import { bindShortcuts } from "./lib/shortcuts";
import { useDocumentStore } from "./state/documentStore";
import type { AppError, OpenDocumentResult, SaveResult } from "./types/app";

const MARKDOWN_FILTER = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];

const normalizeError = (value: unknown): AppError => {
  if (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { code: unknown }).code === "string" &&
    typeof (value as { message: unknown }).message === "string"
  ) {
    return value as AppError;
  }

  return {
    code: "IO",
    message: String(value ?? "Unexpected error")
  };
};

const hasUnsavedChanges = (): boolean => useDocumentStore.getState().document.dirty;

export default function App() {
  const {
    document,
    status,
    error,
    themeMode,
    setContent,
    loadDocument,
    markSaved,
    markRecovered,
    newDocument,
    setStatus,
    setError
  } = useDocumentStore();
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [previewScrollTarget, setPreviewScrollTarget] = useState<number | null>(null);
  const [editorScrollTarget, setEditorScrollTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const rendered = useMemo(() => renderMarkdown(document.content), [document.content]);

  useEffect(() => {
    setActiveBlockIndex((current) =>
      Math.min(current, Math.max(0, rendered.blockCount - 1))
    );
  }, [rendered.blockCount]);

  const openDocumentAtPath = useCallback(
    async (path: string) => {
      try {
        const result = await invoke<OpenDocumentResult>("open_document", { path });
        loadDocument(result);
        setStatus(`Opened ${path.split("/").pop() ?? path}`);
        setError(null);
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setStatus("Could not open file");
        setError(appError);
      }
    },
    [loadDocument, setError, setStatus]
  );

  const openFromDialog = useCallback(async () => {
    if (
      hasUnsavedChanges() &&
      !window.confirm("You have unsaved changes. Open another file anyway?")
    ) {
      return;
    }

    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: MARKDOWN_FILTER
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    await openDocumentAtPath(selected);
  }, [openDocumentAtPath]);

  const saveDocument = useCallback(
    async (forceSaveAs: boolean, reason: "manual" | "autosave") => {
      if (saving) {
        return;
      }

      setSaving(true);
      const snapshot = useDocumentStore.getState().document;

      try {
        if (!forceSaveAs && snapshot.path) {
          const result = await invoke<SaveResult>("save_document", {
            path: snapshot.path,
            content: snapshot.content,
            expected_mtime_ms: snapshot.mtimeMs
          });
          markSaved(result);
          setStatus(reason === "autosave" ? "Autosaved" : "Saved");
        } else {
          const selected = await saveDialog({
            defaultPath: snapshot.path ?? "Untitled.md",
            filters: MARKDOWN_FILTER
          });

          if (!selected || Array.isArray(selected)) {
            if (reason === "manual") {
              setStatus("Save canceled");
            }
            return;
          }

          const result = await invoke<SaveResult>("save_as_document", {
            path: selected,
            content: snapshot.content
          });
          markSaved(result);
          await invoke("store_recovery_draft", { content: "" });
          setStatus("Saved");
        }

        setError(null);
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus(reason === "autosave" ? "Autosave failed" : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [markSaved, saving, setError, setStatus]
  );

  const createNewDocument = useCallback(() => {
    if (
      hasUnsavedChanges() &&
      !window.confirm("Discard unsaved changes and start a new document?")
    ) {
      return;
    }

    newDocument();
    setStatus("New document");
    setError(null);
    void invoke("store_recovery_draft", { content: "" });
  }, [newDocument, setError, setStatus]);

  const handleCursorLineChange = useCallback(
    (lineNumber: number) => {
      setActiveBlockIndex(getBlockIndexForLine(document.content, lineNumber));
    },
    [document.content]
  );

  const handleEditorScroll = useCallback((ratio: number) => {
    setPreviewScrollTarget(ratio);
  }, []);

  const handlePreviewScroll = useCallback((ratio: number) => {
    setEditorScrollTarget(ratio);
  }, []);

  const handleExternalLink = useCallback(async (href: string) => {
    try {
      await openExternal(href);
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const draft = await invoke<string | null>("load_recovery_draft");
        if (draft && draft.trim().length > 0 && document.content.length === 0) {
          markRecovered(draft);
          setStatus("Recovered unsaved draft");
        }
      } catch {
        setStatus("Ready");
      }
    })();
  }, [document.content.length, markRecovered, setStatus]);

  useEffect(() => {
    if (!document.path || !document.dirty) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveDocument(false, "autosave");
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [document.path, document.dirty, document.content, document.mtimeMs, saveDocument]);

  useEffect(() => {
    if (document.path) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void invoke("store_recovery_draft", { content: document.content });
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [document.path, document.content]);

  useEffect(() => {
    const dispose = bindShortcuts({
      onNew: createNewDocument,
      onOpen: () => {
        void openFromDialog();
      },
      onSave: () => {
        void saveDocument(false, "manual");
      },
      onSaveAs: () => {
        void saveDocument(true, "manual");
      }
    });

    return dispose;
  }, [createNewDocument, openFromDialog, saveDocument]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasUnsavedChanges()) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    let disposeDragDrop: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload as { type: string; paths?: string[] };
        if (payload.type !== "drop" || !payload.paths || payload.paths.length === 0) {
          return;
        }
        void openDocumentAtPath(payload.paths[0]);
      })
      .then((unlisten) => {
        disposeDragDrop = unlisten;
      });

    return () => {
      if (disposeDragDrop) {
        disposeDragDrop();
      }
    };
  }, [openDocumentAtPath]);

  useEffect(() => {
    const disposers: Array<() => void> = [];

    void listen<string>("menu://command", async (event) => {
      switch (event.payload) {
        case "new":
          createNewDocument();
          break;
        case "open":
          await openFromDialog();
          break;
        case "save":
          await saveDocument(false, "manual");
          break;
        case "save_as":
          await saveDocument(true, "manual");
          break;
        default:
          break;
      }
    }).then((dispose) => {
      disposers.push(dispose);
    });

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [createNewDocument, openFromDialog, saveDocument]);

  return (
    <div className="app-shell" data-theme-mode={themeMode}>
      <TopBar
        path={document.path}
        dirty={document.dirty}
        status={status}
        error={error}
        onNew={createNewDocument}
        onOpen={() => {
          void openFromDialog();
        }}
        onSave={() => {
          void saveDocument(false, "manual");
        }}
        onSaveAs={() => {
          void saveDocument(true, "manual");
        }}
      />
      <main className="editor-layout">
        <section className="pane pane-editor">
          <EditorPane
            value={document.content}
            targetScrollRatio={editorScrollTarget}
            onChange={setContent}
            onCursorLineChange={handleCursorLineChange}
            onScrollRatioChange={handleEditorScroll}
          />
        </section>
        <section className="pane pane-preview">
          <PreviewPane
            html={rendered.html}
            activeBlockIndex={activeBlockIndex}
            targetScrollRatio={previewScrollTarget}
            onScrollRatioChange={handlePreviewScroll}
            onExternalLink={handleExternalLink}
          />
        </section>
      </main>
    </div>
  );
}
