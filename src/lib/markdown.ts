import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import type { UltraReadConfig } from "../types/app";

export interface RenderedMarkdown {
  html: string;
  blockCount: number;
}

export interface HeadingEntry {
  line: number;
  level: number;
  text: string;
  slug: string;
}

export interface ChecklistProgress {
  total: number;
  completed: number;
  percent: number;
}

const BLOCK_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, pre, blockquote, ul, ol, table, hr";
const BIONIC_SKIP_SELECTOR = "pre, code, kbd, samp, a, button, input, textarea";
const BIONIC_WORD_PATTERN = /([A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]*)/gu;
const FOOTNOTE_DEFINITION_PATTERN = /^\[\^([^\]]+)\]:\s*(.*)$/u;
const FOOTNOTE_REFERENCE_PATTERN = /\[\^([^\]]+)\]/gu;
const CHECKLIST_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+/u;
const FOOTNOTE_REF_TOKEN_PREFIX = "@@FOOTNOTE_REF:";

const normalizeFootnoteId = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9_-]+/gu, "-");

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .replace(/\s+/gu, "-");

interface ExtractedFootnotes {
  bodyMarkdown: string;
  definitions: Map<string, string>;
}

const extractFootnotes = (markdown: string): ExtractedFootnotes => {
  const lines = markdown.split(/\r?\n/u);
  const definitions = new Map<string, string>();
  const bodyLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const definition = line.match(FOOTNOTE_DEFINITION_PATTERN);
    if (!definition) {
      bodyLines.push(line);
      continue;
    }

    const rawId = normalizeFootnoteId(definition[1] ?? "");
    if (!rawId) {
      bodyLines.push(line);
      continue;
    }

    const parts: string[] = [definition[2] ?? ""];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const continuation = lines[cursor];
      if (/^\s{2,}|\t/u.test(continuation)) {
        parts.push(continuation.trim());
        cursor += 1;
      } else {
        break;
      }
    }
    index = cursor - 1;
    definitions.set(rawId, parts.join(" ").trim());
  }

  const bodyMarkdown = bodyLines
    .join("\n")
    .replace(FOOTNOTE_REFERENCE_PATTERN, (_, refId: string) => {
      const normalized = normalizeFootnoteId(refId);
      return normalized ? `${FOOTNOTE_REF_TOKEN_PREFIX}${normalized}@@` : _;
    });

  return { bodyMarkdown, definitions };
};

