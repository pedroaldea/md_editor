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
    autoBionicSites: [],
    readerFontSize: 20,
    readerWidth: 680,
    readerFont: "serif"
  });

  const LIMITS = Object.freeze({
    wpm: [100, 1200],
    fontScale: [60, 200],
    bionicFixation: [0.2, 0.8],
    bionicMinWord: [1, 12],
    bionicWeight: [500, 900],
    readerFontSize: [14, 30],
    readerWidth: [520, 960]
  });

  /**
   * Reading palettes shared by every surface (Quick Read, Reader, .md viewer,
   * popup). "auto" follows the system between light and dark.
   */
  const THEMES = Object.freeze({
    light: { label: "Claro", scheme: "light", bg: "#fbfaf7", fg: "#1d1c1a", muted: "#6b675f", line: "#e3dfd6", panel: "#ffffff", accent: "#d1341f", link: "#1f5fbf", code: "#f1eee7", mark: "#ffe58a" },
    sepia: { label: "Sepia", scheme: "light", bg: "#f5ecd9", fg: "#3a2e21", muted: "#7b6a54", line: "#e3d5b9", panel: "#fbf5e8", accent: "#b4441f", link: "#8a4b12", code: "#ece0c5", mark: "#f3cf73" },
    dim: { label: "Tenue", scheme: "dark", bg: "#2a2c30", fg: "#cfccc5", muted: "#93908a", line: "#3c3f44", panel: "#323539", accent: "#e58b72", link: "#94b8ea", code: "#34373c", mark: "#6b5a2a" },
    dark: { label: "Oscuro", scheme: "dark", bg: "#131312", fg: "#e9e7e1", muted: "#a29e94", line: "#2f2e2b", panel: "#1d1c1a", accent: "#ff5a43", link: "#7fb0ff", code: "#1d1c1a", mark: "#6b5a2a" }
  });
  const THEME_NAMES = ["auto", ...Object.keys(THEMES)];

  const themeVars = (theme) =>
    `color-scheme: ${theme.scheme}; --bg: ${theme.bg}; --fg: ${theme.fg}; --muted: ${theme.muted}; --line: ${theme.line}; --panel: ${theme.panel}; --accent: ${theme.accent}; --link: ${theme.link}; --code: ${theme.code}; --mark: ${theme.mark};`;

  /** CSS that paints `selector[data-theme=…]` with each palette, auto included. */
  const themeCss = (selector) =>
    [
      `${selector} { ${themeVars(THEMES.light)} }`,
      ...Object.entries(THEMES).map(([name, theme]) => `${selector}[data-theme="${name}"] { ${themeVars(theme)} }`),
      `@media (prefers-color-scheme: dark) { ${selector}[data-theme="auto"] { ${themeVars(THEMES.dark)} } }`
    ].join("\n");

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // Class/id tokens of ads, trackers' widgets, consent walls, share bars,
  // newsletters, related-content rails and comments. Whole tokens only, so
  // "thread-list" or "header" never match "ad".
  // Ad families may carry a prefix ("top-ad", "div-gpt-ad-1"); generic ones
  // only count as the first word ("share-bar", not "SharedMarkdownContent"
  // or a layout wrapper such as "has-sidebar").
  const AD_WORDS = "ads?|adv|advert\\w*|advertis\\w*|dfp|gpt|sponsor\\w*|promo\\w*";
  const LEAD_WORDS =
    "newsletter|subscribe|subscription|paywall|social|share|sharing|related|recommended|recommendations|outbrain|taboola|cookies?|consent|gdpr|popup|modal|sidebar|comments?|disqus|breadcrumbs?";
  const CLUTTER_TOKEN = new RegExp(
    `^(?:(?:[a-z0-9]+[-_])*(?:${AD_WORDS})|(?:${LEAD_WORDS}))(?:[-_][\\w-]*)?$`,
    "iu"
  );
  const CLUTTER_SELECTOR =
    "ins.adsbygoogle, [data-ad], [data-ad-slot], [data-ad-unit], [data-google-query-id], [id^='google_ads'], [id^='div-gpt-ad'], [aria-label*='advert' i], [aria-label*='anuncio' i], [aria-label*='publicidad' i]";

  /** True for ads and page clutter that never belongs to the reading text. */
  // Content containers are never clutter, whatever their classes say:
  // Substack marks every post <article class="newsletter-post">.
  const CONTENT_CONTAINER = "article, main, [role='main'], [itemprop='articleBody']";

  const isClutter = (element) => {
    if (!element || element.nodeType !== 1) return false;
    if (element.matches(CONTENT_CONTAINER)) return false;
    if (element.matches(CLUTTER_SELECTOR)) return true;
    const className = typeof element.className === "string" ? element.className : "";
    const tokens = `${element.id || ""} ${className}`.split(/\s+/u);
    return tokens.some((token) => token && CLUTTER_TOKEN.test(token));
  };

  /** True when `element` or an ancestor below `stop` is clutter. */
  const inClutter = (element, stop) => {
    for (let node = element; node && node !== stop && node.nodeType === 1; node = node.parentElement) {
      if (isClutter(node)) return true;
    }
    return false;
  };

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
    out.readerFontSize = Math.round(out.readerFontSize);
    out.readerWidth = Math.round(out.readerWidth / 20) * 20;
    if (THEME_NAMES.includes(source.theme)) out.theme = source.theme;
    if (source.readerFont === "serif" || source.readerFont === "sans") out.readerFont = source.readerFont;
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
      // Numbers such as "2023" read as one glyph group; splitting them hurts.
      if (units.length >= minWord && /\p{L}/u.test(word)) {
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
    THEMES,
    THEME_NAMES,
    themeCss,
    WORD_PATTERN,
    clamp,
    graphemes,
    isClutter,
    inClutter,
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
