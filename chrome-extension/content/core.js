// Pure reading logic shared by the content scripts and the unit tests.
// Classic script: no import/export so Chrome can inject it as a content script.
(function (root) {
  "use strict";

  if (root.MdReaderCore) return;

  // Same Unicode word definition as the desktop app (src/lib/markdown.ts).
  const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
  const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;
  const CLAUSE_END = /[,;:—–]["'”’)\]]*$/u;

  const DEFAULTS = Object.freeze({
    wpm: 360,
    fontScale: 100,
    theme: "auto",
    bionicFixation: 0.45,
    bionicMinWord: 3,
    bionicWeight: 700,
    bionicDimRest: true,
    autoBionicSites: []
  });

  const LIMITS = Object.freeze({
    wpm: [100, 1200],
    fontScale: [60, 200],
    bionicFixation: [0.2, 0.8],
    bionicMinWord: [1, 12],
    bionicWeight: [500, 900]
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const segmenter =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  const graphemes = (text) =>
    segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);

  /** Repairs any stored settings object into a complete, bounded one. */
  const normalizeSettings = (input) => {
    const source = input && typeof input === "object" ? input : {};
    const out = { ...DEFAULTS };
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
      const value = Number(source[key]);
      if (Number.isFinite(value)) out[key] = clamp(value, min, max);
    }
    out.wpm = Math.round(out.wpm);
    out.fontScale = Math.round(out.fontScale);
    out.bionicMinWord = Math.round(out.bionicMinWord);
    out.bionicWeight = Math.round(out.bionicWeight / 100) * 100;
    if (["auto", "light", "dark"].includes(source.theme)) out.theme = source.theme;
    if (typeof source.bionicDimRest === "boolean") out.bionicDimRest = source.bionicDimRest;
    if (Array.isArray(source.autoBionicSites)) {
      out.autoBionicSites = [
        ...new Set(source.autoBionicSites.filter((site) => typeof site === "string" && site))
      ];
    }
    return out;
  };

  /** Number of leading characters (graphemes) to emphasise for a bionic word. */
  const bionicFocusLength = (word, fixation) => {
    const length = graphemes(word).length;
    return clamp(Math.round(length * clamp(fixation, 0.2, 0.8)), 1, length);
  };

  /**
   * Splits a text into alternating plain and word parts for bionic rendering.
   * Returns [{ text, focus?, rest? }]: parts with `focus` are words to emphasise.
   */
  const bionicParts = (text, fixation, minWord) => {
    const parts = [];
    let cursor = 0;
    for (const match of text.matchAll(WORD_PATTERN)) {
      const index = match.index ?? 0;
      const word = match[0];
      if (index > cursor) parts.push({ text: text.slice(cursor, index) });
      const units = graphemes(word);
      if (units.length >= minWord) {
        const focusLength = bionicFocusLength(word, fixation);
        parts.push({
          text: word,
          focus: units.slice(0, focusLength).join(""),
          rest: units.slice(focusLength).join("")
        });
      } else {
        parts.push({ text: word });
      }
      cursor = index + word.length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor) });
    return parts;
  };

  /**
   * Turns text into RSVP tokens. Punctuation stays attached so the reader sees
   * sentence boundaries, and paragraph starts are flagged for an extra pause.
   */
  const tokenize = (text) => {
    const tokens = [];
    const paragraphs = String(text ?? "").split(/\n\s*\n+/u);
    for (const paragraph of paragraphs) {
      const chunks = paragraph.split(/\s+/u).filter(Boolean);
      let first = true;
      for (const chunk of chunks) {
        // Skip pure symbol runs such as "•" or "|" that carry no reading value.
        if (!/[\p{L}\p{N}]/u.test(chunk)) continue;
        tokens.push({ text: chunk, paragraphStart: first && tokens.length > 0 });
        first = false;
      }
    }
    return tokens;
  };

  /** Optimal recognition point: index of the grapheme the eye should anchor on. */
  const pivotIndex = (word) => {
    const core = graphemes(word);
    let start = 0;
    while (start < core.length - 1 && !/[\p{L}\p{N}]/u.test(core[start])) start += 1;
    let end = core.length;
    while (end > start + 1 && !/[\p{L}\p{N}]/u.test(core[end - 1])) end -= 1;
    const length = end - start;
    const offset = length <= 1 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : length <= 13 ? 3 : 4;
    return start + offset;
  };

  const splitAtPivot = (word) => {
    const units = graphemes(word);
    const pivot = Math.min(pivotIndex(word), Math.max(0, units.length - 1));
    return {
      before: units.slice(0, pivot).join(""),
      pivot: units[pivot] ?? "",
      after: units.slice(pivot + 1).join("")
    };
  };

  /** Display time for one token, in milliseconds. */
  const tokenDelay = (token, wpm) => {
    const base = 60000 / clamp(wpm, LIMITS.wpm[0], LIMITS.wpm[1]);
    const text = token.text;
    let factor = 1;
    if (SENTENCE_END.test(text)) factor = 2.2;
    else if (CLAUSE_END.test(text)) factor = 1.5;
    const length = graphemes(text).length;
    if (length > 8) factor += Math.min(0.8, (length - 8) * 0.08);
    if (token.paragraphStart) factor += 0.8;
    return Math.round(base * factor);
  };

  /** Total estimated reading time in milliseconds from `from` to the end. */
  const remainingTime = (tokens, from, wpm) => {
    let total = 0;
    for (let index = Math.max(0, from); index < tokens.length; index += 1) {
      total += tokenDelay(tokens[index], wpm);
    }
    return total;
  };

  /** Index of the first token of the sentence containing `index`. */
  const sentenceStart = (tokens, index) => {
    let cursor = clamp(index, 0, Math.max(0, tokens.length - 1));
    while (cursor > 0 && !SENTENCE_END.test(tokens[cursor - 1].text) && !tokens[cursor].paragraphStart) {
      cursor -= 1;
    }
    return cursor;
  };

  const formatDuration = (ms) => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  };

  root.MdReaderCore = Object.freeze({
    DEFAULTS,
    LIMITS,
    WORD_PATTERN,
    clamp,
    graphemes,
    normalizeSettings,
    bionicFocusLength,
    bionicParts,
    tokenize,
    pivotIndex,
    splitAtPivot,
    tokenDelay,
    remainingTime,
    sentenceStart,
    formatDuration
  });
})(globalThis);
