import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import CommandPalette from "./components/CommandPalette";
import CosmicFocusOverlay from "./components/CosmicFocusOverlay";
import EditorPane from "./components/EditorPane";
import ExportModal from "./components/ExportModal";
import FileSidebar from "./components/FileSidebar";
import HistoryModal from "./components/HistoryModal";
import LinkValidationModal from "./components/LinkValidationModal";
import PreviewPane from "./components/PreviewPane";
import TopBar from "./components/TopBar";
import UserGuideModal from "./components/UserGuideModal";
import { runPdfPrint } from "./lib/export";
import {
  applyBionicReading,
  extractHeadings,
  extractReadingWords,
  getBlockIndexForLine,
  getChecklistProgress,
  renderBionicWord,
  renderMarkdown
} from "./lib/markdown";
import { bindShortcuts } from "./lib/shortcuts";
import { formatMarkdownTables } from "./lib/tableFormatter";
import { useDocumentStore } from "./state/documentStore";
import type {
  AppError,
  CommandPaletteItem,
  ExportProfile,
  LinkValidationIssue,
  LinkValidationReport,
  MarkdownFileEntry,
  OpenDocumentResult,
  ReaderPalette,
  SaveResult,
  SavedImageAsset,
  SearchHit,
  SessionState,
  SnapshotEntry
} from "./types/app";

const MARKDOWN_FILTER = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];
const LOG_FILTER = [{ name: "Log", extensions: ["log", "txt"] }];
const HTML_FILTER = [{ name: "HTML", extensions: ["html"] }];

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

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

const isTextOpenablePath = (path: string): boolean => {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt");
};

const isImagePath = (path: string): boolean => {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".svg")
  );
};

