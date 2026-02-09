import { describe, expect, it, vi } from "vitest";
import { PDF_EXPORT_CLASS, runPdfPrint } from "../../src/lib/export";

describe("runPdfPrint", () => {
  it("applies export class only while printing", async () => {
    const root = document.createElement("div");
    const print = vi.fn(() => {
      expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(true);
    });

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("cleans export class when print throws", async () => {
    const root = document.createElement("div");
    const print = vi.fn(() => {
      throw new Error("print unsupported");
    });

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(false);
    expect(print).toHaveBeenCalledTimes(1);
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });
});
