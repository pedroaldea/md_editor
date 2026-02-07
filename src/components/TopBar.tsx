import type { AppError } from "../types/app";

interface TopBarProps {
  path: string | null;
  dirty: boolean;
  status: string;
  error: AppError | null;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
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
  onNew,
  onOpen,
  onSave,
  onSaveAs
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
      <div className="top-actions">
        <button type="button" onClick={onNew}>
          New
        </button>
        <button type="button" onClick={onOpen}>
          Open
        </button>
        <button type="button" onClick={onSave}>
          Save
        </button>
        <button type="button" onClick={onSaveAs}>
          Save As
        </button>
      </div>
      <div className="top-status" aria-live="polite">
        <span>{error ? `Error: ${error.code}` : status}</span>
      </div>
    </header>
  );
}