const applyFootnotes = (rawHtml: string, definitions: Map<string, string>): string => {
  const order: string[] = [];
  const referenceRegex = /@@FOOTNOTE_REF:([a-z0-9_-]+)@@/gu;

  const withReferences = rawHtml.replace(referenceRegex, (_, id: string) => {
    const normalized = normalizeFootnoteId(id);
    if (!normalized) {
      return "";
    }

    let index = order.indexOf(normalized);
    if (index < 0) {
      order.push(normalized);
      index = order.length - 1;
    }
    const number = index + 1;

    return `<sup class="footnote-ref" id="fnref-${normalized}"><a href="#fn-${normalized}">[${number}]</a></sup>`;
  });

  if (order.length === 0) {
    return withReferences;
  }

  const items = order
    .map((id, index) => {
      const source = definitions.get(id) ?? "";
      const rendered = marked.parseInline(source || `Missing footnote: ${id}`) as string;
      return `<li id="fn-${id}">${rendered} <a class="footnote-backref" href="#fnref-${id}">↩</a></li>`;
    })
    .join("");

  return `${withReferences}<section class="footnotes"><hr /><ol>${items}</ol></section>`;
};

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
  const extracted = extractFootnotes(markdown);
  const rawHtml = marked.parse(extracted.bodyMarkdown) as string;
  const withFootnotes = applyFootnotes(rawHtml, extracted.definitions);

  const sanitizedHtml = DOMPurify.sanitize(withFootnotes, {
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

export const extractHeadings = (markdown: string): HeadingEntry[] => {
  const result: HeadingEntry[] = [];
  const lines = markdown.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(#{1,6})\s+(.+)$/u);
    if (!match) {
      continue;
    }

    const level = match[1].length;
    const text = match[2].trim();
    if (!text) {
      continue;
    }

    result.push({
      line: index + 1,
      level,
      text,
      slug: slugify(text)
    });
  }

  return result;
};

export const getChecklistProgress = (markdown: string): ChecklistProgress => {
  let total = 0;
  let completed = 0;

  const lines = markdown.split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(CHECKLIST_PATTERN);
    if (!match) {
      continue;
    }
    total += 1;
    if ((match[1] ?? "").toLowerCase() === "x") {
      completed += 1;
    }
  }

  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0
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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const shouldSkipBionicNode = (textNode: Text): boolean => {
  const parent = textNode.parentElement;
  if (!parent) {
    return true;
  }
  return Boolean(parent.closest(BIONIC_SKIP_SELECTOR));
};

const transformTextNode = (
  doc: Document,
  textNode: Text,
  fixation: number,
  minWordLength: number
): void => {
  const input = textNode.textContent ?? "";
  if (!input.trim()) {
    return;
  }

  const matches = Array.from(input.matchAll(BIONIC_WORD_PATTERN));
  if (matches.length === 0) {
    return;
  }

  const fragment = doc.createDocumentFragment();
  let cursor = 0;

  matches.forEach((match) => {
    const index = match.index ?? 0;
    const word = match[0];

    if (index > cursor) {
      fragment.append(doc.createTextNode(input.slice(cursor, index)));
    }

    if (word.length >= minWordLength) {
      const focusLength = clamp(Math.round(word.length * fixation), 1, word.length);
      const wrapper = doc.createElement("span");
      wrapper.className = "bionic-word";

      const focus = doc.createElement("strong");
      focus.className = "bionic-focus";
      focus.textContent = word.slice(0, focusLength);
      wrapper.append(focus);

      if (focusLength < word.length) {
        const rest = doc.createElement("span");
        rest.className = "bionic-rest";
        rest.textContent = word.slice(focusLength);
        wrapper.append(rest);
      }

      fragment.append(wrapper);
    } else {
      fragment.append(doc.createTextNode(word));
    }

    cursor = index + word.length;
  });

  if (cursor < input.length) {
    fragment.append(doc.createTextNode(input.slice(cursor)));
  }

  textNode.parentNode?.replaceChild(fragment, textNode);
};

export const applyBionicReading = (html: string, config: UltraReadConfig): string => {
  if (!config.enabled) {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const fixation = clamp(config.fixation, 0.2, 0.8);
  const minWordLength = clamp(Math.round(config.minWordLength), 2, 12);

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textNode = currentNode as Text;
    if (!shouldSkipBionicNode(textNode)) {
      textNodes.push(textNode);
    }
    currentNode = walker.nextNode();
  }

  textNodes.forEach((node) => {
    transformTextNode(doc, node, fixation, minWordLength);
  });

  return doc.body.innerHTML;
};

export const extractReadingWords = (markdown: string): string[] => {
  const rendered = renderMarkdown(markdown);
  const parser = new DOMParser();
  const doc = parser.parseFromString(rendered.html, "text/html");
  const text = doc.body.textContent ?? "";

  return (text.match(BIONIC_WORD_PATTERN) ?? []).map((word) => word.trim()).filter(Boolean);
};

export const renderBionicWord = (
  word: string,
  config: Pick<UltraReadConfig, "fixation" | "minWordLength">
): string => {
  const safeWord = DOMPurify.sanitize(word);
  if (safeWord.length === 0) {
    return "&nbsp;";
  }

  if (safeWord.length < config.minWordLength) {
    return safeWord;
  }

  const fixation = clamp(config.fixation, 0.2, 0.8);
  const focusLength = clamp(Math.round(safeWord.length * fixation), 1, safeWord.length);
  const focus = safeWord.slice(0, focusLength);
  const rest = safeWord.slice(focusLength);

  if (!rest) {
    return `<span class="bionic-word"><strong class="bionic-focus">${focus}</strong></span>`;
  }

  return `<span class="bionic-word"><strong class="bionic-focus">${focus}</strong><span class="bionic-rest">${rest}</span></span>`;
};
