/**
 * Local, source-oriented Markdown annotations.
 *
 * An annotation stores the selected Markdown text and a small amount of text
 * on either side of it.  The editor's transient `from`/`to` offsets are used
 * only when creating or resolving an annotation; they are intentionally not
 * part of the persisted model.  This lets an annotation survive insertions
 * and deletions elsewhere in the document.
 */

export const ANNOTATION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_ANNOTATION_CONTEXT_CHARS = 80;
export const MAX_ANNOTATION_CONTEXT_CHARS = 240;

export type AnnotationType = "highlight" | "underline";

/** `kind` is kept as a type-level alias for callers that use that vocabulary. */
export type AnnotationKind = AnnotationType;

export interface AnnotationAnchor {
  /** The exact Markdown source selected by the user. */
  text: string;
  /** Text immediately before `text`, used to disambiguate repeated quotes. */
  prefix: string;
  /** Text immediately after `text`, used to disambiguate repeated quotes. */
  suffix: string;
}

export interface MarkdownAnnotation {
  id: string;
  type: AnnotationType;
  anchor: AnnotationAnchor;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AnnotationSidecar {
  schemaVersion: typeof ANNOTATION_SCHEMA_VERSION;
  /** Optional source identity supplied by the integration layer. */
  documentFingerprint?: string;
  annotations: MarkdownAnnotation[];
}

export interface CreateAnnotationInput {
  /** Current Markdown source. Offsets are UTF-16 offsets into this string. */
  markdown: string;
  from: number;
  to: number;
  type: AnnotationType;
  id?: string;
  nowMs?: number;
  /** Number of source characters to retain on either side of the quote. */
  contextChars?: number;
}

export interface AnnotationSidecarMetadata {
  documentFingerprint?: string;
}

export type AnnotationMatchKind = "exact" | "whitespace-normalized";

export interface ResolvedAnnotation {
  annotation: MarkdownAnnotation;
  /** UTF-16 offsets into the source string passed to `resolveAnnotation`. */
  from: number;
  to: number;
  /** The text that was actually matched in the current source. */
  matchedText: string;
  matchKind: AnnotationMatchKind;
  /** 0..1 context score. A higher score is a better anchor match. */
  contextScore: number;
}

export class AnnotationSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationSerializationError";
  }
}

const ANNOTATION_TYPES = new Set<AnnotationType>(["highlight", "underline"]);
const WHITESPACE_PATTERN = /\s+/gu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/gu, "\n");

const clampInteger = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

const normalizeContextChars = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_ANNOTATION_CONTEXT_CHARS;
  }

  return clampInteger(value, 0, MAX_ANNOTATION_CONTEXT_CHARS);
};

const normalizeTimestamp = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.round(value);
};

const normalizeId = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const normalizeType = (value: unknown): AnnotationType | null => {
  if (typeof value !== "string" || !ANNOTATION_TYPES.has(value as AnnotationType)) {
    return null;
  }

  return value as AnnotationType;
};

const normalizeAnchor = (value: unknown): AnnotationAnchor | null => {
  if (!isRecord(value)) {
    return null;
  }

  // `exact` and a flat `text` are accepted while reading so an integration
  // can import Web Annotation-like data without making the persisted format
  // ambiguous. We always write the canonical `anchor.text` form.
  const rawText = value.text ?? value.exact;
  if (typeof rawText !== "string") {
    return null;
  }

  const text = normalizeLineEndings(rawText);
  if (!text.trim()) {
    return null;
  }

  const prefix = typeof value.prefix === "string" ? normalizeLineEndings(value.prefix) : "";
  const suffix = typeof value.suffix === "string" ? normalizeLineEndings(value.suffix) : "";

  return { text, prefix, suffix };
};

/**
 * Converts an unknown sidecar item into the canonical model.
 * Invalid items return `null`, allowing a sidecar with one damaged item to be
 * inspected without crashing the editor. The sidecar parser remains strict at
 * the root/schema level.
 */
export const normalizeAnnotation = (value: unknown): MarkdownAnnotation | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeId(value.id);
  const type = normalizeType(value.type ?? value.kind);
  const anchor = normalizeAnchor(value.anchor ?? value);
  if (!id || !type || !anchor) {
    return null;
  }

  const createdAtMs = normalizeTimestamp(value.createdAtMs, 0);
  const updatedAtMs = Math.max(createdAtMs, normalizeTimestamp(value.updatedAtMs, createdAtMs));

  return {
    id,
    type,
    anchor,
    createdAtMs,
    updatedAtMs
  };
};

