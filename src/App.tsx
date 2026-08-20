import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import CommandPalette from "./components/CommandPalette";
import AsciiRail from "./components/AsciiRail";
import FileSidebar from "./components/FileSidebar";
import PreviewPane from "./components/PreviewPane";
import TopBar from "./components/TopBar";
import { buildHtmlExportDocument, runPdfPrint } from "./lib/export";
import {
  applyBionicReading,
  extractReadingWordsFromHtml,
  extractHeadings,
  getBlockIndexForLine,
  getChecklistProgress,
  renderMarkdown
} from "./lib/markdown";
import { bindShortcuts } from "./lib/shortcuts";
import { formatMarkdownTables } from "./lib/tableFormatter";
import { parsePdfAnnotationStore, serializePdfAnnotationStore, type PdfAnnotation } from "./lib/pdfAnnotations";
import { getLocalPreviewAsset, resolvePreviewImageSource } from "./lib/previewAssets";
import { useDocumentStore } from "./state/documentStore";
import type {
  AppError,
  CommandPaletteItem,
  ExportProfile,
  LinkValidationIssue,
  LinkValidationReport,
  MarkdownFileEntry,
  OpenDocumentResult,
  SaveResult,
  SavedImageAsset,
  SearchHit,
  SessionState,
  SnapshotEntry
} from "./types/app";

const MARKDOWN_FILTER = [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }];
const OPEN_FILTER = [{ name: "Markdown / PDF", extensions: ["md", "markdown", "txt", "pdf"] }];
const IMAGE_FILTER = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }];
const LOG_FILTER = [{ name: "Log", extensions: ["log", "txt"] }];
const SPLIT_DIVIDER_WIDTH = 8;
const HTML_FILTER = [{ name: "HTML", extensions: ["html"] }];

interface ReadingWordsCache {
  markdown: string;
  words: string[];
}

interface PreviewImageAssetPayload {
  mimeType: string;
  base64Data: string;
}

const isPdfPath = (path: string): boolean => path.toLowerCase().endsWith(".pdf");

const toPdfBytes = (payload: ArrayBuffer | Uint8Array | number[]): Uint8Array => {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload);
  throw new Error("Native PDF reader returned an invalid byte payload");
};

const ExportModal = lazy(() => import("./components/ExportModal"));
const HistoryModal = lazy(() => import("./components/HistoryModal"));
const LinkValidationModal = lazy(() => import("./components/LinkValidationModal"));
const QuickReadOverlay = lazy(() => import("./components/QuickReadOverlay"));
const EditorPane = lazy(() => import("./components/EditorPane"));
const PdfReaderPane = lazy(() => import("./components/PdfReaderPane"));

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

const hasProtocolPrefix = (value: string): boolean => /^[a-z][a-z\d+\-.]*:/iu.test(value);

const normalizeFsPath = (value: string): string => value.replace(/\\/gu, "/");

const collapseSegments = (value: string): string => {
  const normalized = normalizeFsPath(value);
  const absolute = normalized.startsWith("/");
  const segments = normalized.split("/");
  const collapsed: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (collapsed.length > 0) {
        collapsed.pop();
      }
      continue;
    }
    collapsed.push(segment);
  }

  if (absolute) {
    return `/${collapsed.join("/")}`;
  }
  return collapsed.join("/");
};

const resolveRelativePath = (documentPath: string, linkPath: string): string => {
  if (linkPath.startsWith("/")) {
    return collapseSegments(linkPath);
  }

  const normalizedDocument = normalizeFsPath(documentPath);
  const separatorIndex = normalizedDocument.lastIndexOf("/");
  const baseDirectory = separatorIndex > 0 ? normalizedDocument.slice(0, separatorIndex) : "/";
  return collapseSegments(`${baseDirectory}/${linkPath}`);
};

const isTextOpenablePath = (path: string): boolean => {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt");
};

const isOpenablePath = (path: string): boolean =>
  isTextOpenablePath(path) || isPdfPath(path);

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

