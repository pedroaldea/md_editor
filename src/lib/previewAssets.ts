export type LocalAssetUrlConverter = (absolutePath: string) => string;

export interface LocalPreviewAsset {
  absolutePath: string;
  suffix: string;
  fragment: string;
}

const hasProtocolPrefix = (value: string): boolean => /^[a-z][a-z\d+\-.]*:/iu.test(value);

const normalizeFsPath = (value: string): string => value.replace(/\\/gu, "/");

const collapseSegments = (value: string): string => {
  const normalized = normalizeFsPath(value);
  const absolute = normalized.startsWith("/");
  const segments = normalized.split("/");
  const collapsed: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      collapsed.pop();
      continue;
    }
    collapsed.push(segment);
  }

  return absolute ? `/${collapsed.join("/")}` : collapsed.join("/");
};

export const resolveLocalAssetPath = (documentPath: string, assetPath: string): string => {
  if (assetPath.startsWith("/")) return collapseSegments(assetPath);

  const normalizedDocument = normalizeFsPath(documentPath);
  const separatorIndex = normalizedDocument.lastIndexOf("/");
  const baseDirectory = separatorIndex > 0 ? normalizedDocument.slice(0, separatorIndex) : "/";
  return collapseSegments(`${baseDirectory}/${assetPath}`);
};

export const getLocalPreviewAsset = (
  source: string,
  documentPath: string | null
): LocalPreviewAsset | null => {
  const trimmedSource = source.trim();
  if (
    !trimmedSource ||
    trimmedSource.startsWith("#") ||
    trimmedSource.startsWith("//") ||
    hasProtocolPrefix(trimmedSource)
  ) {
    return null;
  }

  const suffixIndex = trimmedSource.search(/[?#]/u);
  const encodedPath = suffixIndex >= 0 ? trimmedSource.slice(0, suffixIndex) : trimmedSource;
  const suffix = suffixIndex >= 0 ? trimmedSource.slice(suffixIndex) : "";
  const fragmentIndex = suffix.indexOf("#");
  const fragment = fragmentIndex >= 0 ? suffix.slice(fragmentIndex) : "";
  let decodedPath = encodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    // A malformed escape should not prevent the original filename from resolving.
  }

  if (!documentPath && !decodedPath.startsWith("/")) return null;
  return {
    absolutePath: decodedPath.startsWith("/")
      ? collapseSegments(decodedPath)
      : resolveLocalAssetPath(documentPath as string, decodedPath),
    suffix,
    fragment
  };
};

export const resolvePreviewImageSource = (
  source: string,
  documentPath: string | null,
  convertLocalAsset?: LocalAssetUrlConverter
): string => {
  if (!convertLocalAsset) return source;
  const localAsset = getLocalPreviewAsset(source, documentPath);
  if (!localAsset) return source;
  return `${convertLocalAsset(localAsset.absolutePath)}${localAsset.suffix}`;
};

export const rewritePreviewImageSources = (
  html: string,
  resolveImageSource?: (source: string) => string
): string => {
  if (!resolveImageSource || !html.includes("<img")) return html;

  const template = window.document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    const source = image.getAttribute("src");
    if (!source) return;
    const resolvedSource = resolveImageSource(source);
    image.setAttribute("src", resolvedSource);
    if (resolvedSource !== source) image.dataset.previewSource = source;
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  });
  return template.innerHTML;
};