const annotationSort = (left: MarkdownAnnotation, right: MarkdownAnnotation): number => {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  return left.id.localeCompare(right.id);
};

/** Normalizes, removes invalid entries, de-duplicates IDs, and sorts output. */
export const normalizeAnnotations = (
  values: readonly unknown[] | undefined | null
): MarkdownAnnotation[] => {
  if (!values) {
    return [];
  }

  const byId = new Map<string, MarkdownAnnotation>();
  for (const value of values) {
    const annotation = normalizeAnnotation(value);
    if (!annotation) {
      continue;
    }

    const previous = byId.get(annotation.id);
    if (!previous || compareAnnotationVersions(previous, annotation) < 0) {
      byId.set(annotation.id, annotation);
    }
  }

  return [...byId.values()].sort(annotationSort);
};

const stableAnnotationKey = (annotation: MarkdownAnnotation): string =>
  JSON.stringify(annotation);

/**
 * Chooses one version deterministically. This makes merging from two local
 * tabs commutative: newer `updatedAtMs` wins; ties use a stable JSON key.
 */
const compareAnnotationVersions = (
  left: MarkdownAnnotation,
  right: MarkdownAnnotation
): number => {
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }

  const leftKey = stableAnnotationKey(left);
  const rightKey = stableAnnotationKey(right);
  return leftKey.localeCompare(rightKey);
};

/**
 * Creates an annotation from a transient editor selection.
 *
 * The returned object contains no offsets. `from` and `to` are only used to
 * capture the quote and its context, so edits elsewhere do not invalidate the
 * persisted anchor.
 */
export const createAnnotation = (
  input: CreateAnnotationInput
): MarkdownAnnotation | null => {
  if (!input || typeof input.markdown !== "string" || !ANNOTATION_TYPES.has(input.type)) {
    return null;
  }

  const source = input.markdown;
  const rawFrom = Number.isFinite(input.from) ? Math.round(input.from) : 0;
  const rawTo = Number.isFinite(input.to) ? Math.round(input.to) : 0;
  const from = clampInteger(Math.min(rawFrom, rawTo), 0, source.length);
  const to = clampInteger(Math.max(rawFrom, rawTo), 0, source.length);
  if (from === to) {
    return null;
  }

  const contextChars = normalizeContextChars(input.contextChars);
  const text = normalizeLineEndings(source.slice(from, to));
  if (!text.trim()) {
    return null;
  }

  const prefix = normalizeLineEndings(source.slice(Math.max(0, from - contextChars), from));
  const suffix = normalizeLineEndings(source.slice(to, to + contextChars));
  const nowMs = normalizeTimestamp(input.nowMs, Date.now());
  const id = normalizeId(input.id) || generateAnnotationId(input.type, nowMs);

  return {
    id,
    type: input.type,
    anchor: { text, prefix, suffix },
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  };
};

/** Returns a fresh timestamped ID without leaking document text into the ID. */
const generateAnnotationId = (type: AnnotationType, nowMs: number): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  const randomPart = randomUuid?.replace(/-/gu, "").slice(0, 12) ?? Math.random().toString(36).slice(2, 14);
  return `${type}-${nowMs.toString(36)}-${randomPart}`;
};

const commonPrefixLength = (left: string, right: string): number => {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1;
  }
  return index;
};

const commonSuffixLength = (left: string, right: string): number => {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (
    index < limit &&
    left.charCodeAt(left.length - index - 1) === right.charCodeAt(right.length - index - 1)
  ) {
    index += 1;
  }
  return index;
};

const scoreContext = (
  source: string,
  from: number,
  to: number,
  anchor: AnnotationAnchor
): number => {
  const prefix = source.slice(Math.max(0, from - anchor.prefix.length), from);
  const suffix = source.slice(to, to + anchor.suffix.length);
  const prefixScore = anchor.prefix.length
    ? commonSuffixLength(prefix, anchor.prefix) / anchor.prefix.length
    : 1;
  const suffixScore = anchor.suffix.length
    ? commonPrefixLength(suffix, anchor.suffix) / anchor.suffix.length
    : 1;

  return (prefixScore + suffixScore) / 2;
};

