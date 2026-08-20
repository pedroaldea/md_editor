interface AsciiRailProps {
  libraryOpen: boolean;
  onLibrary: () => void;
  onOutline: () => void;
  onCommand: () => void;
}

export default function AsciiRail({ libraryOpen, onLibrary, onOutline, onCommand }: AsciiRailProps) {
  return (
    <nav className="ascii-rail" aria-label="Workspace navigation">
      <button
        type="button"
        className={`ascii-rail-item ascii-rail-library${libraryOpen ? " is-active" : ""}`}
        aria-pressed={libraryOpen}
        onClick={onLibrary}
      >
        <span className="ascii-rail-mark" aria-hidden="true">+</span>
        <span>Library</span>
      </button>
      <button type="button" className="ascii-rail-item ascii-rail-outline" onClick={onOutline}>
        <span className="ascii-rail-mark" aria-hidden="true">&gt;</span>
        <span>Outline</span>
      </button>
      <button type="button" className="ascii-rail-item ascii-rail-command" onClick={onCommand}>
        <span className="ascii-rail-mark" aria-hidden="true">:</span>
        <span>Command</span>
      </button>
    </nav>
  );
}
