import type { MouseEvent } from "react";
import type { AppError, ReaderPalette, UltraReadConfig } from "../types/app";

interface TopBarProps {
  path: string | null;
  dirty: boolean;
  status: string;
  error: AppError | null;
  readerPalette: ReaderPalette;
  ultraRead: UltraReadConfig;
  readMode: boolean;
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
  onOpenCommandPalette: () => void;
  onOpenExport: () => void;
  onOpenHistory: () => void;
  onOpenUserGuide: () => void;
  onValidateLinks: () => void;
  onFormatTables: () => void;
  onToggleReadMode: () => void;
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
  readerPalette,
  ultraRead,
  readMode,
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
  onOpenCommandPalette,
  onOpenExport,
  onOpenHistory,
  onOpenUserGuide,
  onValidateLinks,
  onFormatTables,
  onToggleReadMode,
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
      <div className="top-left">
        <h1>Md Editor</h1>
        <p>
          {getDocumentName(path)}
          {dirty ? " • Unsaved" : ""}
        </p>
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
        <button type="button" onClick={onOpenCommandPalette} title="Command palette">
          Cmd+K
        </button>
      </div>

      <div className="top-cluster read-controls" aria-label="Reading controls">
        <label className="control-select" title="Reader palette">
          <span>Palette</span>
          <select
            value={readerPalette}
            onChange={(event) => onReaderPaletteChange(event.target.value as ReaderPalette)}
            aria-label="Reader palette"
          >
            <option value="void">Void</option>
            <option value="paper">Paper</option>
            <option value="mist">Mist</option>
          </select>
        </label>
        <button
          type="button"
          className={readMode ? "is-active" : ""}
          onClick={onToggleReadMode}
          title="Toggle read mode"
        >
          Read
        </button>
        <button
          type="button"
          className={focusMode ? "is-active" : ""}
          onClick={onToggleFocusMode}
          title="Toggle writer focus mode"
        >
          Focus
        </button>
        <button
          type="button"
          className={ultraRead.enabled ? "is-active" : ""}
          onClick={() => onUltraReadEnabledChange(!ultraRead.enabled)}
          title="Toggle Ultra Read"
        >
          Ultra
        </button>
        <details className="toolbar-menu" title="Reader settings">
          <summary>Reader</summary>
          <div className="toolbar-menu-list reader-menu-list">
            <label className="control-slider" title={`Focus ${Math.round(ultraRead.fixation * 100)}%`}>
              <span>Focus</span>
              <input
                type="range"
                min={25}
                max={75}
                step={5}
                value={Math.round(ultraRead.fixation * 100)}
                onChange={(event) => onUltraReadFixationChange(Number(event.target.value) / 100)}
                aria-label="Ultra read focus"
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
                aria-label="Ultra read minimum word length"
                disabled={!ultraRead.enabled}
              />
            </label>
            <label
              className="control-slider"
              title={`Bionic weight ${Math.round(ultraRead.focusWeight)}`}
            >
              <span>Bold</span>
              <input
                type="range"
                min={560}
                max={900}
                step={10}
                value={Math.round(ultraRead.focusWeight)}
                onChange={(event) => onUltraReadFocusWeightChange(Number(event.target.value))}
                aria-label="Ultra read bionic boldness"
                disabled={!ultraRead.enabled}
              />
            </label>
          </div>
        </details>
        {checklistLabel ? <span className="checklist-chip">{checklistLabel}</span> : null}
      </div>

      <div className="top-cluster top-utilities" aria-label="Utilities">
        <button type="button" onClick={onOpenExport} title="Export document">
          Export
        </button>
        <button type="button" onClick={onOpenHistory} title="Version history">
          History
        </button>
        <details className="toolbar-menu" title="More tools">
          <summary>More</summary>
          <div className="toolbar-menu-list">
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
                onSaveAs();
              }}
            >
              Save As
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeDetailsMenu(event);
                onOpenFolder();
              }}
            >
              Open Folder
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
                onToggleCosmic();
              }}
            >
              {cosmicOpen ? "Close Cosmic Focus" : "Open Cosmic Focus"}
            </button>
          </div>
        </details>
      </div>

      <div className="top-status" aria-live="polite">
        <span>{error ? `Error: ${error.code}` : status}</span>
      </div>
    </header>
  );
}