interface NormalizedSource {
  text: string;
  /** Normalized text boundary -> original source boundary. */
  boundaries: number[];
}

const normalizeSourceWithBoundaries = (source: string): NormalizedSource => {
  const parts: string[] = [];
  const boundaries: number[] = [0];
  let normalizedLength = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\r") {
      if (source[index + 1] === "\n") {
        index += 1;
      }
      parts.push("\n");
      normalizedLength += 1;
      boundaries[normalizedLength] = index + 1;
      continue;
    }

    parts.push(character);
    normalizedLength += character.length;
    boundaries[normalizedLength] = index + 1;
  }

  return { text: parts.join(""), boundaries };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const whitespaceTolerantPattern = (text: string): RegExp => {
  const parts = normalizeLineEndings(text).split(WHITESPACE_PATTERN);
  const whitespaceCount = (normalizeLineEndings(text).match(WHITESPACE_PATTERN) ?? []).length;
  let pattern = "";
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) {
      pattern += "\\s+";
    }
    pattern += escapeRegExp(parts[index] ?? "");
  }

  // A quote consisting only of whitespace is rejected by normalizeAnchor, but
  // retaining this guard keeps the regex helper safe if called independently.
  if (whitespaceCount > 0 && parts.every((part) => !part)) {
    return /(?!)/gu;
  }

  return new RegExp(pattern, "gu");
};

interface Candidate {
  from: number;
  to: number;
  matchedText: string;
  matchKind: AnnotationMatchKind;
  contextScore: number;
}

const compareCandidates = (left: Candidate, right: Candidate): number => {
  if (left.contextScore !== right.contextScore) {
    return right.contextScore - left.contextScore;
  }
  if (left.matchKind !== right.matchKind) {
    return left.matchKind === "exact" ? -1 : 1;
  }
  return left.from - right.from;
};

const findCandidates = (
  normalizedSource: NormalizedSource,
  annotation: MarkdownAnnotation
): Candidate[] => {
  const candidates: Candidate[] = [];
  const exact = annotation.anchor.text;
  let cursor = 0;
  while (exact.length > 0) {
    const index = normalizedSource.text.indexOf(exact, cursor);
    if (index < 0) {
      break;
    }
    const end = index + exact.length;
    candidates.push({
      from: normalizedSource.boundaries[index] ?? index,
      to: normalizedSource.boundaries[end] ?? end,
      matchedText: normalizedSource.text.slice(index, end),
      matchKind: "exact",
      contextScore: scoreContext(normalizedSource.text, index, end, annotation.anchor)
    });
    cursor = index + Math.max(exact.length, 1);
  }

  if (candidates.length > 0) {
    return candidates;
  }

  const pattern = whitespaceTolerantPattern(exact);
  for (const match of normalizedSource.text.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index < 0) {
      continue;
    }
    const matchedText = match[0] ?? "";
    const end = index + matchedText.length;
    candidates.push({
      from: normalizedSource.boundaries[index] ?? index,
      to: normalizedSource.boundaries[end] ?? end,
      matchedText,
      matchKind: "whitespace-normalized",
      contextScore: scoreContext(normalizedSource.text, index, end, annotation.anchor)
    });
  }

  return candidates;
};

/** Resolves one persisted annotation against the current Markdown source. */
export const resolveAnnotation = (
  markdown: string,
  annotation: MarkdownAnnotation
): ResolvedAnnotation | null => {
  if (typeof markdown !== "string") {
    return null;
  }

  const normalized = normalizeAnnotation(annotation);
  if (!normalized) {
    return null;
  }

  const source = normalizeSourceWithBoundaries(markdown);
  const candidates = findCandidates(source, normalized);
  const winner = [...candidates].sort(compareCandidates)[0];
  if (!winner) {
    return null;
  }

  return {
    annotation: normalized,
    from: winner.from,
    to: winner.to,
    matchedText: winner.matchedText,
    matchKind: winner.matchKind,
    contextScore: winner.contextScore
  };
};

