import { describe, expect, it } from "vitest";
import {
  createAnnotation,
  createAnnotationSidecar,
  mergeAnnotations,
  parseAnnotationSidecar,
  removeAnnotation,
  resolveAnnotation,
  resolveAnnotations,
  serializeAnnotationSidecar,
  tryParseAnnotationSidecar
} from "../../src/lib/annotations";

describe("Markdown annotations", () => {
  it("captures highlight and underline anchors without persisting offsets", () => {
    const markdown = "# Notes\n\nRead the important part before shipping.";
    const highlight = createAnnotation({
      markdown,
      from: markdown.indexOf("important"),
      to: markdown.indexOf("important") + "important part".length,
      type: "highlight",
      id: "a-highlight",
      nowMs: 100
    });
    const underline = createAnnotation({
      markdown,
      from: markdown.indexOf("shipping"),
      to: markdown.indexOf("shipping") + "shipping".length,
      type: "underline",
      id: "a-underline",
      nowMs: 101
    });

    expect(highlight).toEqual({
      id: "a-highlight",
      type: "highlight",
      anchor: {
        text: "important part",
        prefix: "# Notes\n\nRead the ",
        suffix: " before shipping."
      },
      createdAtMs: 100,
      updatedAtMs: 100
    });
    expect(underline?.type).toBe("underline");
    expect(JSON.stringify(highlight)).not.toContain('"from"');
    expect(JSON.stringify(highlight)).not.toContain('"to"');
  });

  it("resolves repeated text using stable surrounding context after edits", () => {
    const original = "Alpha repeated\n\nBeta repeated\n\nGamma";
    const start = original.indexOf("repeated", original.indexOf("Beta"));
    const annotation = createAnnotation({
      markdown: original,
      from: start,
      to: start + "repeated".length,
      type: "highlight",
      id: "beta",
      nowMs: 10,
      contextChars: 12
    });
    expect(annotation).not.toBeNull();

    const changed = "Intro inserted\n\nAlpha repeated\n\nBeta repeated\n\nGamma";
    const resolved = resolveAnnotation(changed, annotation!);
    expect(resolved).not.toBeNull();
    expect(resolved?.matchedText).toBe("repeated");
    expect(changed.slice(resolved!.from, resolved!.to)).toBe("repeated");
    expect(changed.slice(0, resolved!.from)).toContain("Beta ");
    expect(resolved?.contextScore).toBeGreaterThan(0.5);
  });

  it("supports CRLF source and whitespace-only edits while returning source offsets", () => {
    const original = "One\r\nTwo selected\r\nThree";
    const from = original.indexOf("Two");
    const annotation = createAnnotation({
      markdown: original,
      from,
      to: from + "Two selected".length,
      type: "underline",
      id: "crlf",
      nowMs: 5
    });
    const changed = "One\nTwo   selected\nThree";
    const resolved = resolveAnnotation(changed, annotation!);

    expect(annotation?.anchor.text).toBe("Two selected");
    expect(resolved?.matchKind).toBe("whitespace-normalized");
    expect(changed.slice(resolved!.from, resolved!.to)).toBe("Two   selected");
  });

  it("returns all resolvable annotations sorted by current source position", () => {
    const markdown = "first phrase\n\nsecond phrase";
    const first = createAnnotation({
      markdown,
      from: 0,
      to: "first phrase".length,
      type: "highlight",
      id: "first",
      nowMs: 2
    });
    const secondStart = markdown.indexOf("second");
    const second = createAnnotation({
      markdown,
      from: secondStart,
      to: markdown.length,
      type: "underline",
      id: "second",
      nowMs: 1
    });

    expect(resolveAnnotations(markdown, [second, first, { bad: true }])).toMatchObject([
      { annotation: { id: "first" }, from: 0 },
      { annotation: { id: "second" }, from: 14 }
    ]);
  });

  it("merges versions immutably and removes by ID", () => {
    const markdown = "Keep this";
    const first = createAnnotation({
      markdown,
      from: 0,
      to: 4,
      type: "highlight",
      id: "same",
      nowMs: 1
    });
    const newer = {
      ...first!,
      anchor: { ...first!.anchor, text: "Keep" },
      updatedAtMs: 2
    };
    const other = createAnnotation({
      markdown,
      from: 5,
      to: markdown.length,
      type: "underline",
      id: "other",
      nowMs: 3
    });

    const current = [first!];
    const merged = mergeAnnotations(current, [newer, other!]);
    expect(current[0]).toBe(first);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.id === "same")?.anchor.text).toBe("Keep");
    expect(removeAnnotation(merged, "same")).toEqual([other]);
  });

  it("serializes a deterministic sidecar and validates it on read", () => {
    const annotation = createAnnotation({
      markdown: "Read this",
      from: 0,
      to: 4,
      type: "highlight",
      id: "a",
      nowMs: 42
    });
    const sidecar = createAnnotationSidecar([annotation!], {
      documentFingerprint: "sha256:demo"
    });
    const serialized = serializeAnnotationSidecar(sidecar);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(sidecar);
    expect(parseAnnotationSidecar(serialized)).toEqual(sidecar);
    expect(tryParseAnnotationSidecar('{"schemaVersion":99,"annotations":[]}')).toBeNull();
    expect(() => parseAnnotationSidecar("not json")).toThrow("not valid JSON");
  });
});
