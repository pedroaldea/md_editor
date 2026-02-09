import type { MarkdownFileEntry, SearchHit } from "../types/app";

interface FileSidebarProps {
  folderPath: string | null;
  files: MarkdownFileEntry[];
  searchQuery: string;
  searchHits: SearchHit[];
  searching: boolean;
  activePath: string | null;
  loading: boolean;
  onOpenFolder: () => void;
  onRefreshFolder: () => void;
  onCollapse: () => void;
  onSearchQueryChange: (value: string) => void;
  onSelectSearchHit: (hit: SearchHit) => void;
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
  searchQuery,
  searchHits,
  searching,
  activePath,
  loading,
  onOpenFolder,
  onRefreshFolder,
  onCollapse,
  onSearchQueryChange,
  onSelectSearchHit,
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
          <button type="button" onClick={onCollapse} title="Hide file sidebar">
            Hide
          </button>
        </div>
        {folderPath ? (
          <input
            className="sidebar-search-input"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search in workspace..."
            aria-label="Search markdown files in workspace"
          />
        ) : null}
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
        {folderPath && searchQuery.trim().length > 0 ? (
          <div className="search-results">
            <h3>Search Results</h3>
            {searching ? <p className="file-sidebar-empty">Searching...</p> : null}
            {!searching && searchHits.length === 0 ? (
              <p className="file-sidebar-empty">No matches found.</p>
            ) : null}
            {!searching &&
              searchHits.map((hit) => (
                <button
                  key={`${hit.path}-${hit.line}-${hit.snippet}`}
                  type="button"
                  className="search-hit"
                  onClick={() => onSelectSearchHit(hit)}
                >
                  <strong>{hit.relativePath}</strong>
                  <span>Line {hit.line}</span>
                  <span>{hit.snippet}</span>
                </button>
              ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
