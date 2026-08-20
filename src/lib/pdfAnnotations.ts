export const PDF_ANNOTATION_SCHEMA_VERSION = 1;

export type PdfAnnotationKind = "highlight" | "underline" | "redact";

export interface PdfAnnotationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfAnnotation {
  id: string;
  pageNumber: number;
  kind: PdfAnnotationKind;
  quote: string;
  rects: PdfAnnotationRect[];
  createdAt: string;
}

export interface PdfAnnotationStore {
  schemaVersion: typeof PDF_ANNOTATION_SCHEMA_VERSION;
  annotations: PdfAnnotation[];
}

const MAX_ANNOTATIONS = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeRect = (value: unknown): PdfAnnotationRect | null => {
  if (!isRecord(value)) return null;
  const left = Number(value.left);
  const top = Number(value.top);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;

  const safeLeft = clampUnit(left);
  const safeTop = clampUnit(top);
  const safeWidth = Math.min(1 - safeLeft, Math.max(0, width));
  const safeHeight = Math.min(1 - safeTop, Math.max(0, height));
  if (safeWidth <= 0 || safeHeight <= 0) return null;

  return {
    left: safeLeft,
    top: safeTop,
    width: safeWidth,
    height: safeHeight
  };
};

const normalizeAnnotation = (value: unknown): PdfAnnotation | null => {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
  const quote = typeof value.quote === "string" ? value.quote.trim() : "";
  const kind = value.kind === "underline" || value.kind === "highlight" || value.kind === "redact"
    ? value.kind
    : null;
  const pageNumber = Number(value.pageNumber);
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  const rects = Array.isArray(value.rects) ? value.rects.map(normalizeRect).filter(Boolean) : [];

  if (!id || !kind || !Number.isFinite(pageNumber) || pageNumber < 1 || !quote || rects.length === 0) {
    return null;
  }

  return {
    id,
    pageNumber: Math.round(pageNumber),
    kind,
    quote,
    rects: rects as PdfAnnotationRect[],
    createdAt: createdAt || new Date(0).toISOString()
  };
};

export const createPdfAnnotationStore = (
  annotations: readonly unknown[] = []
): PdfAnnotationStore => ({
  schemaVersion: PDF_ANNOTATION_SCHEMA_VERSION,
  annotations: annotations
    .map(normalizeAnnotation)
    .filter(Boolean)
    .slice(-MAX_ANNOTATIONS) as PdfAnnotation[]
});

export const parsePdfAnnotationStore = (raw: string | null | undefined): PdfAnnotationStore => {
  if (!raw) return createPdfAnnotationStore();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== PDF_ANNOTATION_SCHEMA_VERSION) {
      return createPdfAnnotationStore();
    }
    return createPdfAnnotationStore(Array.isArray(parsed.annotations) ? parsed.annotations : []);
  } catch {
    return createPdfAnnotationStore();
  }
};

export const serializePdfAnnotationStore = (
  annotations: readonly unknown[]
): string => JSON.stringify(createPdfAnnotationStore(annotations), null, 2);

export const createPdfAnnotation = (input: {
  pageNumber: number;
  kind: PdfAnnotationKind;
  quote: string;
  rects: readonly PdfAnnotationRect[];
  id?: string;
  createdAt?: string;
}): PdfAnnotation | null => {
  const id = input.id?.trim() ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  return normalizeAnnotation({
    id,
    pageNumber: input.pageNumber,
    kind: input.kind,
    quote: input.quote,
    rects: input.rects,
    createdAt: input.createdAt ?? new Date().toISOString()
  });
};

export const removePdfAnnotation = (
  annotations: readonly PdfAnnotation[],
  id: string
): PdfAnnotation[] => annotations.filter((annotation) => annotation.id !== id);

export const getPdfAnnotationStorageKey = (path: string): string =>
  `md-editor:pdf-annotations:${path}`;
