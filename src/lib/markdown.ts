import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

export interface RenderedMarkdown {
  html: string;
  blockCount: number;
}

const BLOCK_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, pre, blockquote, ul, ol, table, hr";

const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    emptyLangClass: "hljs",
    highlight(code: string, language: string) {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value;
      }

      return hljs.highlightAuto(code).value;
    }
  })
);

marked.setOptions({
  gfm: true,
  breaks: false
});

export const renderMarkdown = (markdown: string): RenderedMarkdown => {
  const rawHtml = marked.parse(markdown) as string;

  const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ["script", "style", "iframe"],
    USE_PROFILES: { html: true }
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizedHtml, "text/html");
  const blocks = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR));

  blocks.forEach((element, index) => {
    element.setAttribute("data-block-index", String(index));
  });

  return {
    html: doc.body.innerHTML,
    blockCount: blocks.length
  };
};

export const getBlockIndexForLine = (markdown: string, lineNumber: number): number => {
  if (lineNumber <= 1) {
    return 0;
  }

  const lines = markdown.split(/\r?\n/u);
  const finalLine = Math.min(lineNumber - 1, lines.length - 1);
  let blockIndex = -1;
  let inBlock = false;

  for (let i = 0; i <= finalLine; i += 1) {
    const isBlank = lines[i].trim().length === 0;
    if (!isBlank && !inBlock) {
      blockIndex += 1;
      inBlock = true;
    }
    if (isBlank) {
      inBlock = false;
    }
  }

  return Math.max(blockIndex, 0);
};
