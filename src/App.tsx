import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import CosmicFocusOverlay from "./components/CosmicFocusOverlay";
import EditorPane from "./components/EditorPane";
import FileSidebar from "./components/FileSidebar";
import PreviewPane from "./components/PreviewPane";
import TopBar from "./components/TopBar";
import {
  applyBionicReading,
  extractReadingWords,
  getBlockIndexForLine,
  renderBionicWord,
  renderMarkdown
} from "./lib/markdown";
import { bindShortcuts } from "./lib/shortcuts";
import { useDocumentStore } from "./state/documentStore";
import type {
  AppError,
  MarkdownFileEntry,
  OpenDocumentResult,
  ReaderPalette,
  SaveResult
} from "./types/app";

const MARKDOWN_FILTER = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];
const LOG_FILTER = [{ name: "Log", extensions: ["log", "txt"] }];

const normalizeError = (value: unknown): AppError => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as { code?: unknown; message?: unknown };
      if (typeof parsed.code === "string" && typeof parsed.message === "string") {
        return { code: parsed.code as AppError["code"], message: parsed.message };
      }
    } catch {
      return {
        code: "IO",
        message: value
      };
    }
  }

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

const isPathInsideFolder = (path: string, folderPath: string): boolean =>
  path === folderPath || path.startsWith(`${folderPath}/`);

