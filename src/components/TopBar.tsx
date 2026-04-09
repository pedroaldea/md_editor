import type { MouseEvent } from "react";
import type { AppError, EditorViewMode, ReaderPalette, UltraReadConfig } from "../types/app";

interface TopBarProps {
  path: string | null;
  dirty: boolean;
  status: string;
  error: AppError | null;
  viewMode: EditorViewMode;
  readerPalette: ReaderPalette;
  ultraRead: UltraReadConfig;
  focusMode: boolean;
  checklistLabel: string | null;
  cosmicOpen: boolean;
  sidebarAvailable: boolean;
  sidebarCollapsed: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onInsertImage: () => void;
  onOpenCommandPalette: () => void;
  onOpenExport: () => void;
  onOpenHistory: () => void;
  onOpenUserGuide: () => void;
  onValidateLinks: () => void;
  onFormatTables: () => void;
  onViewModeChange: (viewMode: EditorViewMode) => void;
  onToggleFocusMode: () => void;
  onToggleCosmic: () => void;
  onReaderPaletteChange: (palette: ReaderPalette) => void;
  onUltraReadEnabledChange: (enabled: boolean) => void;
  onUltraReadFixationChange: (fixation: number) => void;
  onUltraReadMinWordLengthChange: (minWordLength: number) => void;
  onUltraReadFocusWeightChange: (focusWeight: number) => void;
  onToggleSidebar: () => void;
}

const getDocumentName = (path: string | null): string => {
  if (!path) {
    return "Untitled.md";
  }
  const chunks = path.split("/");
  return chunks[chunks.length - 1] ?? path;
};

const closeDetailsMenu = (event: MouseEvent<HTMLButtonElement>): void => {
  const details = event.currentTarget.closest("details");
  if (details instanceof HTMLDetailsElement) {
    details.open = false;
  }
};

