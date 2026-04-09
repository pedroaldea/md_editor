export const hasProtocolPrefix = (value: string): boolean => /^[a-z][a-z\d+\-.]*:/iu.test(value);

export const normalizeFsPath = (value: string): string => value.replace(/\\/gu, "/");

export const collapseSegments = (value: string): string => {
  const normalized = normalizeFsPath(value);
  const absolute = normalized.startsWith("/");
  const segments = normalized.split("/");
  const collapsed: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (collapsed.length > 0) {
        collapsed.pop();
      }
      continue;
    }
    collapsed.push(segment);
  }

  if (absolute) {
    return `/${collapsed.join("/")}`;
  }
  return collapsed.join("/");
};

export const resolveRelativePath = (documentPath: string, linkPath: string): string => {
  if (linkPath.startsWith("/")) {
    return collapseSegments(linkPath);
  }

  const normalizedDocument = normalizeFsPath(documentPath);
  const separatorIndex = normalizedDocument.lastIndexOf("/");
  const baseDirectory = separatorIndex > 0 ? normalizedDocument.slice(0, separatorIndex) : "/";
  return collapseSegments(`${baseDirectory}/${linkPath}`);
};

export const pathToFileHref = (path: string): string => {
  const normalized = normalizeFsPath(path);
  return `file://${encodeURI(normalized).replace(/#/gu, "%23").replace(/\?/gu, "%3F")}`;
};