const buildHtmlExport = (title: string, bodyHtml: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 2rem;
      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      line-height: 1.7;
      font-size: 16px;
      background: #0f1115;
      color: #e5ecf3;
    }
    main { max-width: 96ch; margin: 0 auto; }
    code, pre { font-family: "JetBrains Mono", "SF Mono", monospace; }
    pre {
      background: #111723;
      border-radius: 10px;
      padding: 12px;
      overflow: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #2f3948;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    a { color: #66d9ff; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
  </style>
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`;

export default function App() {
  const {
    document,
    status,
    error,
    readerPalette,
    ultraRead,
    setContent,
    loadDocument,
    loadDocumentDirty,
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
  const [currentPreviewScrollRatio, setCurrentPreviewScrollRatio] = useState<number | null>(null);
  const [currentEditorScrollRatio, setCurrentEditorScrollRatio] = useState<number | null>(null);
  const [targetCursorLine, setTargetCursorLine] = useState<number | null>(null);
  const [insertTextRequest, setInsertTextRequest] = useState<{ id: number; text: string } | null>(null);
  const insertRequestIdRef = useRef(0);

  const [saving, setSaving] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [readMode, setReadMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusPreviewOnly, setFocusPreviewOnly] = useState(false);

  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<MarkdownFileEntry[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchingWorkspace, setSearchingWorkspace] = useState(false);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [userGuideOpen, setUserGuideOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationIssues, setValidationIssues] = useState<LinkValidationIssue[]>([]);
  const [validationCheckedExternal, setValidationCheckedExternal] = useState(false);

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

  const [associatedPathHandled, setAssociatedPathHandled] = useState(false);
  const associatedPathOpenedRef = useRef(false);
  const sessionHydratedRef = useRef(false);

  const layoutRef = useRef<HTMLElement | null>(null);

  const rendered = useMemo(() => renderMarkdown(document.content), [document.content]);
  const previewHtml = useMemo(
    () => applyBionicReading(rendered.html, ultraRead),
    [rendered.html, ultraRead]
  );
  const cosmicWords = useMemo(() => extractReadingWords(document.content), [document.content]);
  const headings = useMemo(() => extractHeadings(document.content), [document.content]);
  const checklistProgress = useMemo(() => getChecklistProgress(document.content), [document.content]);

  const checklistLabel =
    checklistProgress.total > 0
      ? `Tasks ${checklistProgress.completed}/${checklistProgress.total} (${checklistProgress.percent}%)`
      : null;

  const queueInsertText = useCallback((text: string) => {
    insertRequestIdRef.current += 1;
    setInsertTextRequest({ id: insertRequestIdRef.current, text });
  }, []);

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
    setActiveBlockIndex((current) => Math.min(current, Math.max(0, rendered.blockCount - 1)));
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
    async (path: string, line?: number) => {
      try {
        const result = await invoke<OpenDocumentResult>("open_document", { path });
        loadDocument(result);
        await invoke("store_recovery_draft", { content: "" });
        setStatus(`Opened ${path.split("/").pop() ?? path}`);
        setError(null);
        if (typeof line === "number" && Number.isFinite(line)) {
          setTargetCursorLine(Math.max(1, Math.round(line)));
        }
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

  const runWorkspaceSearch = useCallback(async () => {
    if (!workspaceFolder || searchQuery.trim().length === 0) {
      setSearchHits([]);
      return;
    }

    setSearchingWorkspace(true);
    try {
      const hits = await invoke<SearchHit[]>("search_workspace", {
        directory: workspaceFolder,
        query: searchQuery,
        limit: 200
      });
      setSearchHits(hits);
    } catch (unknownError) {
      const appError = normalizeError(unknownError);
      setError(appError);
      setStatus("Workspace search failed");
    } finally {
      setSearchingWorkspace(false);
    }
  }, [searchQuery, setError, setStatus, workspaceFolder]);

  useEffect(() => {
    if (!workspaceFolder || searchQuery.trim().length === 0) {
      setSearchHits([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void runWorkspaceSearch();
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [runWorkspaceSearch, searchQuery, workspaceFolder]);

  const openFolderFromDialog = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      directory: true
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setSidebarCollapsed(false);
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
          try {
            await invoke("create_snapshot", {
              path: result.path,
              content: snapshot.content,
              reason
            });
          } catch {
            // Keep save successful even if snapshot fails.
          }
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
        try {
          await invoke("create_snapshot", {
            path: result.path,
            content: snapshot.content,
            reason: "manual"
          });
        } catch {
          // Keep save successful even if snapshot fails.
        }
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

  const handleOpenAssociatedPath = useCallback(
    async (path: string) => {
      if (!path) {
        return;
      }

      associatedPathOpenedRef.current = true;
      const currentPath = useDocumentStore.getState().document.path;
      if (currentPath === path) {
        return;
      }

      const canContinue = await ensureCanReplaceDocument("opening a file");
      if (!canContinue) {
        return;
      }

      await openDocumentAtPath(path);
    },
    [ensureCanReplaceDocument, openDocumentAtPath]
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

  const handleSearchHitSelect = useCallback(
    async (hit: SearchHit) => {
      const currentPath = useDocumentStore.getState().document.path;
      if (currentPath === hit.path) {
        setTargetCursorLine(hit.line);
        return;
      }

      const canContinue = await ensureCanReplaceDocument("opening search result");
      if (!canContinue) {
        return;
      }
      await openDocumentAtPath(hit.path, hit.line);
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
    setCurrentEditorScrollRatio(ratio);
    setPreviewScrollTarget(ratio);
  }, []);

  const handlePreviewScroll = useCallback((ratio: number) => {
    setCurrentPreviewScrollRatio(ratio);
    setEditorScrollTarget(ratio);
  }, []);

  const handleExternalLink = useCallback(async (href: string) => {
    try {
      await openExternal(href);
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }, []);

  const ensureDocumentPathForAssets = useCallback(async (): Promise<string | null> => {
    const current = useDocumentStore.getState().document;
    if (current.path) {
      return current.path;
    }

    const saved = await saveDocument(true, "manual");
    if (!saved) {
      setStatus("Save document first to attach images");
      return null;
    }

    return useDocumentStore.getState().document.path;
  }, [saveDocument, setStatus]);

  const handleClipboardImagePaste = useCallback(
    async (payload: { fileName: string; mimeType: string; base64Data: string }): Promise<string | null> => {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) {
        return null;
      }

      try {
        const asset = await invoke<SavedImageAsset>("save_image_asset", {
          document_path: documentPath,
          file_name: payload.fileName,
          mime_type: payload.mimeType,
          base64_data: payload.base64Data
        });
        setStatus(`Inserted ${asset.relativePath}`);

        const alt = payload.fileName
          .replace(/\.[^/.]+$/u, "")
          .replace(/[_-]+/gu, " ")
          .trim();
        return `![${alt || "image"}](${asset.relativePath})`;
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Could not save pasted image");
        return null;
      }
    },
    [ensureDocumentPathForAssets, setError, setStatus]
  );

  const insertImageFromPath = useCallback(
    async (sourcePath: string) => {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) {
        return;
      }

      const documentDir = documentPath.slice(0, Math.max(documentPath.lastIndexOf("/"), 0));
      try {
        let relativePath: string;

        if (sourcePath.startsWith(`${documentDir}/`) || sourcePath === documentDir) {
          relativePath = sourcePath.slice(documentDir.length + 1);
        } else {
          const imported = await invoke<SavedImageAsset>("import_image_asset", {
            document_path: documentPath,
            source_path: sourcePath
          });
          relativePath = imported.relativePath;
        }

        const fileName = sourcePath.split("/").pop() ?? "image";
        const alt = fileName.replace(/\.[^/.]+$/u, "").replace(/[_-]+/gu, " ").trim();
        queueInsertText(`![${alt || "image"}](${relativePath})`);
        setStatus(`Inserted ${relativePath}`);
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Could not import dropped image");
      }
    },
    [ensureDocumentPathForAssets, queueInsertText, setError, setStatus]
  );

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

  const focusWorkspaceSearch = useCallback(() => {
    const searchInput = window.document.querySelector<HTMLInputElement>(".sidebar-search-input");
    if (!searchInput) {
      return;
    }
    searchInput.focus();
    searchInput.select();
  }, []);

  const runValidateLinks = useCallback(
    async (checkExternal: boolean) => {
      if (!document.path) {
        setStatus("Open or save a document first");
        return;
      }

      try {
        const report = await invoke<LinkValidationReport>("validate_links", {
          document_path: document.path,
          markdown: document.content,
          check_external: checkExternal
        });

        setValidationIssues(report.issues);
        setValidationCheckedExternal(report.checkedExternal);
        setValidationOpen(true);
        setStatus(`Link validation finished (${report.issues.length} issue(s))`);
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Link validation failed");
      }
    },
    [document.content, document.path, setError, setStatus]
  );

  const openHistoryModal = useCallback(async () => {
    if (!document.path) {
      setStatus("Open or save a document first");
      return;
    }

    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const entries = await invoke<SnapshotEntry[]>("list_snapshots", {
        path: document.path
      });
      setSnapshots(entries);
    } catch (unknownError) {
      const appError = normalizeError(unknownError);
      setError(appError);
      setStatus("Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [document.path, setError, setStatus]);

  const restoreSnapshot = useCallback(
    async (snapshotId: string) => {
      if (!document.path) {
        return;
      }

      try {
        const restored = await invoke<OpenDocumentResult>("load_snapshot", {
          path: document.path,
          snapshot_id: snapshotId
        });

        loadDocumentDirty(restored);
        setStatus("Snapshot restored as unsaved draft");
        setHistoryOpen(false);
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Could not restore snapshot");
      }
    },
    [document.path, loadDocumentDirty, setError, setStatus]
  );

  const handleExportSelect = useCallback(
    async (profile: ExportProfile) => {
      setExportOpen(false);

      if (profile === "pdf-print") {
        const opened = await runPdfPrint();
        if (opened) {
          setStatus("Opened print dialog. Choose Save as PDF.");
          setError(null);
        } else {
          setStatus("Could not open the print dialog");
          setError({
            code: "IO",
            message: "Printing is unavailable in this environment."
          });
        }
        return;
      }

      const defaultBase = (document.path?.split("/").pop() ?? "Untitled").replace(/\.[^/.]+$/u, "");

      if (profile === "clean-markdown") {
        const selected = await saveDialog({
          defaultPath: `${defaultBase}.md`,
          filters: MARKDOWN_FILTER
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }

        try {
          await invoke("write_text_file", {
            path: selected,
            content: document.content
          });
          setStatus("Exported Markdown");
        } catch (unknownError) {
          const appError = normalizeError(unknownError);
          setError(appError);
          setStatus("Could not export Markdown");
        }
        return;
      }

      if (profile === "html") {
        const selected = await saveDialog({
          defaultPath: `${defaultBase}.html`,
          filters: HTML_FILTER
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }

        try {
          const html = buildHtmlExport(defaultBase, rendered.html);
          await invoke("write_text_file", {
            path: selected,
            content: html
          });
          setStatus("Exported HTML");
        } catch (unknownError) {
          const appError = normalizeError(unknownError);
          setError(appError);
          setStatus("Could not export HTML");
        }
      }
    },
    [document.content, document.path, rendered.html, setError, setStatus]
  );

  const formatTables = useCallback(() => {
    const formatted = formatMarkdownTables(document.content);
    if (formatted === document.content) {
      setStatus("No table changes needed");
      return;
    }
    setContent(formatted);
    setStatus("Tables formatted");
  }, [document.content, setContent, setStatus]);

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const actions: CommandPaletteItem[] = [
      {
        id: "action:new",
        type: "action",
        title: "New document",
        subtitle: "Create an empty markdown document",
        keywords: ["new", "file", "document"],
        run: async () => createNewDocument()
      },
      {
        id: "action:open",
        type: "action",
        title: "Open file",
        subtitle: "Choose a markdown file",
        keywords: ["open", "file"],
        run: async () => openFromDialog()
      },
      {
        id: "action:open-folder",
        type: "action",
        title: "Open folder",
        subtitle: "Load markdown workspace",
        keywords: ["folder", "workspace"],
        run: async () => openFolderFromDialog()
      },
      {
        id: "action:save",
        type: "action",
        title: "Save",
        subtitle: "Save current file",
        keywords: ["save"],
        run: async () => {
          await saveDocument(false, "manual");
        }
      },
      {
        id: "action:save-as",
        type: "action",
        title: "Save As",
        subtitle: "Save current file with a new name",
        keywords: ["save", "as"],
        run: async () => {
          await saveDocument(true, "manual");
        }
      },
      {
        id: "action:read",
        type: "action",
        title: readMode ? "Disable read mode" : "Enable read mode",
        keywords: ["read", "preview", "mode"],
        run: () => {
          setReadMode((current) => {
            const next = !current;
            if (next) {
              setFocusMode(false);
              setFocusPreviewOnly(false);
            }
            return next;
          });
        }
      },
      {
        id: "action:focus",
        type: "action",
        title: focusMode ? "Disable focus mode" : "Enable focus mode",
        keywords: ["focus", "writer", "mode"],
        run: () => {
          setFocusMode((current) => {
            const next = !current;
            if (next) {
              setReadMode(false);
              setFocusPreviewOnly(false);
            }
            return next;
          });
        }
      },
      {
        id: "action:export",
        type: "action",
        title: "Open export options",
        keywords: ["export", "html", "pdf"],
        run: () => setExportOpen(true)
      },
      {
        id: "action:history",
        type: "action",
        title: "Open version history",
        keywords: ["history", "snapshot", "restore"],
        run: async () => openHistoryModal()
      },
      {
        id: "action:user-guide",
        type: "action",
        title: "Open user guide",
        keywords: ["guide", "help", "how to"],
        run: () => setUserGuideOpen(true)
      },
      {
        id: "action:links-local",
        type: "action",
        title: "Check links (local)",
        keywords: ["link", "validate", "local"],
        run: async () => runValidateLinks(false)
      },
      {
        id: "action:links-external",
        type: "action",
        title: "Check links (local + external)",
        keywords: ["link", "validate", "external"],
        run: async () => runValidateLinks(true)
      },
      {
        id: "action:tables",
        type: "action",
        title: "Format tables",
        keywords: ["table", "format"],
        run: () => formatTables()
      },
      {
        id: "action:search",
        type: "action",
        title: "Focus workspace search",
        keywords: ["search", "workspace", "find"],
        run: () => focusWorkspaceSearch()
      },
      {
        id: "action:sidebar",
        type: "action",
        title: sidebarCollapsed ? "Show file sidebar" : "Hide file sidebar",
        keywords: ["sidebar", "files", "panel", "toggle"],
        run: () => {
          if (!workspaceFolder && !workspaceLoading) {
            return;
          }
          setSidebarCollapsed((current) => !current);
        }
      }
    ];

    const fileItems: CommandPaletteItem[] = workspaceFiles.map((file) => ({
      id: `file:${file.path}`,
      type: "file",
      title: file.name,
      subtitle: file.relativePath,
      keywords: ["file", "open", file.relativePath],
      run: async () => {
        await handleSidebarFileSelect(file.path);
      }
    }));

    const headingItems: CommandPaletteItem[] = headings.map((heading) => ({
      id: `heading:${heading.line}:${heading.slug}`,
      type: "heading",
      title: `${"#".repeat(heading.level)} ${heading.text}`,
      subtitle: `Line ${heading.line}`,
      keywords: ["heading", "jump", heading.slug, heading.text],
      run: () => {
        setTargetCursorLine(heading.line);
      }
    }));

    return [...actions, ...fileItems, ...headingItems];
  }, [
    createNewDocument,
    focusMode,
    focusWorkspaceSearch,
    formatTables,
    handleSidebarFileSelect,
    headings,
    openFolderFromDialog,
    openFromDialog,
    openHistoryModal,
    readMode,
    runValidateLinks,
    saveDocument,
    sidebarCollapsed,
    workspaceFolder,
    workspaceLoading,
    workspaceFiles
  ]);

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
    if (!focusMode) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      setFocusMode(false);
      setFocusPreviewOnly(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  useEffect(() => {
    if (!isResizing || readMode || focusMode) {
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
  }, [focusMode, isResizing, readMode]);

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
      },
      onCommandPalette: () => {
        setCommandPaletteOpen(true);
      },
      onWorkspaceSearch: () => {
        focusWorkspaceSearch();
      }
    });

    return dispose;
  }, [createNewDocument, focusWorkspaceSearch, openFromDialog, saveDocument]);

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
    if (!isTauriRuntime()) {
      return;
    }

    let disposeDragDrop: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload as { type: string; paths?: string[] };
        if (payload.type !== "drop" || !payload.paths || payload.paths.length === 0) {
          return;
        }

        const droppedPath = payload.paths[0];

        void (async () => {
          if (isImagePath(droppedPath)) {
            await insertImageFromPath(droppedPath);
            return;
          }

          if (!isTextOpenablePath(droppedPath)) {
            setStatus("Unsupported dropped file type");
            return;
          }

          const canContinue = await ensureCanReplaceDocument("opening the dropped file");
          if (!canContinue) {
            return;
          }
          await openDocumentAtPath(droppedPath);
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
  }, [ensureCanReplaceDocument, insertImageFromPath, openDocumentAtPath, setStatus]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

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

  useEffect(() => {
    if (!isTauriRuntime()) {
      setAssociatedPathHandled(true);
      return;
    }

    const disposers: Array<() => void> = [];

    void listen<string>("app://open-path", (event) => {
      associatedPathOpenedRef.current = true;
      void handleOpenAssociatedPath(event.payload);
    }).then((dispose) => {
      disposers.push(dispose);
    });

    void invoke<string | null>("take_pending_open_path")
      .then((path) => {
        if (path) {
          associatedPathOpenedRef.current = true;
          void handleOpenAssociatedPath(path);
        }
      })
      .catch(() => {
        // no-op
      })
      .finally(() => {
        setAssociatedPathHandled(true);
      });

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [handleOpenAssociatedPath]);

  useEffect(() => {
    if (!associatedPathHandled || sessionHydratedRef.current) {
      return;
    }

    void (async () => {
      try {
        const state = await invoke<SessionState | null>("load_session_state");
        if (!state) {
          return;
        }

        setReaderPalette(state.readerPalette);
        setUltraReadEnabled(state.ultraReadEnabled);
        setUltraReadFixation(state.ultraReadFixation);
        setUltraReadMinWordLength(state.ultraReadMinWordLength);
        setUltraReadFocusWeight(state.ultraReadFocusWeight);

        setReadMode(state.readMode);
        setFocusMode(state.focusMode);
        setFocusPreviewOnly(state.focusPreviewOnly);
        setSplitRatio(Math.max(0.25, Math.min(0.75, state.splitRatio || 0.5)));

        setCosmicOpen(state.cosmicOpen);
        setCosmicPlaying(state.cosmicPlaying);
        setCosmicWpm(state.cosmicWpm);
        setCosmicIndex(state.cosmicIndex);
        setCosmicBionic(state.cosmicBionic);
        setCosmicPalette(state.cosmicPalette);
        setCosmicWordSize(state.cosmicWordSize);
        setCosmicBaseWeight(state.cosmicBaseWeight);
        setCosmicFocusWeight(state.cosmicFocusWeight);
        setCosmicFixation(state.cosmicFixation);
        setCosmicMinWordLength(state.cosmicMinWordLength);

        setActiveBlockIndex(state.activeBlockIndex);
        setPreviewScrollTarget(state.previewScrollRatio);
        setEditorScrollTarget(state.editorScrollRatio);
        setCurrentPreviewScrollRatio(state.previewScrollRatio);
        setCurrentEditorScrollRatio(state.editorScrollRatio);

        if (state.workspaceFolder) {
          await loadWorkspaceFolder(state.workspaceFolder);
        }

        if (!associatedPathOpenedRef.current && state.activePath) {
          await openDocumentAtPath(state.activePath);

          if (state.draftContent && state.draftContent !== useDocumentStore.getState().document.content) {
            setContent(state.draftContent);
          }
        } else if (!associatedPathOpenedRef.current && !state.activePath && state.draftContent) {
          newDocument();
          setContent(state.draftContent);
        }
      } catch {
        // session restore is best-effort
      } finally {
        sessionHydratedRef.current = true;
      }
    })();
  }, [
    associatedPathHandled,
    loadWorkspaceFolder,
    newDocument,
    openDocumentAtPath,
    setContent,
    setReaderPalette,
    setUltraReadEnabled,
    setUltraReadFixation,
    setUltraReadFocusWeight,
    setUltraReadMinWordLength
  ]);

  useEffect(() => {
    if (!sessionHydratedRef.current) {
      return;
    }

    const sessionState: SessionState = {
      workspaceFolder,
      activePath: document.path,
      draftContent: document.dirty ? document.content : null,
      readMode,
      focusMode,
      focusPreviewOnly,
      splitRatio,
      readerPalette,
      ultraReadEnabled: ultraRead.enabled,
      ultraReadFixation: ultraRead.fixation,
      ultraReadMinWordLength: ultraRead.minWordLength,
      ultraReadFocusWeight: ultraRead.focusWeight,
      cosmicOpen,
      cosmicPlaying,
      cosmicWpm,
      cosmicIndex,
      cosmicBionic,
      cosmicPalette,
      cosmicWordSize,
      cosmicBaseWeight,
      cosmicFocusWeight,
      cosmicFixation,
      cosmicMinWordLength,
      activeBlockIndex,
      previewScrollRatio: currentPreviewScrollRatio,
      editorScrollRatio: currentEditorScrollRatio
    };

    const timeout = window.setTimeout(() => {
      void invoke("save_session_state", { state: sessionState });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [
    activeBlockIndex,
    cosmicBaseWeight,
    cosmicBionic,
    cosmicFixation,
    cosmicFocusWeight,
    cosmicIndex,
    cosmicMinWordLength,
    cosmicOpen,
    cosmicPalette,
    cosmicPlaying,
    cosmicWpm,
    cosmicWordSize,
    currentEditorScrollRatio,
    currentPreviewScrollRatio,
    document.content,
    document.dirty,
    document.path,
    focusMode,
    focusPreviewOnly,
    readMode,
    readerPalette,
    splitRatio,
    ultraRead.enabled,
    ultraRead.fixation,
    ultraRead.focusWeight,
    ultraRead.minWordLength,
    workspaceFolder
  ]);

  const layoutStyle = useMemo(() => {
    if (isNarrow || readMode || focusMode) {
      return undefined;
    }
    return {
      gridTemplateColumns: `${splitRatio}fr 8px ${1 - splitRatio}fr`
    };
  }, [focusMode, isNarrow, readMode, splitRatio]);

  const sidebarAvailable = (workspaceFolder !== null || workspaceLoading) && !focusMode;
  const showSidebar = sidebarAvailable && !sidebarCollapsed;
  const showEditorPane = focusMode ? !focusPreviewOnly : !readMode;
  const showPreviewPane = focusMode ? focusPreviewOnly : true;

  return (
    <div className={`app-shell${focusMode ? " is-focus-mode" : ""}`} data-reader-palette={readerPalette}>
      {!focusMode ? (
        <TopBar
          path={document.path}
          dirty={document.dirty}
          status={status}
          error={error}
          readerPalette={readerPalette}
          ultraRead={ultraRead}
          readMode={readMode}
          focusMode={focusMode}
          checklistLabel={checklistLabel}
          cosmicOpen={cosmicOpen}
          sidebarAvailable={workspaceFolder !== null || workspaceLoading}
          sidebarCollapsed={sidebarCollapsed}
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
          onOpenCommandPalette={() => {
            setCommandPaletteOpen(true);
          }}
          onOpenExport={() => {
            setExportOpen(true);
          }}
          onOpenHistory={() => {
            void openHistoryModal();
          }}
          onOpenUserGuide={() => {
            setUserGuideOpen(true);
          }}
          onValidateLinks={() => {
            void runValidateLinks(false);
          }}
          onFormatTables={formatTables}
          onToggleReadMode={() => {
            setReadMode((current) => {
              const next = !current;
              if (next) {
                setFocusMode(false);
                setFocusPreviewOnly(false);
              }
              return next;
            });
          }}
          onToggleFocusMode={() => {
            setFocusMode((current) => {
              const next = !current;
              if (next) {
                setReadMode(false);
                setFocusPreviewOnly(false);
              }
              return next;
            });
          }}
          onToggleCosmic={toggleCosmic}
          onReaderPaletteChange={handleReaderPaletteChange}
          onUltraReadEnabledChange={setUltraReadEnabled}
          onUltraReadFixationChange={handleUltraReadFixationChange}
          onUltraReadMinWordLengthChange={handleUltraReadMinWordLengthChange}
          onUltraReadFocusWeightChange={handleUltraReadFocusWeightChange}
          onToggleSidebar={() => {
            setSidebarCollapsed((current) => !current);
          }}
        />
      ) : (
        <div className="focus-floating-controls">
          <button
            type="button"
            onClick={() => {
              setFocusPreviewOnly((current) => !current);
            }}
          >
            {focusPreviewOnly ? "Editor" : "Preview"}
          </button>
          <button type="button" onClick={() => setCommandPaletteOpen(true)}>
            Cmd+K
          </button>
          <button
            type="button"
            onClick={() => {
              setFocusMode(false);
              setFocusPreviewOnly(false);
            }}
          >
            Exit Focus
          </button>
        </div>
      )}

      <section className={`workspace-shell${showSidebar ? " has-sidebar" : ""}`}>
        {showSidebar ? (
          <FileSidebar
            folderPath={workspaceFolder}
            files={workspaceFiles}
            searchQuery={searchQuery}
            searchHits={searchHits}
            searching={searchingWorkspace}
            activePath={document.path}
            loading={workspaceLoading}
            onOpenFolder={() => {
              void openFolderFromDialog();
            }}
            onRefreshFolder={() => {
              if (workspaceFolder) {
                void loadWorkspaceFolder(workspaceFolder);
                if (searchQuery.trim().length > 0) {
                  void runWorkspaceSearch();
                }
              }
            }}
            onCollapse={() => {
              setSidebarCollapsed(true);
            }}
            onSearchQueryChange={setSearchQuery}
            onSelectSearchHit={(hit) => {
              void handleSearchHitSelect(hit);
            }}
            onSelectFile={(path) => {
              void handleSidebarFileSelect(path);
            }}
          />
        ) : null}

        <main className={`editor-layout${readMode ? " is-read-mode" : ""}`} ref={layoutRef} style={layoutStyle}>
          {showEditorPane ? (
            <section className="pane pane-editor">
              <EditorPane
                value={document.content}
                targetScrollRatio={editorScrollTarget}
                targetCursorLine={targetCursorLine}
                insertTextRequest={insertTextRequest}
                onChange={setContent}
                onCursorLineChange={handleCursorLineChange}
                onScrollRatioChange={handleEditorScroll}
                onClipboardImagePaste={handleClipboardImagePaste}
              />
            </section>
          ) : null}

          {showEditorPane && showPreviewPane ? (
            <div
              className="pane-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              onMouseDown={() => setIsResizing(true)}
            />
          ) : null}

          {showPreviewPane ? (
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
          ) : null}
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

      <CommandPalette
        open={commandPaletteOpen}
        items={commandPaletteItems}
        onClose={() => setCommandPaletteOpen(false)}
      />

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onSelect={(profile) => {
          void handleExportSelect(profile);
        }}
      />

      <HistoryModal
        open={historyOpen}
        snapshots={snapshots}
        loading={historyLoading}
        onClose={() => setHistoryOpen(false)}
        onRestore={(snapshotId) => {
          void restoreSnapshot(snapshotId);
        }}
      />

      <UserGuideModal open={userGuideOpen} onClose={() => setUserGuideOpen(false)} />

      <LinkValidationModal
        open={validationOpen}
        issues={validationIssues}
        checkedExternal={validationCheckedExternal}
        onClose={() => setValidationOpen(false)}
        onJumpToLine={(line) => {
          setValidationOpen(false);
          setTargetCursorLine(Math.max(1, Math.round(line)));
        }}
      />
    </div>
  );
}