export default function TopBar({
  path,
  dirty,
  status,
  error,
  viewMode,
  readerPalette,
  ultraRead,
  focusMode,
  checklistLabel,
  cosmicOpen,
  sidebarAvailable,
  sidebarCollapsed,
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAs,
  onInsertImage,
  onOpenCommandPalette,
  onOpenExport,
  onOpenHistory,
  onOpenUserGuide,
  onValidateLinks,
  onFormatTables,
  onViewModeChange,
  onToggleFocusMode,
  onToggleCosmic,
  onReaderPaletteChange,
  onUltraReadEnabledChange,
  onUltraReadFixationChange,
  onUltraReadMinWordLengthChange,
  onUltraReadFocusWeightChange,
  onToggleSidebar
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-identity">
        <div className="top-left">
          <h1>Md Editor</h1>
          <p>
            {getDocumentName(path)}
            {dirty ? " • Unsaved" : ""}
          </p>
        </div>
        {checklistLabel ? <span className="checklist-chip">{checklistLabel}</span> : null}
      </div>

      <div className="top-cluster top-actions" aria-label="Document actions">
        <button type="button" onClick={onNew} title="New document">
          New
        </button>
        <button type="button" onClick={onOpen} title="Open file">
          Open
        </button>
        <button type="button" onClick={onSave} title="Save">
          Save
        </button>
        <button type="button" onClick={onOpenFolder} title="Open folder">
          Folder
        </button>
        {sidebarAvailable ? (
          <button
            type="button"
            className={!sidebarCollapsed ? "is-active" : ""}
            onClick={onToggleSidebar}
            title="Toggle file sidebar"
          >
            {sidebarCollapsed ? "Files" : "Hide Files"}
          </button>
        ) : null}
      </div>

      <div className="top-cluster top-view" aria-label="View controls">
        <span className="cluster-label">View</span>
        <div className="segmented-control" aria-label="Editor views">
          <button
            type="button"
            className={viewMode === "edit" ? "is-active" : ""}
            onClick={() => onViewModeChange("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={viewMode === "split" ? "is-active" : ""}
            onClick={() => onViewModeChange("split")}
          >
            Split
          </button>
          <button
            type="button"
            className={viewMode === "read" ? "is-active" : ""}
            onClick={() => onViewModeChange("read")}
          >
            Read
          </button>
        </div>
        <button
          type="button"
          className={focusMode ? "is-active" : ""}
          onClick={onToggleFocusMode}
          title="Hide chrome and keep the current view"
        >
          Focus
        </button>
      </div>

      <div className="top-cluster top-utilities" aria-label="Utilities">
        <span className="cluster-label">Tools</span>
        <button type="button" onClick={onInsertImage} title="Insert image">
          Image
        </button>
        <button type="button" onClick={onOpenExport} title="Export document">
          Export
        </button>
        <button type="button" onClick={onOpenHistory} title="Version history">
          History
        </button>
        <button type="button" onClick={onOpenCommandPalette} title="Command palette">
          Cmd+K
        </button>
        <details className="toolbar-menu" title="Reading tools">
          <summary>Reading</summary>
          <div className="toolbar-menu-list reader-menu-list">
            <label className="control-select" title="Reading palette">
              <span>Palette</span>
              <select
                value={readerPalette}
                onChange={(event) => onReaderPaletteChange(event.target.value as ReaderPalette)}
                aria-label="Reading palette"
              >
                <option value="void">Void</option>
                <option value="paper">Paper</option>
                <option value="mist">Mist</option>
              </select>
            </label>
            <button
              type="button"
              className={ultraRead.enabled ? "is-active" : ""}
              onClick={() => onUltraReadEnabledChange(!ultraRead.enabled)}
            >
              {ultraRead.enabled ? "Disable Bionic" : "Enable Bionic"}
            </button>
            <label className="control-slider" title={`Focus ${Math.round(ultraRead.fixation * 100)}%`}>
              <span>Focus</span>
              <input
                type="range"
                min={25}
                max={75}
                step={5}
                value={Math.round(ultraRead.fixation * 100)}
                onChange={(event) => onUltraReadFixationChange(Number(event.target.value) / 100)}
                aria-label="Bionic focus"
                disabled={!ultraRead.enabled}
              />
            </label>
            <label className="control-number" title="Minimum word length">
              <span>Min</span>
              <input
                type="number"
                min={2}
                max={12}
                step={1}
                value={ultraRead.minWordLength}
                onChange={(event) => onUltraReadMinWordLengthChange(Number(event.target.value))}
                aria-label="Bionic minimum word length"
                disabled={!ultraRead.enabled}
              />
            </label>
            <label className="control-slider" title={`Bionic weight ${Math.round(ultraRead.focusWeight)}`}>
              <span>Bold</span>
              <input
                type="range"
                min={560}
                max={900}
                step={10}
                value={Math.round(ultraRead.focusWeight)}
                onChange={(event) => onUltraReadFocusWeightChange(Number(event.target.value))}
                aria-label="Bionic boldness"
                disabled={!ultraRead.enabled}
              />
            </label>
          </div>
        </details>
        <details className="toolbar-menu" title="More tools">
          <summary>More</summary>
          <div className="toolbar-menu-list">
            <button
              type="button"
              onClick={(event) => {
                closeDetailsMenu(event);
                onSaveAs();
              }}
            >
              Save As
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeDetailsMenu(event);
                onValidateLinks();
              }}
            >
              Check Links
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeDetailsMenu(event);
                onFormatTables();
              }}
            >
              Format Tables
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeDetailsMenu(event);
                onOpenUserGuide();
              }}
            >
              User Guide
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeDetailsMenu(event);
                onToggleCosmic();
              }}
            >
              {cosmicOpen ? "Close Speed Reader" : "Open Speed Reader"}
            </button>
          </div>
        </details>
      </div>

      <div className={`top-status${error ? " is-error" : ""}`} aria-live="polite">
        <span>{error ? `Error: ${error.code}` : status}</span>
      </div>
    </header>
  );
}