export default function App() {
  const {
    document,
    status,
    error,
    themeMode,
    readerPalette,
    ultraRead,
    editorSettings,
    setContent,
    loadDocument,
    loadDocumentDirty,
    markSaved,
    markPersisted,
    markRecovered,
    newDocument,
    setThemeMode,
    setReaderPalette,
    setUltraReadEnabled,
    setUltraReadFixation,
    setUltraReadMinWordLength,
    setUltraReadFocusWeight,
    setEditorSettings,
    setStatus,
    setError
  } = useDocumentStore();

  const [activeBlockIndex, setActiveBlockIndex] = useState(0);
  const [previewScrollTarget, setPreviewScrollTarget] = useState<number | null>(null);
  const [editorScrollTarget, setEditorScrollTarget] = useState<number | null>(null);
  const [currentPreviewScrollRatio, setCurrentPreviewScrollRatio] = useState<number | null>(null);
  const [currentEditorScrollRatio, setCurrentEditorScrollRatio] = useState<number | null>(null);
  const [targetCursorLine, setTargetCursorLine] = useState<number | null>(null);
  const [currentCursorLine, setCurrentCursorLine] = useState(1);
  const [currentCursorColumn, setCurrentCursorColumn] = useState(1);
  const [insertTextRequest, setInsertTextRequest] = useState<{ id: number; text: string } | null>(null);
  const insertRequestIdRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const documentRevisionRef = useRef(0);

  const [saving, setSaving] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.542);
  const [isResizing, setIsResizing] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [readMode, setReadMode] = useState(false);
  const [editOnlyMode, setEditOnlyMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusPreviewOnly, setFocusPreviewOnly] = useState(false);
  const [quickReadOpen, setQuickReadOpen] = useState(false);
  const [quickReadWords, setQuickReadWords] = useState<string[]>([]);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfSource, setPdfSource] = useState<Uint8Array | null>(null);

  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<MarkdownFileEntry[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchingWorkspace, setSearchingWorkspace] = useState(false);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationIssues, setValidationIssues] = useState<LinkValidationIssue[]>([]);
  const [validationCheckedExternal, setValidationCheckedExternal] = useState(false);

  const [associatedPathHandled, setAssociatedPathHandled] = useState(false);
  const associatedPathOpenedRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const readingWordsCacheRef = useRef<ReadingWordsCache | null>(null);

  const layoutRef = useRef<HTMLElement | null>(null);

  const [previewSource, setPreviewSource] = useState(document.content);
  useEffect(() => {
    const delayMs = document.content.length >= 50_000 ? 180 : 40;
    const timeout = window.setTimeout(() => setPreviewSource(document.content), delayMs);
    return () => window.clearTimeout(timeout);
  }, [document.content]);
  const rendered = useMemo(() => renderMarkdown(previewSource), [previewSource]);
  const previewHtml = useMemo(
    () => applyBionicReading(rendered.html, ultraRead),
    [rendered.html, ultraRead]
  );
  const getQuickReadWords = useCallback((): string[] => {
    const markdown = document.content;
    const cached = readingWordsCacheRef.current;
    if (cached?.markdown === markdown) {
      return cached.words;
    }

    // The preview HTML is already sanitized. Reuse it unless the deferred preview
    // is still catching up with the latest editor change.
    const html = previewSource === markdown ? rendered.html : renderMarkdown(markdown).html;
    const words = extractReadingWordsFromHtml(html);
    readingWordsCacheRef.current = { markdown, words };
    return words;
  }, [document.content, previewSource, rendered.html]);
  const openQuickRead = useCallback((): void => {
    if (pdfPath) {
      setStatus("Quick read is available for Markdown documents");
      return;
    }

    const words = getQuickReadWords();
    if (words.length === 0) {
      setStatus("No readable words in this document");
      return;
    }

    setQuickReadWords(words);
    setQuickReadOpen(true);
  }, [getQuickReadWords, pdfPath, setStatus]);
  const loadPdfAnnotations = useCallback(async (path: string): Promise<PdfAnnotation[]> => {
    if (!isTauriRuntime()) return [];
    const raw = await invoke<string>("load_pdf_annotations", { path });
    return parsePdfAnnotationStore(raw).annotations;
  }, []);
  const savePdfAnnotations = useCallback(async (path: string, annotations: PdfAnnotation[]): Promise<void> => {
    if (!isTauriRuntime()) return;
    await invoke("save_pdf_annotations", {
      path,
      content: serializePdfAnnotationStore(annotations)
    });
  }, []);
  const headings = useMemo(() => extractHeadings(document.content), [document.content]);
  const checklistProgress = useMemo(() => getChecklistProgress(document.content), [document.content]);

  const checklistLabel =
    checklistProgress.total > 0
      ? `Tasks ${checklistProgress.completed}/${checklistProgress.total} (${checklistProgress.percent}%)`
      : null;

  useEffect(() => {
    documentRevisionRef.current += 1;
  }, [document.content]);

  const queueInsertText = useCallback((text: string) => {
    insertRequestIdRef.current += 1;
    setInsertTextRequest({ id: insertRequestIdRef.current, text });
  }, []);

  useEffect(() => {
    setActiveBlockIndex((current) => Math.min(current, Math.max(0, rendered.blockCount - 1)));
  }, [rendered.blockCount]);

  const openDocumentAtPath = useCallback(
    async (path: string, line?: number, silentFailure = false): Promise<boolean> => {
      if (isPdfPath(path)) {
        try {
          const source = isTauriRuntime()
            ? toPdfBytes(await invoke<ArrayBuffer | Uint8Array | number[]>("read_pdf_document", { path }))
            : null;
          setPdfSource(source);
          setPdfPath(path);
          setStatus(`Opened ${path.split("/").pop() ?? path}`);
          setError(null);
          return true;
        } catch (unknownError) {
          if (silentFailure) {
            setStatus("Ready");
            setError(null);
            return false;
          }
          setStatus("Could not open file");
          setError(normalizeError(unknownError));
          return false;
        }
      }

      setPdfPath(null);
      setPdfSource(null);
      try {
        const result = await invoke<OpenDocumentResult>("open_document", { path });
        loadDocument(result);
        await invoke("store_recovery_draft", { content: "" });
        setStatus(`Opened ${path.split("/").pop() ?? path}`);
        setError(null);
        if (typeof line === "number" && Number.isFinite(line)) {
          const safeLine = Math.max(1, Math.round(line));
          setTargetCursorLine(safeLine);
          setActiveBlockIndex(getBlockIndexForLine(result.content, safeLine));
        }
        return true;
      } catch (unknownError) {
        if (silentFailure) {
          setStatus("Ready");
          setError(null);
          return false;
        }
        const appError = normalizeError(unknownError);
        setStatus("Could not open file");
        setError(appError);
        return false;
      }
    },
    [loadDocument, setError, setStatus]
  );

  const jumpToDocumentLine = useCallback(
    (lineNumber: number): void => {
      const safeLine = Math.max(1, Math.round(lineNumber));
      setTargetCursorLine(safeLine);
      setActiveBlockIndex(getBlockIndexForLine(document.content, safeLine));
    },
    [document.content]
  );

  useEffect(() => {
    setActiveBlockIndex(0);
    setTargetCursorLine(null);
    setPreviewScrollTarget(0);
    setEditorScrollTarget(0);
    setCurrentPreviewScrollRatio(0);
    setCurrentEditorScrollRatio(0);
  }, [document.path]);

  const loadWorkspaceFolder = useCallback(
    async (folderPath: string, silentFailure = false): Promise<boolean> => {
      setWorkspaceLoading(true);
      try {
        const files = await invoke<MarkdownFileEntry[]>("list_markdown_files", {
          directory: folderPath
        });
        setWorkspaceFolder(folderPath);
        setWorkspaceFiles(files);
        setStatus(`Loaded ${files.length} files`);
        setError(null);
        return true;
      } catch (unknownError) {
        if (silentFailure) {
          setWorkspaceFolder(null);
          setWorkspaceFiles([]);
          setStatus("Ready");
          setError(null);
          return false;
        }
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Could not load folder");
        return false;
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
      if (pdfPath) {
        if (reason === "manual") {
          setStatus("PDFs are read-only in this editor");
        }
        return false;
      }

      if (saveInFlightRef.current) {
        return false;
      }

      saveInFlightRef.current = true;
      setSaving(true);
      const snapshot = useDocumentStore.getState().document;
      const snapshotRevision = documentRevisionRef.current;

      const commitSave = (result: SaveResult): void => {
        const current = useDocumentStore.getState().document;
        const unchanged = documentRevisionRef.current === snapshotRevision && current.content === snapshot.content;
        if (unchanged) {
          markSaved(result);
        } else {
          markPersisted(result);
          setStatus("Saved · newer edits pending");
        }
      };

      try {
        if (!forceSaveAs && snapshot.path) {
          const result = await invoke<SaveResult>("save_document", {
            path: snapshot.path,
            content: snapshot.content,
            expectedMtimeMs: snapshot.mtimeMs
          });
          commitSave(result);
          if (documentRevisionRef.current === snapshotRevision) {
            setStatus(reason === "autosave" ? "Autosaved" : "Saved");
          }
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
        commitSave(result);
        const saveAsUnchanged = documentRevisionRef.current === snapshotRevision;
        await invoke("store_recovery_draft", {
          content: saveAsUnchanged ? "" : useDocumentStore.getState().document.content
        });
        try {
          await invoke("create_snapshot", {
            path: result.path,
            content: snapshot.content,
            reason: "manual"
          });
        } catch {
          // Keep save successful even if snapshot fails.
        }
        if (saveAsUnchanged) {
          setStatus("Saved");
        }
        setError(null);
        return true;
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus(reason === "autosave" ? "Autosave failed" : "Save failed");
        return false;
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [markPersisted, markSaved, pdfPath, setError, setStatus]
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
      filters: OPEN_FILTER
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
    setPdfPath(null);
    setPdfSource(null);
    setStatus("New document");
    setError(null);
    await invoke("store_recovery_draft", { content: "" });
  }, [ensureCanReplaceDocument, newDocument, setError, setStatus]);

  const handleSidebarFileSelect = useCallback(
    async (path: string) => {
      const currentPath = pdfPath ?? useDocumentStore.getState().document.path;
      if (currentPath === path) {
        return;
      }

      const canContinue = await ensureCanReplaceDocument("switching files");
      if (!canContinue) {
        return;
      }
      await openDocumentAtPath(path);
    },
    [ensureCanReplaceDocument, openDocumentAtPath, pdfPath]
  );

  const handleSearchHitSelect = useCallback(
    async (hit: SearchHit) => {
      const currentPath = useDocumentStore.getState().document.path;
      if (currentPath === hit.path) {
        jumpToDocumentLine(hit.line);
        return;
      }

      const canContinue = await ensureCanReplaceDocument("opening search result");
      if (!canContinue) {
        return;
      }
      await openDocumentAtPath(hit.path, hit.line);
    },
    [ensureCanReplaceDocument, jumpToDocumentLine, openDocumentAtPath]
  );

  const handleCursorLineChange = useCallback(
    (lineNumber: number, columnNumber = 1) => {
      setCurrentCursorLine(lineNumber);
      setCurrentCursorColumn(columnNumber);
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

  const resolvePreviewImage = useCallback(
    (source: string): string =>
      resolvePreviewImageSource(
        source,
        document.path,
        isTauriRuntime() ? convertFileSrc : undefined
      ),
    [document.path]
  );

  const loadPreviewImageFallback = useCallback(
    async (source: string): Promise<string | null> => {
      if (!isTauriRuntime()) return null;
      const localAsset = getLocalPreviewAsset(source, document.path);
      if (!localAsset) return null;

      try {
        const image = await invoke<PreviewImageAssetPayload>("read_image_asset", {
          path: localAsset.absolutePath
        });
        return `data:${image.mimeType};base64,${image.base64Data}${localAsset.fragment}`;
      } catch {
        return null;
      }
    },
    [document.path]
  );

  const handleLocalLink = useCallback(
    async (href: string) => {
      const [withoutAnchor] = href.split("#");
      const [rawPath] = (withoutAnchor ?? "").split("?");
      const trimmedPath = (rawPath ?? "").trim();
      if (!trimmedPath || hasProtocolPrefix(trimmedPath)) {
        return;
      }

      let decodedPath = trimmedPath;
      try {
        decodedPath = decodeURIComponent(trimmedPath);
      } catch {
        // Keep original path if decoding fails.
      }

      const currentPath = useDocumentStore.getState().document.path;
      if (!currentPath) {
        setStatus("Open or save the current document before following local links");
        return;
      }

      const resolvedPath = resolveRelativePath(currentPath, decodedPath);
      if (!isOpenablePath(resolvedPath)) {
        setStatus("Only local .md, .markdown, .txt, and .pdf links are supported");
        return;
      }

      if (currentPath === resolvedPath) {
        return;
      }

      const canContinue = await ensureCanReplaceDocument("opening linked file");
      if (!canContinue) {
        return;
      }
      await openDocumentAtPath(resolvedPath);
    },
    [ensureCanReplaceDocument, openDocumentAtPath, setStatus]
  );

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
          documentPath,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          base64Data: payload.base64Data
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

  const createImageMarkdownFromPath = useCallback(
    async (sourcePath: string, suggestedAlt?: string): Promise<string | null> => {
      const documentPath = await ensureDocumentPathForAssets();
      if (!documentPath) {
        return null;
      }

      const normalizedDocumentPath = normalizeFsPath(documentPath);
      const normalizedSourcePath = normalizeFsPath(sourcePath);
      const separatorIndex = normalizedDocumentPath.lastIndexOf("/");
      const documentDir = separatorIndex > 0 ? normalizedDocumentPath.slice(0, separatorIndex) : "/";
      try {
        let relativePath: string;

        if (documentDir === "/" && normalizedSourcePath.startsWith("/")) {
          relativePath = normalizedSourcePath.slice(1);
        } else if (normalizedSourcePath.startsWith(`${documentDir}/`)) {
          relativePath = normalizedSourcePath.slice(documentDir.length + 1);
        } else {
          const imported = await invoke<SavedImageAsset>("import_image_asset", {
            documentPath,
            sourcePath
          });
          relativePath = imported.relativePath;
        }

        const fileName = normalizedSourcePath.split("/").pop() ?? "image";
        const inferredAlt = fileName.replace(/\.[^/.]+$/u, "").replace(/[_-]+/gu, " ").trim();
        const alt = suggestedAlt?.trim() || inferredAlt || "image";
        setStatus(`Inserted ${relativePath}`);
        return `![${alt}](${relativePath})`;
      } catch (unknownError) {
        const appError = normalizeError(unknownError);
        setError(appError);
        setStatus("Could not import image");
        return null;
      }
    },
    [ensureDocumentPathForAssets, setError, setStatus]
  );

  const insertImageFromPath = useCallback(
    async (sourcePath: string) => {
      const snippet = await createImageMarkdownFromPath(sourcePath);
      if (snippet) queueInsertText(snippet);
    },
    [createImageMarkdownFromPath, queueInsertText]
  );

  const chooseImageMarkdown = useCallback(
    async (suggestedAlt?: string): Promise<string | null> => {
      if (!isTauriRuntime()) {
        const alt = suggestedAlt?.trim() || "Alt text";
        setStatus("Inserted an image placeholder; choose the file path in Markdown");
        return `![${alt}](image.png)`;
      }

      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: IMAGE_FILTER
      });
      if (!selected || Array.isArray(selected)) {
        setStatus("Image insertion canceled");
        return null;
      }
      return createImageMarkdownFromPath(selected, suggestedAlt);
    },
    [createImageMarkdownFromPath, setStatus]
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
          documentPath: document.path,
          markdown: document.content,
          checkExternal
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
          snapshotId
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
          const html = buildHtmlExportDocument(defaultBase, rendered.html);
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
        title: readMode ? "Disable reading mode" : "Enable reading mode",
        keywords: ["reading", "read", "preview", "mode"],
        run: () => {
          setReadMode((current) => {
            const next = !current;
            if (next) {
              setFocusMode(false);
              setFocusPreviewOnly(false);
              setEditOnlyMode(false);
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
              setEditOnlyMode(false);
            }
            return next;
          });
        }
      },
      {
        id: "action:quick-read",
        type: "action",
        title: "Quick read",
        subtitle: "Read one word at a time",
        keywords: ["speed", "reader", "rsvp", "quick", "read"],
        run: openQuickRead
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
        jumpToDocumentLine(heading.line);
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
    jumpToDocumentLine,
    openFolderFromDialog,
    openFromDialog,
    openHistoryModal,
    openQuickRead,
    pdfPath,
    readMode,
    runValidateLinks,
    saveDocument,
    sidebarCollapsed,
    workspaceFolder,
    workspaceLoading,
    workspaceFiles
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

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
    if (!isTauriRuntime() || document.path) {
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
    if (!isNarrow || sidebarCollapsed) return;
    const trigger = window.document.activeElement;
    const sidebar = window.document.querySelector<HTMLElement>(".file-sidebar");
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = window.setTimeout(() => {
      sidebar?.querySelector<HTMLElement>(focusableSelector)?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarCollapsed(true);
        return;
      }

      if (event.key !== "Tab" || !sidebar) return;
      const focusable = [...sidebar.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.offsetParent !== null
      );
      if (focusable.length === 0) {
        event.preventDefault();
        sidebar.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = window.document.activeElement;
      if (event.shiftKey && (active === first || !sidebar.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusFirst);
      window.removeEventListener("keydown", onKeyDown);
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        window.setTimeout(() => trigger.focus(), 0);
      }
    };
  }, [isNarrow, sidebarCollapsed]);

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
    if (!isResizing || readMode || editOnlyMode || focusMode) {
      return;
    }

    const onPointerMove = (event: PointerEvent): void => {
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }
      const bounds = layout.getBoundingClientRect();
      const usableWidth = Math.max(bounds.width - SPLIT_DIVIDER_WIDTH, 1);
      const relativeX = event.clientX - bounds.left - SPLIT_DIVIDER_WIDTH / 2;
      const nextRatio = relativeX / usableWidth;
      setSplitRatio(Math.max(0.25, Math.min(0.75, nextRatio)));
    };

    const onPointerEnd = (): void => {
      setIsResizing(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [editOnlyMode, focusMode, isResizing, readMode]);

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

          if (!isOpenablePath(droppedPath)) {
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
        if (state.editorSettings) {
          setEditorSettings(state.editorSettings);
        }

        setReadMode(state.readMode);
        setEditOnlyMode(false);
        setFocusMode(state.focusMode);
        setFocusPreviewOnly(state.focusPreviewOnly);
        setSplitRatio(Math.max(0.25, Math.min(0.75, state.splitRatio || 0.5)));

        setActiveBlockIndex(state.activeBlockIndex);
        setPreviewScrollTarget(state.previewScrollRatio);
        setEditorScrollTarget(state.editorScrollRatio);
        setCurrentPreviewScrollRatio(state.previewScrollRatio);
        setCurrentEditorScrollRatio(state.editorScrollRatio);

        let repairedWorkspaceFolder = state.workspaceFolder;
        let repairedActivePath = state.activePath;
        let repairedDraftContent = state.draftContent;
        let repairedEditorActivePath = state.editorActivePath ?? null;
        let repairedEditorDraftContent = state.editorDraftContent ?? null;

        if (state.workspaceFolder) {
          const restoredWorkspace = await loadWorkspaceFolder(state.workspaceFolder, true);
          if (!restoredWorkspace) {
            repairedWorkspaceFolder = null;
          }
        }

        if (
          !associatedPathOpenedRef.current &&
          state.activePath &&
          isPdfPath(state.activePath)
        ) {
          if (state.editorActivePath) {
            const restoredEditor = await openDocumentAtPath(
              state.editorActivePath,
              undefined,
              true
            );
            if (!restoredEditor) {
              repairedEditorActivePath = null;
              if (state.editorDraftContent) {
                markRecovered(state.editorDraftContent);
                setStatus("Recovered editor draft behind PDF");
              } else {
                newDocument();
              }
            } else if (
              state.editorDraftContent &&
              state.editorDraftContent !== useDocumentStore.getState().document.content
            ) {
              setContent(state.editorDraftContent);
            }
          } else if (state.editorDraftContent) {
            markRecovered(state.editorDraftContent);
          } else {
            newDocument();
          }

          const restoredPdf = await openDocumentAtPath(state.activePath, undefined, true);
          if (!restoredPdf) {
            repairedActivePath = repairedEditorActivePath;
            repairedDraftContent = repairedEditorDraftContent;
          }
        } else if (!associatedPathOpenedRef.current && state.activePath) {
          const restored = await openDocumentAtPath(state.activePath, undefined, true);

          if (!restored) {
            repairedActivePath = null;
            if (state.draftContent) {
              markRecovered(state.draftContent);
              setStatus("Recovered unsaved draft from missing file");
            } else {
              repairedDraftContent = null;
            }
          }

          if (
            restored &&
            state.draftContent &&
            state.draftContent !== useDocumentStore.getState().document.content
          ) {
            setContent(state.draftContent);
          }
        } else if (!associatedPathOpenedRef.current && !state.activePath && state.draftContent) {
          newDocument();
          setContent(state.draftContent);
        }

        if (
          repairedWorkspaceFolder !== state.workspaceFolder ||
          repairedActivePath !== state.activePath ||
          repairedDraftContent !== state.draftContent ||
          repairedEditorActivePath !== (state.editorActivePath ?? null) ||
          repairedEditorDraftContent !== (state.editorDraftContent ?? null)
        ) {
          await invoke("save_session_state", {
            state: {
              ...state,
              workspaceFolder: repairedWorkspaceFolder,
              activePath: repairedActivePath,
              draftContent: repairedDraftContent,
              editorActivePath: repairedEditorActivePath,
              editorDraftContent: repairedEditorDraftContent
            }
          });
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
    markRecovered,
    newDocument,
    openDocumentAtPath,
    setContent,
    setReaderPalette,
    setUltraReadEnabled,
    setUltraReadFixation,
    setUltraReadFocusWeight,
    setUltraReadMinWordLength,
    setEditorSettings
  ]);

  useEffect(() => {
    if (!isTauriRuntime() || !sessionHydratedRef.current) {
      return;
    }

    const sessionState: SessionState = {
      workspaceFolder,
      activePath: pdfPath ?? document.path,
      draftContent: pdfPath ? null : document.dirty ? document.content : null,
      editorActivePath: document.path,
      editorDraftContent: document.dirty ? document.content : null,
      readMode,
      focusMode,
      focusPreviewOnly,
      splitRatio,
      readerPalette,
      ultraReadEnabled: ultraRead.enabled,
      ultraReadFixation: ultraRead.fixation,
      ultraReadMinWordLength: ultraRead.minWordLength,
      ultraReadFocusWeight: ultraRead.focusWeight,
      activeBlockIndex,
      previewScrollRatio: currentPreviewScrollRatio,
      editorScrollRatio: currentEditorScrollRatio,
      editorSettings
    };

    const timeout = window.setTimeout(() => {
      void invoke("save_session_state", { state: sessionState });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [
    activeBlockIndex,
    currentEditorScrollRatio,
    currentPreviewScrollRatio,
    document.content,
    document.dirty,
    document.path,
    editorSettings,
    focusMode,
    focusPreviewOnly,
    pdfPath,
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
    if (isNarrow || readMode || editOnlyMode || focusMode || pdfPath) {
      return undefined;
    }
    return {
      gridTemplateColumns: `${splitRatio}fr ${SPLIT_DIVIDER_WIDTH}px ${1 - splitRatio}fr`
    };
  }, [editOnlyMode, focusMode, isNarrow, pdfPath, readMode, splitRatio]);

  const sidebarAvailable = !focusMode;
  const showSidebar = sidebarAvailable && !sidebarCollapsed;
  const viewMode: "edit" | "split" | "read" = readMode ? "read" : editOnlyMode ? "edit" : "split";
  const showEditorPane = focusMode ? !focusPreviewOnly : !readMode;
  const showPreviewPane = focusMode ? focusPreviewOnly : !editOnlyMode;

  return (
    <div
      className={`app-shell${focusMode ? " is-focus-mode" : ""}${isResizing ? " is-resizing" : ""}`}
      data-theme={themeMode}
    >
      {!focusMode ? (
        <AsciiRail
          libraryOpen={showSidebar}
          onLibrary={() => setSidebarCollapsed((current) => !current)}
          onOutline={() => {
            setSidebarCollapsed(false);
            window.setTimeout(() => {
              window.document.querySelector<HTMLElement>(".outline-item")?.focus();
            }, 0);
          }}
          onCommand={() => setCommandPaletteOpen(true)}
        />
      ) : null}
      {!focusMode ? (
        <TopBar
          path={pdfPath ?? document.path}
          dirty={pdfPath ? false : document.dirty}
          status={status}
          error={error}
          themeMode={themeMode}
          ultraRead={ultraRead}
          viewMode={viewMode}
          focusMode={focusMode}
          checklistLabel={checklistLabel}
          sidebarAvailable={sidebarAvailable}
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
          onOpenQuickRead={openQuickRead}
          onOpenHistory={() => {
            void openHistoryModal();
          }}
          onValidateLinks={() => {
            void runValidateLinks(false);
          }}
          onFormatTables={formatTables}
          onViewModeChange={(mode) => {
            setReadMode(mode === "read");
            setEditOnlyMode(mode === "edit");
            setFocusMode(false);
            setFocusPreviewOnly(false);
          }}
          onToggleFocusMode={() => {
            setFocusMode((current) => {
              const next = !current;
              if (next) {
                setReadMode(false);
                setEditOnlyMode(false);
                setFocusPreviewOnly(false);
              }
              return next;
            });
          }}
          onThemeModeChange={setThemeMode}
          onUltraReadEnabledChange={setUltraReadEnabled}
          onUltraReadFixationChange={handleUltraReadFixationChange}
          onUltraReadMinWordLengthChange={handleUltraReadMinWordLengthChange}
          onUltraReadFocusWeightChange={handleUltraReadFocusWeightChange}
          onToggleSidebar={() => {
            setSidebarCollapsed((current) => !current);
          }}
          content={document.content}
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

      {isNarrow && showSidebar ? (
        <button
          type="button"
          className="mobile-sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarCollapsed(true)}
        />
      ) : null}

      <section className={`workspace-shell${showSidebar ? " has-sidebar" : ""}`}>
        {showSidebar ? (
          <FileSidebar
            isModal={isNarrow}
            folderPath={workspaceFolder}
            files={workspaceFiles}
            headings={headings}
            searchQuery={searchQuery}
            searchHits={searchHits}
            searching={searchingWorkspace}
            activePath={pdfPath ?? document.path}
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
            onSelectHeading={(line) => {
              jumpToDocumentLine(line);
            }}
          />
        ) : null}

        <main
          className={`editor-layout${readMode ? " is-read-mode" : ""}${editOnlyMode ? " is-edit-mode" : ""}${focusMode ? " is-focus-surface" : ""}${pdfPath ? " has-pdf" : ""}`}
          ref={layoutRef}
          style={layoutStyle}
        >
          {pdfPath ? (
            <Suspense fallback={<div className="pdf-reader-loading" role="status">Loading PDF reader…</div>}>
              <PdfReaderPane
                path={pdfPath}
                sourceUrl={pdfSource}
                onClose={() => {
                  setPdfPath(null);
                  setPdfSource(null);
                }}
                loadAnnotations={isTauriRuntime() ? loadPdfAnnotations : undefined}
                saveAnnotations={isTauriRuntime() ? savePdfAnnotations : undefined}
                onStatusChange={setStatus}
              />
            </Suspense>
          ) : null}
          {!pdfPath && showEditorPane ? (
            <section className="pane pane-editor">
              <div className="pane-label" aria-hidden="true">Write <strong>Markdown</strong></div>
              <Suspense fallback={<div className="pdf-reader-loading" role="status">Loading editor…</div>}>
                <EditorPane
                  value={document.content}
                  targetScrollRatio={editorScrollTarget}
                  targetCursorLine={targetCursorLine}
                  insertTextRequest={insertTextRequest}
                  onChange={setContent}
                  onCursorLineChange={handleCursorLineChange}
                  onScrollRatioChange={handleEditorScroll}
                  onClipboardImagePaste={handleClipboardImagePaste}
                  onImageRequest={chooseImageMarkdown}
                  settings={editorSettings}
                  themeMode={themeMode}
                />
              </Suspense>
            </section>
          ) : null}

          {!pdfPath && showEditorPane && showPreviewPane ? (
            <div
              className="pane-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(splitRatio * 100)}
              aria-valuetext={`Editor ${Math.round(splitRatio * 100)}%, preview ${Math.round((1 - splitRatio) * 100)}%`}
              tabIndex={0}
              onPointerDown={(event) => {
                if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsResizing(true);
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.05 : 0.02;
                let nextRatio: number | null = null;
                if (event.key === "ArrowLeft") nextRatio = splitRatio - step;
                if (event.key === "ArrowRight") nextRatio = splitRatio + step;
                if (event.key === "Home") nextRatio = 0.25;
                if (event.key === "End") nextRatio = 0.75;
                if (nextRatio === null) return;
                event.preventDefault();
                setSplitRatio(Math.max(0.25, Math.min(0.75, nextRatio)));
              }}
            />
          ) : null}

          {!pdfPath && showPreviewPane ? (
            <section
              className="pane pane-preview"
              style={
                {
                  "--bionic-focus-weight": String(Math.round(ultraRead.focusWeight))
                } as CSSProperties
              }
            >
              <div className="pane-label" aria-hidden="true">Read <strong>Live preview</strong></div>
              <PreviewPane
                html={previewHtml}
                activeBlockIndex={activeBlockIndex}
                targetScrollRatio={previewScrollTarget}
                onScrollRatioChange={handlePreviewScroll}
                onExternalLink={handleExternalLink}
                onLocalLink={handleLocalLink}
                resolveImageSource={resolvePreviewImage}
                loadImageFallback={loadPreviewImageFallback}
                themeMode={themeMode}
                ultraReadEnabled={ultraRead.enabled}
              />
            </section>
          ) : null}
        </main>
      </section>

      {!focusMode ? (
        <footer className="ascii-status-bar" aria-label="Document status">
          <span>{pdfPath ? "READ ONLY" : "INSERT"}</span>
          <span>{pdfPath ? "pdf" : "md"}</span>
          <span>utf-8</span>
          <span>LF</span>
          <span className="status-spacer" />
          {!pdfPath ? <span>Ln {currentCursorLine}, Col {currentCursorColumn}</span> : <span>PDF</span>}
          <span>{isNarrow ? "STACK" : `${Math.round(splitRatio * 100)}:${Math.round((1 - splitRatio) * 100)}`}</span>
          <span>100%</span>
        </footer>
      ) : null}

      <CommandPalette
        open={commandPaletteOpen}
        items={commandPaletteItems}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {quickReadOpen ? (
        <Suspense fallback={null}>
          <QuickReadOverlay
            open={quickReadOpen}
            words={quickReadWords}
            title={document.path?.split("/").pop() ?? "Untitled.md"}
            onClose={() => setQuickReadOpen(false)}
            onComplete={() => setStatus("Quick read complete")}
          />
        </Suspense>
      ) : null}

      {exportOpen ? (
        <Suspense fallback={null}>
          <ExportModal
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            onSelect={(profile) => {
              void handleExportSelect(profile);
            }}
          />
        </Suspense>
      ) : null}

      {historyOpen ? (
        <Suspense fallback={null}>
          <HistoryModal
            open={historyOpen}
            snapshots={snapshots}
            loading={historyLoading}
            onClose={() => setHistoryOpen(false)}
            onRestore={(snapshotId) => {
              void restoreSnapshot(snapshotId);
            }}
          />
        </Suspense>
      ) : null}

      {validationOpen ? (
        <Suspense fallback={null}>
          <LinkValidationModal
            open={validationOpen}
            issues={validationIssues}
            checkedExternal={validationCheckedExternal}
            onClose={() => setValidationOpen(false)}
            onJumpToLine={(line) => {
              setValidationOpen(false);
              jumpToDocumentLine(line);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
