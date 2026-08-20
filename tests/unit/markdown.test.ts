import DOMPurify from "dompurify";
import { describe, expect, it, vi } from "vitest";
import {
  applyBionicReading,
  extractReadingWordsFromHtml,
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

  it("prepares fenced Mermaid code for lazy diagram rendering", () => {
    const rendered = renderMarkdown("```mermaid\nflowchart LR\nA --> B\n```");
    const host = document.createElement("div");
    host.innerHTML = rendered.html;

    expect(host.querySelector(".mermaid-diagram")).not.toBeNull();
    expect(host.querySelector(".mermaid-source")?.textContent).toContain("flowchart LR");
    expect(host.querySelector(".mermaid-source")?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector(".mermaid-canvas")?.getAttribute("aria-busy")).toBe("true");
    expect(rendered.blockCount).toBe(1);
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

  it("renders note, tip and warning callouts without exposing Markdown markers", () => {
    const rendered = renderMarkdown([
      "> [!NOTE]",
      "> Context",
      "",
      "> [!TIP]",
      "> **Use this path**",
      "",
      "> [!WARNING]",
      "> Check access <script>alert('xss')</script>"
    ].join("\n"));
    const host = document.createElement("div");
    host.innerHTML = rendered.html;

    const note = host.querySelector<HTMLElement>(".callout-note");
    const tip = host.querySelector<HTMLElement>(".callout-tip");
    const warning = host.querySelector<HTMLElement>(".callout-warning");

    expect(note?.tagName).toBe("ASIDE");
    expect(note?.getAttribute("role")).toBe("note");
    expect(note?.textContent).toContain("Note");
    expect(tip?.textContent).toContain("Tip");
    expect(tip?.querySelector("strong")?.textContent).toBe("Use this path");
    expect(warning?.textContent).toContain("Warning");
    expect(warning?.textContent).toContain("Check access");
    expect(host.textContent).not.toMatch(/\[!(?:NOTE|TIP|WARNING)\]/u);
    expect(rendered.html).not.toContain("<script>");
  });

  it("renders lightweight highlight and underline marks without touching code", () => {
    const rendered = renderMarkdown("==focus this== and ++keep this++\n\n`==code==`");
    expect(rendered.html).toContain('<mark class="inline-highlight">focus this</mark>');
    expect(rendered.html).toContain('<u class="inline-underline">keep this</u>');
    expect(rendered.html).toContain("<code>==code==</code>");
  });

  it("reuses sanitized HTML for quick-read extraction on a large document", () => {
    const markdown = Array.from(
      { length: 2_000 },
      (_, index) => `## Section ${index}\n\nAlpha beta gamma delta epsilon.`
    ).join("\n\n");
    const rendered = renderMarkdown(markdown);
    const sanitizeSpy = vi.spyOn(DOMPurify, "sanitize");

    const words = extractReadingWordsFromHtml(rendered.html);

    expect(words).toHaveLength(14_000);
    expect(words.slice(0, 7)).toEqual([
      "Section",
      "0",
      "Alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon"
    ]);
    expect(sanitizeSpy).not.toHaveBeenCalled();
    sanitizeSpy.mockRestore();
  });

  it("does not read Mermaid loading placeholders in Quick Read", () => {
    const rendered = renderMarkdown(
      "Before\n\n```mermaid\nflowchart LR\nA --> B\n```\n\nAfter"
    );

    expect(extractReadingWordsFromHtml(rendered.html)).toEqual(["Before", "After"]);
  });
});

describe("getBlockIndexForLine", () => {
  it("maps lines into block indexes", () => {
    const input = ["# One", "", "Paragraph", "", "- item", "- item 2", ""].join("\n");
    expect(getBlockIndexForLine(input, 1)).toBe(0);
    expect(getBlockIndexForLine(input, 3)).toBe(1);
    expect(getBlockIndexForLine(input, 5)).toBe(2);
  });

  it("maps heading and paragraph blocks without blank lines", () => {
    const input = ["# One", "Paragraph", "- item", "- item 2", "", "> Quote line"].join("\n");
    expect(getBlockIndexForLine(input, 1)).toBe(0);
    expect(getBlockIndexForLine(input, 2)).toBe(1);
    expect(getBlockIndexForLine(input, 3)).toBe(2);
    expect(getBlockIndexForLine(input, 4)).toBe(2);
    expect(getBlockIndexForLine(input, 6)).toBe(3);
  });

  it("keeps blockquote lines mapped to their block", () => {
    const input = ["> Line one", ">", "> Line two", "", "Paragraph"].join("\n");
    expect(getBlockIndexForLine(input, 1)).toBe(0);
    expect(getBlockIndexForLine(input, 3)).toBe(0);
    expect(getBlockIndexForLine(input, 5)).toBe(1);
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
