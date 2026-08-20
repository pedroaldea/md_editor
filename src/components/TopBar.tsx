import { useMemo } from "react";
import type { AppError, ThemeMode, UltraReadConfig } from "../types/app";

export type ViewMode = "edit" | "split" | "read";

interface TopBarProps {
  path: string | null;
  dirty: boolean;
  status: string;
  error: AppError | null;
  themeMode?: ThemeMode;
  ultraRead: UltraReadConfig;
  viewMode: ViewMode;
  focusMode: boolean;
  checklistLabel: string | null;
  sidebarAvailable: boolean;
  sidebarCollapsed: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenCommandPalette: () => void;
  onOpenExport: () => void;
  onOpenQuickRead?: () => void;
  onOpenHistory: () => void;
  onValidateLinks: () => void;
  onFormatTables: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleFocusMode: () => void;
  onThemeModeChange?: (themeMode: ThemeMode) => void;
  onUltraReadEnabledChange: (enabled: boolean) => void;
  onUltraReadFixationChange: (fixation: number) => void;
  onUltraReadMinWordLengthChange: (minWordLength: number) => void;
  onUltraReadFocusWeightChange: (focusWeight: number) => void;
  onToggleSidebar: () => void;
  content?: string;
}

const getDocumentName = (path: string | null): string => {
  if (!path) return "untitled.md";
  const chunks = path.split("/");
  return chunks[chunks.length - 1] ?? path;
};

const formatCount = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

export default function TopBar({
  path,
  dirty,
  status,
  error,
  themeMode = "dark",
  ultraRead,
  viewMode,
  focusMode,
  checklistLabel,
  sidebarAvailable,
  sidebarCollapsed,
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAs,
  onOpenCommandPalette,
  onOpenExport,
  onOpenQuickRead = () => undefined,
  onOpenHistory,
  onValidateLinks,
  onFormatTables,
  onViewModeChange,
  onToggleFocusMode,
  onThemeModeChange = () => undefined,
  onUltraReadEnabledChange,
  onUltraReadFixationChange,
  onUltraReadMinWordLengthChange,
  onUltraReadFocusWeightChange,
  onToggleSidebar,
  content = ""
}: TopBarProps) {
  const isPdf = path?.toLowerCase().endsWith(".pdf") ?? false;
  const wordCount = useMemo(() => {
    const matches = content.match(/[\p{L}\p{N}\-']+/gu);
    return matches?.length ?? 0;
  }, [content]);
  const readTime = Math.max(1, Math.ceil(wordCount / 200));
  const visibleStatus = error
    ? `Error: ${error.code}`
    : dirty
      ? "Unsaved"
      : status.toLowerCase().includes("saving")
        ? "Saving"
        : "Saved";

  return (
    <header className="top-bar">
      <button
        type="button"
        className="mobile-menu-trigger"
        aria-label={sidebarCollapsed ? "Open navigation" : "Close navigation"}
        aria-expanded={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        [=]
      </button>

      <div className="top-document" title={path ?? undefined}>
        <strong>{getDocumentName(path)}</strong>
        <span aria-hidden="true">|</span>
        <span>{isPdf ? "PDF" : "Markdown"}</span>
      </div>

      <div className="top-context">
        <button
          type="button"
          className={`top-save-state${error ? " is-error" : dirty ? " is-dirty" : ""}`}
          onClick={onSave}
          disabled={isPdf}
          aria-live="polite"
          title={isPdf ? "PDFs are read-only" : "Save document"}
        >
          {visibleStatus}
        </button>
        {!isPdf ? <span>{formatCount(wordCount)} words · {readTime} min</span> : <span>document view</span>}
      </div>

      <nav className="view-switcher" aria-label="View mode">
        {isPdf ? (
          <button type="button" className="is-active" aria-label="PDF" aria-pressed="true">
            [pdf]
          </button>
        ) : (
          (["edit", "split", "read"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={viewMode === mode ? "is-active" : ""}
              aria-label={mode[0].toUpperCase() + mode.slice(1)}
              aria-pressed={viewMode === mode}
              onClick={() => onViewModeChange(mode)}
            >
              [{mode}]
            </button>
          ))
        )}
        {!isPdf ? (
          <button type="button" aria-label="PDF" title="Open a PDF" onClick={onOpen}>
            [pdf]
          </button>
        ) : null}
        <button
          type="button"
          className="theme-toggle"
          aria-label={`Theme: ${themeMode}`}
          onClick={() => onThemeModeChange(themeMode === "dark" ? "light" : "dark")}
        >
          [theme: {themeMode}]
        </button>
      </nav>

      <div className="top-utilities" aria-label="Utilities">
        <button type="button" onClick={onOpenCommandPalette} aria-label="Search commands">
          [search]
        </button>
        <details className="toolbar-menu top-more">
          <summary>[more]</summary>
          <div className="toolbar-menu-list">
            <span className="menu-heading">Document</span>
            <button type="button" onClick={onNew}>New</button>
            <button type="button" onClick={onOpen}>Open</button>
            <button type="button" onClick={onSaveAs} disabled={isPdf}>Save As</button>
            <button type="button" onClick={onOpenFolder}>Open Folder</button>
            <button type="button" onClick={onOpenExport}>Export</button>
            <span className="menu-heading">Reading</span>
            <button type="button" onClick={onOpenQuickRead} disabled={isPdf}>Quick read</button>
            <button type="button" className={ultraRead.enabled ? "is-active" : ""} onClick={() => onUltraReadEnabledChange(!ultraRead.enabled)} disabled={isPdf}>Bionic</button>
            <details className="comfort-settings">
              <summary>Comfort</summary>
              <div className="reader-settings-grid">
                <label>
                  <span>Focus {Math.round(ultraRead.fixation * 100)}%</span>
                  <input type="range" min={25} max={75} step={5} value={Math.round(ultraRead.fixation * 100)} onChange={(event) => onUltraReadFixationChange(Number(event.target.value) / 100)} disabled={!ultraRead.enabled} />
                </label>
                <label>
                  <span>Min word</span>
                  <input type="number" min={2} max={12} value={ultraRead.minWordLength} onChange={(event) => onUltraReadMinWordLengthChange(Number(event.target.value))} disabled={!ultraRead.enabled} />
                </label>
                <label>
                  <span>Weight</span>
                  <input type="range" min={560} max={900} step={10} value={ultraRead.focusWeight} onChange={(event) => onUltraReadFocusWeightChange(Number(event.target.value))} disabled={!ultraRead.enabled} />
                </label>
              </div>
            </details>
            <span className="menu-heading">Tools</span>
            <button type="button" onClick={onOpenHistory}>History</button>
            <button type="button" onClick={onValidateLinks}>Check Links</button>
            <button type="button" onClick={onFormatTables}>Format Tables</button>
            <button type="button" onClick={onToggleFocusMode}>{focusMode ? "Exit Focus" : "Focus"}</button>
            {sidebarAvailable ? <button type="button" onClick={onToggleSidebar}>{sidebarCollapsed ? "Files" : "Hide Files"}</button> : null}
            {checklistLabel ? <span className="menu-note">{checklistLabel}</span> : null}
          </div>
        </details>
      </div>

      <div className="top-status" aria-live="polite">{error ? `${error.code}: ${error.message}` : status}</div>
    </header>
  );
}
