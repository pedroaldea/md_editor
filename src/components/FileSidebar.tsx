import type { MarkdownFileEntry } from "../types/app";

interface FileSidebarProps {
  folderPath: string | null;
  files: MarkdownFileEntry[];
  activePath: string | null;
  loading: boolean;
  onOpenFolder: () => void;
  onRefreshFolder: () => void;
  onSelectFile: (path: string) => void;
}

const truncateFolder = (path: string | null): string => {
  if (!path) {
    return "No folder open";
  }
  if (path.length < 42) {
    return path;
  }
  return `...${path.slice(-39)}`;
};

export default function FileSidebar({
  folderPath,
  files,
  activePath,
  loading,
  onOpenFolder,
  onRefreshFolder,
  onSelectFile
}: FileSidebarProps) {
  return (
    <aside className="file-sidebar">
      <div className="file-sidebar-header">
        <div>
          <h2>Folder</h2>
          <p title={folderPath ?? undefined}>{truncateFolder(folderPath)}</p>
        </div>
        <div className="file-sidebar-actions">
          <button type="button" onClick={onOpenFolder}>
            Open
          </button>
          {folderPath ? (
            <button type="button" onClick={onRefreshFolder}>
              Refresh
            </button>
          ) : null}
        </div>
      </div>

      <div className="file-sidebar-list">
        {!folderPath ? <p className="file-sidebar-empty">Open a folder to browse Markdown files.</p> : null}
        {folderPath && loading ? <p className="file-sidebar-empty">Loading files...</p> : null}
        {folderPath && !loading && files.length === 0 ? (
          <p className="file-sidebar-empty">No `.md` or `.markdown` files found.</p>
        ) : null}
        {!loading &&
          files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`file-item${file.path === activePath ? " is-active" : ""}`}
              onClick={() => onSelectFile(file.path)}
              title={file.path}
            >
              <span className="file-item-name">{file.name}</span>
              <span className="file-item-path">{file.relativePath}</span>
            </button>
          ))}
      </div>
    </aside>
  );
}
