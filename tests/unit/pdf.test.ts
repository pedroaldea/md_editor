import { describe, expect, it } from "vitest";
import {
  getPdfFileName,
  isPdfPath,
  parsePdfPage,
  PDF_VIEWER_CAPABILITIES,
  sanitizePdfPage
} from "../../src/lib/pdf";

describe("PDF viewer helpers", () => {
  it("recognizes PDF paths without being confused by fragments or case", () => {
    expect(isPdfPath("/tmp/Report.PDF#page=2")).toBe(true);
    expect(isPdfPath("/tmp/Report.md")).toBe(false);
  });

  it("extracts a readable file name from POSIX and Windows paths", () => {
    expect(getPdfFileName("C:\\Docs\\Quarter%20Report.pdf")).toBe("Quarter Report.pdf");
    expect(getPdfFileName("/tmp/guide.pdf")).toBe("guide.pdf");
  });

  it("normalizes page input to a safe positive integer", () => {
    expect(parsePdfPage(" 4 ")).toBe(4);
    expect(parsePdfPage("0")).toBeNull();
    expect(parsePdfPage("not a page")).toBeNull();
    expect(sanitizePdfPage(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("advertises the PDF.js text layer and annotation support", () => {
    expect(PDF_VIEWER_CAPABILITIES.renderer).toBe("pdfjs");
    expect(PDF_VIEWER_CAPABILITIES.supportsPageFragment).toBe(false);
    expect(PDF_VIEWER_CAPABILITIES.supportsApplicationAnnotations).toBe(true);
    expect(PDF_VIEWER_CAPABILITIES.supportsApplicationTextLayer).toBe(true);
  });
});