/** Resolves all currently visible annotations and leaves unresolved ones out. */
export const resolveAnnotations = (
  markdown: string,
  annotations: readonly unknown[]
): ResolvedAnnotation[] => {
  const resolved: ResolvedAnnotation[] = [];
  for (const annotation of normalizeAnnotations(annotations)) {
    const match = resolveAnnotation(markdown, annotation);
    if (match) {
      resolved.push(match);
    }
  }

  return resolved.sort((left, right) => {
    if (left.from !== right.from) {
      return left.from - right.from;
    }
    if (left.to !== right.to) {
      return left.to - right.to;
    }
    return left.annotation.id.localeCompare(right.annotation.id);
  });
};

/**
 * Merges two local annotation collections without mutating either input.
 * Same IDs are treated as versions of one annotation; the latest update wins.
 */
export const mergeAnnotations = (
  current: readonly unknown[],
  incoming: readonly unknown[]
): MarkdownAnnotation[] => normalizeAnnotations([
  ...normalizeAnnotations(current),
  ...normalizeAnnotations(incoming)
]);

/** Removes one annotation by ID without mutating the source collection. */
export const removeAnnotation = (
  annotations: readonly unknown[],
  annotationId: string
): MarkdownAnnotation[] => {
  const id = normalizeId(annotationId);
  return normalizeAnnotations(annotations).filter((annotation) => annotation.id !== id);
};

/** Creates the canonical sidecar object ready to write beside a Markdown file. */
export const createAnnotationSidecar = (
  annotations: readonly unknown[],
  metadata: AnnotationSidecarMetadata = {}
): AnnotationSidecar => {
  const documentFingerprint = metadata.documentFingerprint?.trim();
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    ...(documentFingerprint ? { documentFingerprint } : {}),
    annotations: normalizeAnnotations(annotations)
  };
};

/** Serializes a sidecar deterministically for local files and easy diffs. */
export const serializeAnnotationSidecar = (
  annotationsOrSidecar: readonly unknown[] | AnnotationSidecar,
  metadata: AnnotationSidecarMetadata = {}
): string => {
  if (!isRecord(annotationsOrSidecar)) {
    return `${JSON.stringify(
      createAnnotationSidecar(annotationsOrSidecar as readonly unknown[], metadata),
      null,
      2
    )}\n`;
  }

  const annotations = Array.isArray(annotationsOrSidecar.annotations)
    ? annotationsOrSidecar.annotations
    : [];
  const documentFingerprint =
    typeof annotationsOrSidecar.documentFingerprint === "string"
      ? annotationsOrSidecar.documentFingerprint
      : metadata.documentFingerprint;
  const sidecar = createAnnotationSidecar(annotations, { documentFingerprint });

  return `${JSON.stringify(sidecar, null, 2)}\n`;
};

const parseSidecarValue = (value: unknown): AnnotationSidecar => {
  if (!isRecord(value)) {
    throw new AnnotationSerializationError("Annotation sidecar must be a JSON object");
  }
  if (value.schemaVersion !== ANNOTATION_SCHEMA_VERSION) {
    throw new AnnotationSerializationError(
      `Unsupported annotation sidecar schema: ${String(value.schemaVersion)}`
    );
  }
  if (!Array.isArray(value.annotations)) {
    throw new AnnotationSerializationError("Annotation sidecar annotations must be an array");
  }

  const invalidCount = value.annotations.filter((item) => !normalizeAnnotation(item)).length;
  if (invalidCount > 0) {
    throw new AnnotationSerializationError(
      `Annotation sidecar contains ${invalidCount} invalid annotation${invalidCount === 1 ? "" : "s"}`
    );
  }

  const documentFingerprint =
    typeof value.documentFingerprint === "string" ? value.documentFingerprint.trim() : undefined;

  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    ...(documentFingerprint ? { documentFingerprint } : {}),
    annotations: normalizeAnnotations(value.annotations)
  };
};

/** Parses and validates a sidecar. Use `tryParseAnnotationSidecar` for recovery flows. */
export const parseAnnotationSidecar = (serialized: string): AnnotationSidecar => {
  if (typeof serialized !== "string") {
    throw new AnnotationSerializationError("Annotation sidecar must be a string");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new AnnotationSerializationError("Annotation sidecar is not valid JSON");
  }

  return parseSidecarValue(parsed);
};

/** Non-throwing parser for optional or damaged sidecars. */
export const tryParseAnnotationSidecar = (serialized: string): AnnotationSidecar | null => {
  try {
    return parseAnnotationSidecar(serialized);
  } catch {
    return null;
  }
};
