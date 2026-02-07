import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import type { UltraReadConfig } from "../types/app";

export interface RenderedMarkdown {
  html: string;
  blockCount: number;
}

const BLOCK_SELECTOR =
  "h1, h2, h3, h4, h5, h6, p, pre, blockquote, ul, ol, table, hr";
const BIONIC_SKIP_SELECTOR = "pre, code, kbd, samp, a, button, input, textarea";
const BIONIC_WORD_PATTERN = /([A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]*)/gu;

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
