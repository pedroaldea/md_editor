import { describe, expect, it } from "vitest";
import { getBlockIndexForLine, renderMarkdown } from "../../src/lib/markdown";

describe("renderMarkdown", () => {
  it("renders GFM tables and code blocks with highlighting classes", () => {
    const input = [
      "# Title",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```"
    ].join("\n");

    const rendered = renderMarkdown(input);

    expect(rendered.html).toContain("<table");
    expect(rendered.html).toContain("hljs");
    expect(rendered.blockCount).toBeGreaterThan(0);
  });

  it("sanitizes unsafe script tags", () => {
    const rendered = renderMarkdown("hello\n\n<script>alert('xss')</script>");
    expect(rendered.html).not.toContain("<script>");
  });
});

describe("getBlockIndexForLine", () => {
  it("maps lines into block indexes", () => {
    const input = ["# One", "", "Paragraph", "", "- item", "- item 2", ""].join("\n");
    expect(getBlockIndexForLine(input, 1)).toBe(0);
    expect(getBlockIndexForLine(input, 3)).toBe(1);
    expect(getBlockIndexForLine(input, 5)).toBe(2);
  });
});
