// Renders raw .md documents (web or file://) as a clean, sanitized reading page.
(function (root) {
  "use strict";

  if (root.MdReaderMarkdown) return;

  const MD_PATH = /\.(md|markdown|mdown|mkd|mkdn)$/iu;

  /** True when the tab shows a raw Markdown file as Chrome's plain-text view. */
  const isRawMarkdown = (doc = document, location = root.location) => {
    const type = (doc.contentType || "").toLowerCase();
    const markdownType = type === "text/markdown" || type === "text/x-markdown";
    const plainMarkdownPath = type === "text/plain" && MD_PATH.test(location.pathname);
    if (!markdownType && !plainMarkdownPath) return false;
    const body = doc.body;
    return Boolean(body && body.children.length === 1 && body.firstElementChild.tagName === "PRE");
  };

  const STYLE = `
    ${root.MdReaderCore.themeCss(":root")}
    :root { --width: 760px; }
    html { background: var(--bg); }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 18px/1.7 ui-serif, Georgia, "Iowan Old Style", serif; }
    .mdr-bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 10px 16px;
      background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line);
      font: 14px/1.2 ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; }
    .mdr-bar .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .mdr-bar button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 7px 11px; cursor: pointer; }
    .mdr-bar button[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
    article { box-sizing: border-box; max-width: var(--width); margin: 0 auto; padding: 40px 20px 120px; overflow-wrap: anywhere; }
    h1, h2, h3, h4 { line-height: 1.25; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; }
    h1 { font-size: 2.1em; } h2 { font-size: 1.5em; border-bottom: 1px solid var(--line); padding-bottom: .25em; }
    a { color: var(--link); }
    code { font: .86em/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); padding: .1em .35em; border-radius: 4px; }
    pre { background: var(--code); padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: 3px solid var(--line); }
    table { border-collapse: collapse; display: block; overflow-x: auto; }
    th, td { border: 1px solid var(--line); padding: 6px 12px; }
    img { max-width: 100%; height: auto; }
    hr { border: 0; border-top: 1px solid var(--line); }
    mark { background: var(--mark); color: inherit; }
    .raw { white-space: pre-wrap; font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  `;

  // ==highlight== and ++underline++ match the desktop app's Markdown marks and,
  // like the app, are applied to text nodes outside code only.
  const applyInlineMarks = (container) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement.closest("pre, code, kbd, samp") && /==|\+\+/u.test(node.nodeValue)) nodes.push(node);
    }
    nodes.forEach((node) => {
      const input = node.nodeValue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of input.matchAll(/==([^=\n]+)==|\+\+([^+\n]+)\+\+/gu)) {
        if (match.index > cursor) fragment.append(input.slice(cursor, match.index));
        const element = document.createElement(match[1] ? "mark" : "u");
        element.textContent = match[1] ?? match[2];
        fragment.append(element);
        cursor = match.index + match[0].length;
      }
      if (cursor === 0) return;
      if (cursor < input.length) fragment.append(input.slice(cursor));
      node.replaceWith(fragment);
    });
  };

  /** Markdown source → sanitized HTML string. */
  const render = (source) => {
    const html = root.marked.parse(source, { gfm: true, breaks: false, async: false });
    // The page runs on the file's own origin: allow document markup only, no
    // forms, embedded styles or frames that could imitate the site.
    return root.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "style", "iframe", "frame", "object", "embed", "dialog", "base", "meta", "link"],
      FORBID_ATTR: ["style", "srcset", "formaction", "action", "ping"]
    });
  };

  const mount = ({ settings, onBionic, onQuickRead, isBionic }) => {
    if (!isRawMarkdown()) return false;
    const source = document.body.firstElementChild.textContent || "";
    const name = decodeURIComponent(root.location.pathname.split("/").pop() || "documento.md");

    document.documentElement.dataset.theme = settings.theme;
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.append(style);

    const bar = document.createElement("div");
    bar.className = "mdr-bar mdr-skip";
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name;
    const button = (text, title) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = text;
      element.title = title;
      return element;
    };
    const bionicButton = button("Bionic", "Alternar lectura biónica (⌥⇧B)");
    const quickButton = button("Lectura rápida", "Abrir lectura rápida (⌥⇧R)");
    const rawButton = button("Fuente", "Ver el Markdown original");
    bionicButton.setAttribute("aria-pressed", String(isBionic()));
    rawButton.setAttribute("aria-pressed", "false");
    bar.append(label, bionicButton, quickButton, rawButton);

    const article = document.createElement("article");
    article.innerHTML = render(source);
    applyInlineMarks(article);
    const raw = document.createElement("pre");
    raw.className = "raw mdr-skip";
    raw.textContent = source;
    raw.hidden = true;

    const firstHeading = article.querySelector("h1");
    document.title = firstHeading ? firstHeading.textContent.trim() : name;
    document.body.replaceChildren(bar, article, raw);

    bionicButton.addEventListener("click", () => bionicButton.setAttribute("aria-pressed", String(onBionic())));
    quickButton.addEventListener("click", () => onQuickRead());
    rawButton.addEventListener("click", () => {
      const showRaw = raw.hidden;
      raw.hidden = !showRaw;
      article.hidden = showRaw;
      rawButton.setAttribute("aria-pressed", String(showRaw));
    });
    root.addEventListener("mdr:bionic-changed", (event) =>
      bionicButton.setAttribute("aria-pressed", String(event.detail))
    );
    return true;
  };

  root.MdReaderMarkdown = { isRawMarkdown, render, applyInlineMarks, mount };
})(globalThis);
