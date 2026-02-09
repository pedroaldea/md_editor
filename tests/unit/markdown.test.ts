import { describe, expect, it } from "vitest";
import {
  applyBionicReading,
  extractHeadings,
  getBlockIndexForLine,
  getChecklistProgress,
  renderMarkdown
} from "../../src/lib/markdown";

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

  it("renders footnotes with references", () => {
    const rendered = renderMarkdown("Reference[^a]\n\n[^a]: My note");
    expect(rendered.html).toContain("footnote-ref");
    expect(rendered.html).toContain("footnotes");
    expect(rendered.html).toContain("My note");
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

describe("applyBionicReading", () => {
  it("emphasizes word prefixes when enabled", () => {
    const html = "<p>Bionic reading improves focus.</p>";
    const transformed = applyBionicReading(html, {
      enabled: true,
      fixation: 0.5,
      minWordLength: 4,
      focusWeight: 760
    });

    expect(transformed).toContain("bionic-focus");
    expect(transformed).toContain("bionic-rest");
  });

  it("does not modify code blocks", () => {
    const html = "<pre><code>const value = 42;</code></pre>";
    const transformed = applyBionicReading(html, {
      enabled: true,
      fixation: 0.5,
      minWordLength: 4,
      focusWeight: 760
    });

    expect(transformed).not.toContain("bionic-focus");
    expect(transformed).toContain("const value = 42;");
  });
});

describe("extractHeadings", () => {
  it("extracts heading entries with levels and lines", () => {
    const headings = extractHeadings("# Title\n\n## Section\nText");
    expect(headings).toEqual([
      { line: 1, level: 1, text: "Title", slug: "title" },
      { line: 3, level: 2, text: "Section", slug: "section" }
    ]);
  });
});

describe("getChecklistProgress", () => {
  it("counts checklist completion", () => {
    const progress = getChecklistProgress("- [x] one\n- [ ] two\n- [X] three");
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(2);
    expect(progress.percent).toBe(67);
  });
});
