/**
 * Small helpers shared by the PDF.js reader and its persistence boundary.
 */

export type PdfZoom = "auto" | "page-width" | "page-fit" | number;

export interface PdfViewerCapabilities {
  renderer: "pdfjs";
  supportsPageFragment: false;
  supportsApplicationAnnotations: true;
  supportsApplicationTextLayer: true;
}

export const PDF_VIEWER_CAPABILITIES: PdfViewerCapabilities = {
  renderer: "pdfjs",
  supportsPageFragment: false,
  supportsApplicationAnnotations: true,
  supportsApplicationTextLayer: true
};

const MAX_REQUESTED_PAGE = 100_000;

export const isPdfPath = (path: string): boolean => {
  const withoutFragment = path.split(/[?#]/u, 1)[0] ?? path;
  return withoutFragment.toLocaleLowerCase().endsWith(".pdf");
};

export const getPdfFileName = (path: string): string => {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  const candidate = normalized.split("/").at(-1) || normalized;

  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
};

export const sanitizePdfPage = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_REQUESTED_PAGE, Math.max(1, Math.round(value)));
};

export const parsePdfPage = (value: string): number | null => {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return sanitizePdfPage(parsed);
};