export default function App() {
  const {
    document,
    status,
    error,
    readerPalette,
    ultraRead,
    setContent,
    loadDocument,
    markSaved,
    markRecovered,
    newDocument,
    setReaderPalette,
    setUltraReadEnabled,
    setUltraReadFixation,
    setUltraReadMinWordLength,
    setUltraReadFocusWeight,
    setStatus,
    setError
  } = useDocumentStore();
  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [previewScrollTarget, setPreviewScrollTarget] = useState<number | null>(null);
  const [editorScrollTarget, setEditorScrollTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);

  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<MarkdownFileEntry[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const [cosmicOpen, setCosmicOpen] = useState(false);
  const [cosmicPlaying, setCosmicPlaying] = useState(false);
  const [cosmicWpm, setCosmicWpm] = useState(360);
  const [cosmicIndex, setCosmicIndex] = useState(0);
  const [cosmicBionic, setCosmicBionic] = useState(true);
  const [cosmicPalette, setCosmicPalette] = useState<ReaderPalette>("void");
  const [cosmicWordSize, setCosmicWordSize] = useState(96);
  const [cosmicBaseWeight, setCosmicBaseWeight] = useState(560);
  const [cosmicFocusWeight, setCosmicFocusWeight] = useState(820);
  const [cosmicFixation, setCosmicFixation] = useState(0.45);
  const [cosmicMinWordLength, setCosmicMinWordLength] = useState(4);

  const layoutRef = useRef<HTMLElement | null>(null);

  const rendered = useMemo(() => renderMarkdown(document.content), [document.content]);
  const previewHtml = useMemo(
    () => applyBionicReading(rendered.html, ultraRead),
    [rendered.html, ultraRead]
  );
  const cosmicWords = useMemo(() => extractReadingWords(document.content), [document.content]);

  const renderCosmicWord = useCallback(
    (word: string) => {
      if (cosmicBionic) {
        return renderBionicWord(word, {
          fixation: cosmicFixation,
          minWordLength: cosmicMinWordLength
        });
      }
      return renderBionicWord(word, {
        fixation: cosmicFixation,
        minWordLength: Number.MAX_SAFE_INTEGER
      });
    },
    [cosmicBionic, cosmicFixation, cosmicMinWordLength]
  );

  useEffect(() => {
    setActiveBlockIndex((current) =>
      Math.min(current, Math.max(0, rendered.blockCount - 1))
    );
  }, [rendered.blockCount]);

  useEffect(() => {
    if (cosmicIndex >= cosmicWords.length) {
      setCosmicIndex(Math.max(cosmicWords.length - 1, 0));
    }
  }, [cosmicIndex, cosmicWords.length]);

  useEffect(() => {
    if (!cosmicOpen || !cosmicPlaying || cosmicWords.length === 0) {
      return;
    }

    const intervalMs = Math.max(40, Math.round(60000 / Math.max(cosmicWpm, 1)));
    const intervalId = window.setInterval(() => {
      setCosmicIndex((current) => {
        if (current >= cosmicWords.length - 1) {
          setCosmicPlaying(false);
          return cosmicWords.length - 1;
        }
        return current + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [cosmicOpen, cosmicPlaying, cosmicWords.length, cosmicWpm]);

  useEffect(() => {
    if (!cosmicOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      const isTextInput =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable === true;

      if (isTextInput) {
        return;
      }

      event.preventDefault();
      if (cosmicWords.length === 0) {
        return;
      }
      setCosmicPlaying((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cosmicOpen, cosmicWords.length]);

  const openDocumentAtPath = useCallback(
    async (path: string) => {
      try {
        const result = await invoke<OpenDocumentResult>("open_document", { path });
        loadDocument(result);
        await invoke("store_recovery_draft", { content: "" });
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

  const loadWorkspaceFolder = useCallback(
    async (folderPath: string) => {
      setWorkspaceLoading(true);
      try {
        const files = await invoke<MarkdownFileEntry[]>("list_markdown_files", {
          directory: folderPath
        });
        setWorkspaceFolder(folderPath);
        setWorkspaceFiles(files);
        setStatus(`Loaded ${files.length} files`);
        setError(null);
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Could not load folder");
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [setError, setStatus]
  );

  const openFolderFromDialog = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      directory: true
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    await loadWorkspaceFolder(selected);
  }, [loadWorkspaceFolder]);

  const saveDocument = useCallback(
    async (forceSaveAs: boolean, reason: "manual" | "autosave"): Promise<boolean> => {
      if (saving) {
        return false;
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
          setError(null);
          return true;
        }

        const selected = await saveDialog({
          defaultPath: snapshot.path ?? "Untitled.md",
          filters: MARKDOWN_FILTER
        });

        if (!selected || Array.isArray(selected)) {
          if (reason === "manual") {
            setStatus("Save canceled");
          }
          return false;
        }

        const result = await invoke<SaveResult>("save_as_document", {
          path: selected,
          content: snapshot.content
        });
        markSaved(result);
        await invoke("store_recovery_draft", { content: "" });
        setStatus("Saved");
        setError(null);
        return true;
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus(reason === "autosave" ? "Autosave failed" : "Save failed");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [markSaved, saving, setError, setStatus]
  );

  const ensureCanReplaceDocument = useCallback(
    async (actionDescription: string): Promise<boolean> => {
      const current = useDocumentStore.getState().document;
      if (!current.dirty) {
        return true;
      }

      if (current.path) {
        const shouldSave = window.confirm(
          `You have unsaved changes. Save before ${actionDescription}?`
        );
        if (shouldSave) {
          return saveDocument(false, "manual");
        }
        return window.confirm(`Discard changes and continue ${actionDescription}?`);
      }

      const shouldSaveAs = window.confirm(
        `You have an unsaved draft. Save As before ${actionDescription}?`
      );
      if (shouldSaveAs) {
        return saveDocument(true, "manual");
      }
      return window.confirm(`Discard unsaved draft and continue ${actionDescription}?`);
    },
    [saveDocument]
  );

  const openFromDialog = useCallback(async () => {
    const canContinue = await ensureCanReplaceDocument("opening another file");
    if (!canContinue) {
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
  }, [ensureCanReplaceDocument, openDocumentAtPath]);

  const createNewDocument = useCallback(async () => {
    const canContinue = await ensureCanReplaceDocument("creating a new document");
    if (!canContinue) {
      return;
    }

    newDocument();
    setStatus("New document");
    setError(null);
    await invoke("store_recovery_draft", { content: "" });
  }, [ensureCanReplaceDocument, newDocument, setError, setStatus]);

  const handleSidebarFileSelect = useCallback(
    async (path: string) => {
      const currentPath = useDocumentStore.getState().document.path;
      if (currentPath === path) {
        return;
      }

      const canContinue = await ensureCanReplaceDocument("switching files");
      if (!canContinue) {
        return;
      }
      await openDocumentAtPath(path);
    },
    [ensureCanReplaceDocument, openDocumentAtPath]
  );

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

  const exportLogs = useCallback(async () => {
    const selected = await saveDialog({
      defaultPath: "md-editor.log",
      filters: LOG_FILTER
    });

    if (!selected || Array.isArray(selected)) {
      setStatus("Export logs canceled");
      return;
    }

    try {
      await invoke("export_logs", { destinationPath: selected });
      setStatus("Logs exported");
      setError(null);
    } catch (unknownError) {
      const appError = normalizeError(unknownError);
      setError(appError);
      setStatus("Failed to export logs");
    }
  }, [setError, setStatus]);

  const handleReaderPaletteChange = useCallback(
    (palette: ReaderPalette) => {
      setReaderPalette(palette);
    },
    [setReaderPalette]
  );

  const handleUltraReadFixationChange = useCallback(
    (fixation: number) => {
      const nextFixation = Math.max(0.25, Math.min(0.75, fixation));
      setUltraReadFixation(nextFixation);
    },
    [setUltraReadFixation]
  );

  const handleUltraReadMinWordLengthChange = useCallback(
    (value: number) => {
      const nextValue = Number.isFinite(value) ? value : 4;
      setUltraReadMinWordLength(Math.max(2, Math.min(12, Math.round(nextValue))));
    },
    [setUltraReadMinWordLength]
  );

  const handleUltraReadFocusWeightChange = useCallback(
    (value: number) => {
      const nextValue = Number.isFinite(value) ? value : 760;
      setUltraReadFocusWeight(Math.max(560, Math.min(900, Math.round(nextValue))));
    },
    [setUltraReadFocusWeight]
  );

  const handleCosmicPaletteChange = useCallback((palette: ReaderPalette) => {
    setCosmicPalette(palette);
  }, []);

  const handleCosmicWordSizeChange = useCallback((value: number) => {
    const next = Number.isFinite(value) ? value : 96;
    setCosmicWordSize(Math.max(44, Math.min(180, Math.round(next))));
  }, []);

  const handleCosmicBaseWeightChange = useCallback((value: number) => {
    const next = Number.isFinite(value) ? value : 560;
    setCosmicBaseWeight(Math.max(350, Math.min(750, Math.round(next))));
  }, []);

  const handleCosmicFocusWeightChange = useCallback((value: number) => {
    const next = Number.isFinite(value) ? value : 820;
    setCosmicFocusWeight(Math.max(560, Math.min(900, Math.round(next))));
  }, []);

  const handleCosmicFixationChange = useCallback((value: number) => {
    const next = Number.isFinite(value) ? value : 0.45;
    setCosmicFixation(Math.max(0.25, Math.min(0.75, next)));
  }, []);

  const handleCosmicMinWordLengthChange = useCallback((value: number) => {
    const next = Number.isFinite(value) ? value : 4;
    setCosmicMinWordLength(Math.max(2, Math.min(12, Math.round(next))));
  }, []);

  const toggleCosmic = useCallback(() => {
    if (cosmicOpen) {
      setCosmicOpen(false);
      setCosmicPlaying(false);
      return;
    }

    if (cosmicWords.length === 0) {
      setStatus("No readable words in this document");
      return;
    }

    setCosmicIndex(0);
    setCosmicPlaying(false);
    setCosmicOpen(true);
  }, [cosmicOpen, cosmicWords.length, setStatus]);

  useEffect(() => {
    void (async () => {
      try {
        const draft = await invoke<string | null>("load_recovery_draft");
        const current = useDocumentStore.getState().document;
        if (draft && draft.trim().length > 0 && !current.path && current.content.length === 0) {
          markRecovered(draft);
          setStatus("Recovered unsaved draft");
        }
      } catch {
        setStatus("Ready");
      }
    })();
  }, [markRecovered, setStatus]);

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
    if (!workspaceFolder || !document.path) {
      return;
    }

    if (
      isPathInsideFolder(document.path, workspaceFolder) &&
      !workspaceFiles.some((file) => file.path === document.path)
    ) {
      void loadWorkspaceFolder(workspaceFolder);
    }
  }, [document.path, loadWorkspaceFolder, workspaceFiles, workspaceFolder]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const listener = (event: MediaQueryListEvent): void => {
      setIsNarrow(event.matches);
    };

    setIsNarrow(mediaQuery.matches);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const onMouseMove = (event: MouseEvent): void => {
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }
      const bounds = layout.getBoundingClientRect();
      const relativeX = event.clientX - bounds.left;
      const nextRatio = relativeX / Math.max(bounds.width, 1);
      setSplitRatio(Math.max(0.25, Math.min(0.75, nextRatio)));
    };

    const onMouseUp = (): void => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const dispose = bindShortcuts({
      onNew: () => {
        void createNewDocument();
      },
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

        void (async () => {
          const canContinue = await ensureCanReplaceDocument("opening the dropped file");
          if (!canContinue) {
            return;
          }
          await openDocumentAtPath(payload.paths![0]);
        })();
      })
      .then((unlisten) => {
        disposeDragDrop = unlisten;
      });

    return () => {
      if (disposeDragDrop) {
        disposeDragDrop();
      }
    };
  }, [ensureCanReplaceDocument, openDocumentAtPath]);

  useEffect(() => {
    const disposers: Array<() => void> = [];

    void listen<string>("menu://command", async (event) => {
      switch (event.payload) {
        case "new":
          await createNewDocument();
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
        case "export_logs":
          await exportLogs();
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
  }, [createNewDocument, exportLogs, openFromDialog, saveDocument]);

  const layoutStyle = useMemo(() => {
    if (isNarrow) {
      return undefined;
    }
    return {
      gridTemplateColumns: `${splitRatio}fr 8px ${1 - splitRatio}fr`
    };
  }, [isNarrow, splitRatio]);

  const showSidebar = workspaceFolder !== null || workspaceLoading;

  return (
    <div className="app-shell" data-reader-palette={readerPalette}>
      <TopBar
        path={document.path}
        dirty={document.dirty}
        status={status}
        error={error}
        readerPalette={readerPalette}
        ultraRead={ultraRead}
        cosmicOpen={cosmicOpen}
        onNew={() => {
          void createNewDocument();
        }}
        onOpen={() => {
          void openFromDialog();
        }}
        onOpenFolder={() => {
          void openFolderFromDialog();
        }}
        onSave={() => {
          void saveDocument(false, "manual");
        }}
        onSaveAs={() => {
          void saveDocument(true, "manual");
        }}
        onToggleCosmic={toggleCosmic}
        onReaderPaletteChange={handleReaderPaletteChange}
        onUltraReadEnabledChange={setUltraReadEnabled}
        onUltraReadFixationChange={handleUltraReadFixationChange}
        onUltraReadMinWordLengthChange={handleUltraReadMinWordLengthChange}
        onUltraReadFocusWeightChange={handleUltraReadFocusWeightChange}
      />

      <section className={`workspace-shell${showSidebar ? " has-sidebar" : ""}`}>
        {showSidebar ? (
          <FileSidebar
            folderPath={workspaceFolder}
            files={workspaceFiles}
            activePath={document.path}
            loading={workspaceLoading}
            onOpenFolder={() => {
              void openFolderFromDialog();
            }}
            onRefreshFolder={() => {
              if (workspaceFolder) {
                void loadWorkspaceFolder(workspaceFolder);
              }
            }}
            onSelectFile={(path) => {
              void handleSidebarFileSelect(path);
            }}
          />
        ) : null}

        <main className="editor-layout" ref={layoutRef} style={layoutStyle}>
          <section className="pane pane-editor">
            <EditorPane
              value={document.content}
              targetScrollRatio={editorScrollTarget}
              onChange={setContent}
              onCursorLineChange={handleCursorLineChange}
              onScrollRatioChange={handleEditorScroll}
            />
          </section>
          <div
            className="pane-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            onMouseDown={() => setIsResizing(true)}
          />
          <section
            className="pane pane-preview"
            style={
              {
                "--bionic-focus-weight": String(Math.round(ultraRead.focusWeight))
              } as CSSProperties
            }
          >
            <PreviewPane
              html={previewHtml}
              activeBlockIndex={activeBlockIndex}
              targetScrollRatio={previewScrollTarget}
              onScrollRatioChange={handlePreviewScroll}
              onExternalLink={handleExternalLink}
              ultraReadEnabled={ultraRead.enabled}
            />
          </section>
        </main>
      </section>

      <CosmicFocusOverlay
        open={cosmicOpen}
        words={cosmicWords}
        currentIndex={cosmicIndex}
        isPlaying={cosmicPlaying}
        wpm={cosmicWpm}
        bionicEnabled={cosmicBionic}
        palette={cosmicPalette}
        wordSize={cosmicWordSize}
        baseWeight={cosmicBaseWeight}
        focusWeight={cosmicFocusWeight}
        fixation={cosmicFixation}
        minWordLength={cosmicMinWordLength}
        onClose={() => {
          setCosmicOpen(false);
          setCosmicPlaying(false);
        }}
        onTogglePlay={() => {
          if (cosmicWords.length === 0) {
            return;
          }
          setCosmicPlaying((current) => !current);
        }}
        onReset={() => {
          setCosmicIndex(0);
          setCosmicPlaying(false);
        }}
        onSeek={(index) => {
          setCosmicIndex(index);
        }}
        onWpmChange={(wpm) => {
          setCosmicWpm(Math.max(120, Math.min(900, Math.round(wpm))));
        }}
        onBionicChange={setCosmicBionic}
        onPaletteChange={handleCosmicPaletteChange}
        onWordSizeChange={handleCosmicWordSizeChange}
        onBaseWeightChange={handleCosmicBaseWeightChange}
        onFocusWeightChange={handleCosmicFocusWeightChange}
        onFixationChange={handleCosmicFixationChange}
        onMinWordLengthChange={handleCosmicMinWordLengthChange}
        renderWord={renderCosmicWord}
      />
    </div>
  );
}
