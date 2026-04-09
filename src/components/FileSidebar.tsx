import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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

interface FileTreeNode {
  id: string;
  kind: "folder" | "file";
  name: string;
  relativePath: string;
  path?: string;
  children: FileTreeNode[];
  fileCount: number;
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

const createFolderNode = (id: string, name: string, relativePath: string): FileTreeNode => ({
  id,
  kind: "folder",
  name,
  relativePath,
  children: [],
  fileCount: 0
});

const sortTree = (nodes: FileTreeNode[]): void => {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
  });

  nodes.forEach((node) => {
    if (node.kind === "folder") {
      sortTree(node.children);
    }
  });
};

const annotateCounts = (node: FileTreeNode): number => {
  if (node.kind === "file") {
    node.fileCount = 1;
    return 1;
  }

  const total = node.children.reduce((sum, child) => sum + annotateCounts(child), 0);
  node.fileCount = total;
  return total;
};

const buildTree = (files: MarkdownFileEntry[]): FileTreeNode[] => {
  const root = createFolderNode("__root__", "", "");
  const folders = new Map<string, FileTreeNode>([["", root]]);

  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean);
    let current = root;
    let currentRelativePath = "";

    for (const segment of segments.slice(0, -1)) {
      currentRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment;
      let folder = folders.get(currentRelativePath);
      if (!folder) {
        folder = createFolderNode(currentRelativePath, segment, currentRelativePath);
        folders.set(currentRelativePath, folder);
        current.children.push(folder);
      }
      current = folder;
    }

    current.children.push({
      id: file.path,
      kind: "file",
      name: file.name,
      relativePath: file.relativePath,
      path: file.path,
      children: [],
      fileCount: 1
    });
  }

  sortTree(root.children);
  root.children.forEach((child) => {
    annotateCounts(child);
  });

  return root.children;
};

const folderAncestorsForPath = (relativePath: string | null): string[] => {
  if (!relativePath) {
    return [];
  }

  const segments = relativePath.split("/").filter(Boolean);
  const ancestors: string[] = [];
  let current = "";
  for (const segment of segments.slice(0, -1)) {
    current = current ? `${current}/${segment}` : segment;
    ancestors.push(current);
  }
  return ancestors;
};

const hasActiveDescendant = (node: FileTreeNode, activePath: string | null): boolean => {
  if (!activePath) {
    return false;
  }

  if (node.kind === "file") {
    return node.path === activePath;
  }

  return node.children.some((child) => hasActiveDescendant(child, activePath));
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
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => buildTree(files), [files]);
  const activeRelativePath = useMemo(
    () => files.find((file) => file.path === activePath)?.relativePath ?? null,
    [activePath, files]
  );

  useEffect(() => {
    const requiredOpenFolders = new Set<string>([
      ...tree.filter((node) => node.kind === "folder").map((node) => node.id),
      ...folderAncestorsForPath(activeRelativePath)
    ]);

    setExpandedFolders((current) => {
      const next = { ...current };
      requiredOpenFolders.forEach((folderId) => {
        if (next[folderId] === undefined) {
          next[folderId] = true;
        }
      });
      return next;
    });
  }, [activeRelativePath, tree]);

  const toggleFolder = (folderId: string): void => {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !current[folderId]
    }));
  };

  const renderNode = (node: FileTreeNode, depth: number) => {
    const indent = 12 + depth * 16;

    if (node.kind === "folder") {
      const expanded = expandedFolders[node.id] !== false;
      const activeBranch = hasActiveDescendant(node, activePath);

      return (
        <div key={node.id} className="file-tree-node">
          <button
            type="button"
            className={`tree-folder-button${activeBranch ? " is-active-branch" : ""}`}
            style={{ "--tree-indent": `${indent}px` } as CSSProperties}
            onClick={() => toggleFolder(node.id)}
            aria-expanded={expanded}
            title={node.relativePath}
          >
            <span className={`tree-chevron${expanded ? " is-open" : ""}`}>{">"}</span>
            <span className="tree-folder-name">{node.name}</span>
            <span className="tree-folder-count">{node.fileCount}</span>
          </button>
          {expanded ? <div className="tree-folder-children">{node.children.map((child) => renderNode(child, depth + 1))}</div> : null}
        </div>
      );
    }

    return (
      <button
        key={node.id}
        type="button"
        className={`tree-file-button${node.path === activePath ? " is-active" : ""}`}
        style={{ "--tree-indent": `${indent + 18}px` } as CSSProperties}
        onClick={() => onSelectFile(node.path ?? node.id)}
        title={node.relativePath}
      >
        <span className="tree-file-name">{node.name}</span>
      </button>
    );
  };

  return (
    <aside className="file-sidebar">
      <div className="file-sidebar-header">
        <div className="file-sidebar-title">
          <div>
            <h2>Workspace</h2>
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
        </div>
        {folderPath ? (
          <input
            className="sidebar-search-input"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search text in workspace..."
            aria-label="Search markdown files in workspace"
          />
        ) : null}
      </div>

      <div className="file-sidebar-list">
        {!folderPath ? (
          <p className="file-sidebar-empty">Open a folder to browse Markdown and text files.</p>
        ) : null}
        {folderPath && loading ? <p className="file-sidebar-empty">Loading files...</p> : null}
        {folderPath && !loading && files.length === 0 ? (
          <p className="file-sidebar-empty">No `.md`, `.markdown`, or `.txt` files found.</p>
        ) : null}

        {folderPath && !loading && files.length > 0 ? (
          <section className="file-sidebar-section">
            <div className="file-sidebar-section-header">
              <h3>Files</h3>
              <span>{files.length}</span>
            </div>
            <div className="file-tree">{tree.map((node) => renderNode(node, 0))}</div>
          </section>
        ) : null}

        {folderPath && searchQuery.trim().length > 0 ? (
          <section className="file-sidebar-section search-results">
            <div className="file-sidebar-section-header">
              <h3>Content Matches</h3>
              <span>{searching ? "..." : searchHits.length}</span>
            </div>
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
          </section>
        ) : null}
      </div>
    </aside>
  );
}
