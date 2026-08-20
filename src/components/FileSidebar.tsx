import type { MarkdownFileEntry, SearchHit } from "../types/app";

interface HeadingEntry {
  level: number;
  text: string;
  line: number;
  slug: string;
}

interface FileSidebarProps {
  isModal?: boolean;
  folderPath: string | null;
  files: MarkdownFileEntry[];
  headings: HeadingEntry[];
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
  onSelectHeading: (line: number) => void;
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
  isModal = false,
  folderPath,
  files,
  headings,
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
  onSelectFile,
  onSelectHeading
}: FileSidebarProps) {
  return (
    <aside
      className="file-sidebar"
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal ? "true" : undefined}
      aria-labelledby={isModal ? "workspace-sidebar-title" : undefined}
      tabIndex={isModal ? -1 : undefined}
    >
      <div className="file-sidebar-header">
        <div>
          <h2 id="workspace-sidebar-title">Folder</h2>
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
        {headings.length > 0 ? (
          <section className="document-outline" aria-label="Document outline">
            <h3>Outline</h3>
            {headings.map((heading) => (
              <button
                key={`${heading.line}-${heading.slug}`}
                type="button"
                className="outline-item"
                style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 10 + 8}px` }}
                onClick={() => onSelectHeading(heading.line)}
                title={`Line ${heading.line}`}
              >
                <span>{heading.text}</span>
              </button>
            ))}
          </section>
        ) : null}

        {!folderPath ? <p className="file-sidebar-empty">Open a folder to browse Markdown and text files.</p> : null}
        {folderPath && loading ? <p className="file-sidebar-empty">Loading files...</p> : null}
        {folderPath && !loading && files.length === 0 ? (
          <p className="file-sidebar-empty">No `.md`, `.markdown`, or `.txt` files found.</p>
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
