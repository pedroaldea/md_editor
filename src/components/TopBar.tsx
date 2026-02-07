import type { AppError, ReaderPalette, UltraReadConfig } from "../types/app";

interface TopBarProps {
  path: string | null;
  dirty: boolean;
  status: string;
  error: AppError | null;
  readerPalette: ReaderPalette;
  ultraRead: UltraReadConfig;
  cosmicOpen: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onToggleCosmic: () => void;
  onReaderPaletteChange: (palette: ReaderPalette) => void;
  onUltraReadEnabledChange: (enabled: boolean) => void;
  onUltraReadFixationChange: (fixation: number) => void;
  onUltraReadMinWordLengthChange: (minWordLength: number) => void;
  onUltraReadFocusWeightChange: (focusWeight: number) => void;
}

const getDocumentName = (path: string | null): string => {
  if (!path) {
    return "Untitled.md";
  }
  const chunks = path.split("/");
  return chunks[chunks.length - 1] ?? path;
};

export default function TopBar({
  path,
  dirty,
  status,
  error,
  readerPalette,
  ultraRead,
  cosmicOpen,
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAs,
  onToggleCosmic,
  onReaderPaletteChange,
  onUltraReadEnabledChange,
  onUltraReadFixationChange,
  onUltraReadMinWordLengthChange,
  onUltraReadFocusWeightChange
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

      <div className="top-cluster top-actions" aria-label="File actions">
        <button type="button" onClick={onNew} title="New document">
          New
        </button>
        <button type="button" onClick={onOpen} title="Open file">
          Open
        </button>
        <button type="button" onClick={onOpenFolder} title="Open folder">
          Folder
        </button>
        <button type="button" onClick={onSave} title="Save">
          Save
        </button>
        <button type="button" onClick={onSaveAs} title="Save as">
          Save As
        </button>
      </div>

      <div className="top-cluster read-controls">
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
          className={ultraRead.enabled ? "is-active" : ""}
          onClick={() => onUltraReadEnabledChange(!ultraRead.enabled)}
          title="Toggle Ultra Read"
        >
          Ultra
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
        <button
          type="button"
          className={cosmicOpen ? "is-active" : ""}
          onClick={onToggleCosmic}
          title="Toggle Cosmic Focus"
        >
          Cosmic
        </button>
      </div>

      <div className="top-status" aria-live="polite">
        <span>{error ? `Error: ${error.code}` : status}</span>
      </div>
    </header>
  );
}
