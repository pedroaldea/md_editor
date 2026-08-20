import { describe, expect, it } from "vitest";
import {
  createPdfAnnotation,
  createPdfAnnotationStore,
  getPdfAnnotationStorageKey,
  parsePdfAnnotationStore,
  removePdfAnnotation,
  serializePdfAnnotationStore
} from "../../src/lib/pdfAnnotations";

describe("PDF annotations", () => {
  it("normalizes page rectangles and serializes a stable sidecar", () => {
    const annotation = createPdfAnnotation({
      id: "a-1",
      pageNumber: 2,
      kind: "highlight",
      quote: "Important",
      rects: [{ left: 0.1, top: 0.2, width: 0.4, height: 0.05 }],
      createdAt: "2026-08-19T00:00:00.000Z"
    });

    expect(annotation?.pageNumber).toBe(2);
    expect(serializePdfAnnotationStore([annotation])).toContain('"schemaVersion": 1');
    expect(parsePdfAnnotationStore(serializePdfAnnotationStore([annotation])).annotations).toEqual([
      annotation
    ]);
  });

  it("drops malformed records and clamps rectangles to the page", () => {
    const store = createPdfAnnotationStore([
      {
        id: "ok",
        pageNumber: 1,
        kind: "underline",
        quote: "A",
        rects: [{ left: 0.9, top: 0.9, width: 0.5, height: 0.5 }],
        createdAt: ""
      },
      { id: "bad", pageNumber: 0, kind: "highlight", quote: "", rects: [] }
    ]);

    expect(store.annotations).toHaveLength(1);
    expect(store.annotations[0].rects[0].left).toBeCloseTo(0.9);
    expect(store.annotations[0].rects[0].top).toBeCloseTo(0.9);
    expect(store.annotations[0].rects[0].width).toBeCloseTo(0.1);
    expect(store.annotations[0].rects[0].height).toBeCloseTo(0.1);
  });

  it("returns an empty store for invalid or incompatible data", () => {
    expect(parsePdfAnnotationStore("not json").annotations).toEqual([]);
    expect(parsePdfAnnotationStore('{"schemaVersion":99,"annotations":[]}').annotations).toEqual([]);
  });

  it("keeps opaque redactions without retaining the selected quote", () => {
    const annotation = createPdfAnnotation({
      id: "redacted-1",
      pageNumber: 3,
      kind: "redact",
      quote: "[redacted]",
      rects: [{ left: 0.2, top: 0.3, width: 0.25, height: 0.04 }]
    });

    expect(annotation).toMatchObject({ kind: "redact", quote: "[redacted]" });
    expect(parsePdfAnnotationStore(serializePdfAnnotationStore([annotation])).annotations[0])
      .toMatchObject({ kind: "redact", quote: "[redacted]" });
  });

  it("removes one annotation without changing the rest", () => {
    const first = createPdfAnnotation({
      id: "first",
      pageNumber: 1,
      kind: "highlight",
      quote: "One",
      rects: [{ left: 0, top: 0, width: 0.2, height: 0.04 }]
    });
    const second = createPdfAnnotation({
      id: "second",
      pageNumber: 1,
      kind: "underline",
      quote: "Two",
      rects: [{ left: 0, top: 0.1, width: 0.2, height: 0.04 }]
    });

    expect(removePdfAnnotation([first!, second!], "first").map(({ id }) => id)).toEqual(["second"]);
  });

  it("names browser fallback storage by the full source path", () => {
    expect(getPdfAnnotationStorageKey("/docs/report.pdf")).toBe(
      "md-editor:pdf-annotations:/docs/report.pdf"
    );
  });
});
