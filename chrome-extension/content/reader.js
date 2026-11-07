// Reader mode: the page's main article rebuilt from an allow-list of tags into
// an isolated Shadow DOM, without ads, menus, pop-ups or the site's styles.
(function (root) {
  "use strict";

  if (root.MdReaderReader) return;
  const core = root.MdReaderCore;
  const quickRead = root.MdReaderQuickRead;
  const bionic = root.MdReaderBionic;

  const HOST_ID = "mdr-reader-host";
  // Tags copied as themselves; anything else is unwrapped (children kept) or dropped.
  const KEEP = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE",
    "EM", "I", "STRONG", "B", "A", "IMG", "FIGURE", "FIGCAPTION", "TABLE", "THEAD", "TBODY",
    "TFOOT", "TR", "TH", "TD", "CAPTION", "HR", "BR", "SUB", "SUP", "MARK", "U", "S", "DEL",
    "INS", "DL", "DT", "DD", "Q", "CITE", "ABBR", "KBD", "SMALL", "TIME"
  ]);
  const DROP =
    "script, style, noscript, template, iframe, object, embed, video, audio, canvas, svg, form, button, input, select, textarea, nav, aside, footer, header:not(article header), dialog, menu, [role='navigation'], [role='complementary'], [role='banner'], [role='contentinfo'], [role='dialog'], [role='alert'], [role='status'], [aria-hidden='true'], [hidden], .noprint, .mw-editsection, sup.reference, .ambox, .navbox, .metadata, .hatnote, .mw-redirectedfrom, #contentSub, #siteSub, .mw-jump-link, #toc, .toc, .sr-only, .visually-hidden, #mdr-quickread-host, #" +
    HOST_ID;
  const SAFE_URL = /^(?:https?:|mailto:)/iu;

  const meta = (doc, ...names) => {
    for (const name of names) {
      const element = doc.querySelector(`meta[property='${name}'], meta[name='${name}']`);
      const value = element?.getAttribute("content")?.trim();
      if (value) return value;
    }
    return "";
  };

  const absolute = (value, base) => {
    try {
      const url = new URL(value, base);
      return SAFE_URL.test(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };

  const imageSource = (image, base) => {
    const lazy = image.getAttribute("data-src") || image.getAttribute("data-lazy-src") || image.getAttribute("data-original");
    return absolute(image.currentSrc || lazy || image.getAttribute("src") || "", base);
  };

  /**
   * Old sites lay pages out with tables (paulgraham.com). A table is data when
   * it has headers or a caption, or a regular grid of short cells without
   * nested tables; anything else is unwrapped so only its text flows.
   */
  const isDataTable = (table) => {
    if (table.querySelector("table")) return false;
    if (table.querySelector("th, caption, thead")) return true;
    const rows = Array.from(table.rows || []);
    if (rows.length < 2) return false;
    const cells = rows.flatMap((row) => Array.from(row.cells));
    const wide = rows.filter((row) => row.cells.length >= 2).length;
    const longest = Math.max(...cells.map((cell) => cell.textContent.trim().length));
    return wide >= 2 && longest < 300;
  };

  const LAYOUT_TABLE_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CAPTION"]);

  /** Cleans "Title - Site" style document titles using the page heading. */
  const cleanTitle = (candidates, heading, site) => {
    const clean = (value) => (value || "").replace(/\s+/gu, " ").trim();
    const headingText = clean(heading);
    for (const candidate of candidates.map(clean).filter(Boolean)) {
      if (headingText && candidate.includes(headingText)) return headingText;
      const parts = candidate.split(/\s+[-|–—·:]\s+/u);
      if (parts.length > 1) {
        // Drop the part that names the site (first or last), keep the rest.
        const lower = site.toLowerCase();
        const isSite = (part) => lower && (part.toLowerCase().includes(lower) || lower.includes(part.toLowerCase()));
        if (isSite(parts.at(-1))) return parts.slice(0, -1).join(" – ");
        if (isSite(parts[0])) return parts.slice(1).join(" – ");
      }
      return candidate;
    }
    return headingText;
  };

  const BOX_TAGS = new Set(["DIV", "SECTION", "HEADER", "ADDRESS", "DETAILS", "CENTER"]);

  /** Adds one space when `target` ends in a word, so the next text stays apart. */
  const separate = (target, doc) => {
    const last = target.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE ? /\S$/u.test(last.nodeValue) : last && /\S$/u.test(last.textContent || "")) {
      target.append(doc.createTextNode(" "));
    }
  };

  const hiddenByStyle = (element) => {
    const style = root.getComputedStyle?.(element);
    return Boolean(style && (style.display === "none" || style.visibility === "hidden"));
  };

  /** Rebuilds `source` into `target` keeping only reading markup and safe attributes. */
  const rebuild = (source, target, doc, context) => {
    for (const node of source.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        target.append(doc.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches(DROP) || core.isClutter(node) || hiddenByStyle(node)) continue;

      const tag = node.tagName;
      if (tag === "TABLE") context.layout.set(node, !isDataTable(node));
      const layoutTable = node.closest("table");
      if (LAYOUT_TABLE_TAGS.has(tag) && layoutTable && context.layout.get(layoutTable)) {
        rebuild(node, target, doc, context);
        if (tag === "TD" || tag === "TR") target.append(doc.createTextNode(" "));
        continue;
      }
      if (tag === "PICTURE") {
        const image = node.querySelector("img");
        if (image) rebuild({ childNodes: [image] }, target, doc, context);
        continue;
      }
      if (!KEEP.has(tag)) {
        // Unwrapped boxes (often flex rows: author + date, tweet cards) must not
        // glue their words to the neighbours once the layout is gone.
        const box = BOX_TAGS.has(tag);
        if (box) separate(target, doc);
        rebuild(node, target, doc, context);
        if (box) separate(target, doc);
        continue;
      }
      if (tag === "H1" && node.textContent.trim() === context.title) continue;

      const copy = doc.createElement(tag.toLowerCase());
      if (tag === "A") {
        const href = absolute(node.getAttribute("href") || "", context.base);
        if (href) {
          copy.href = href;
          copy.target = "_blank";
          copy.rel = "noopener noreferrer";
        }
      } else if (tag === "IMG") {
        const src = imageSource(node, context.base);
        const width = Number(node.getAttribute("width")) || node.naturalWidth || 0;
        const height = Number(node.getAttribute("height")) || node.naturalHeight || 0;
        const alt = (node.getAttribute("alt") || "").trim();
        // Tracking pixels, icons, badges, logo strips and a title drawn as an
        // image are not illustrations.
        // Image maps (usemap) are navigation drawn as a picture.
        if (!src || node.hasAttribute("usemap") || (width > 0 && width < 48) || (height > 0 && height < 64) || (alt && alt === context.title)) continue;
        copy.src = src;
        copy.alt = node.getAttribute("alt") || "";
        copy.loading = "lazy";
        copy.referrerPolicy = "no-referrer";
        target.append(copy);
        continue;
      } else if (tag === "TD" || tag === "TH") {
        for (const name of ["colspan", "rowspan"]) {
          if (node.hasAttribute(name)) copy.setAttribute(name, node.getAttribute(name));
        }
      }
      rebuild(node, copy, doc, context);
      target.append(copy);
    }
  };

  const blank = (node) =>
    node && ((node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) || node.nodeName === "BR");

  const prune = (container) => {
    // Layout pages pad with runs of <br>: keep at most two in a row, none at the edges.
    container.querySelectorAll("br").forEach((br) => {
      let previous = br.previousSibling;
      while (previous && previous.nodeType === Node.TEXT_NODE && !previous.nodeValue.trim()) previous = previous.previousSibling;
      let before = previous;
      let count = 0;
      while (before && before.nodeName === "BR") {
        count += 1;
        before = before.previousSibling;
        while (before && before.nodeType === Node.TEXT_NODE && !before.nodeValue.trim()) before = before.previousSibling;
      }
      if (count >= 2 || !before) br.remove();
    });
    while (blank(container.firstChild)) container.firstChild.remove();
    while (blank(container.lastChild)) container.lastChild.remove();
    // Drop blocks that ended up empty after removing their clutter.
    container.querySelectorAll("p, li, figure, blockquote, h2, h3, h4, h5, h6, ul, ol, table").forEach((element) => {
      if (!element.textContent.trim() && !element.querySelector("img")) element.remove();
    });
  };

  /** Extracts the reading view of `doc`. Pure apart from reading the live DOM. */
  const extract = (doc = document) => {
    const mainRoot = quickRead.findMainRoot(doc);
    const site = meta(doc, "og:site_name", "application-name") || root.location.hostname.replace(/^www\./u, "");
    // The article's own headline beats SEO-flavoured <title>/og:title text.
    const articleHeading = mainRoot.querySelector("h1")?.textContent.replace(/\s+/gu, " ").trim();
    const heading = articleHeading || doc.querySelector("h1")?.textContent || "";
    const title = articleHeading || cleanTitle([meta(doc, "og:title", "twitter:title"), doc.title], heading, site);
    const author = meta(doc, "author", "article:author", "twitter:creator");
    const published = meta(doc, "article:published_time", "date", "pubdate");
    const article = doc.createElement("div");
    rebuild(mainRoot, article, doc, { base: doc.baseURI, title: title.trim(), layout: new Map() });
    prune(article);
    const words = core.tokenize(article.textContent).length;
    return { title: title.trim(), site, author, published, article, words };
  };

  const STYLE = `
    :host { all: initial; }
    .reader {
      position: fixed; inset: 0; z-index: 2147483647; overflow-y: auto; overscroll-behavior: contain;
      background: var(--bg); color: var(--fg); -webkit-font-smoothing: antialiased;
      font: 15px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: mdr-in .16s ease-out;
    }
    ${core.themeCss(".reader")}
    .reader:focus { outline: none; }
    @keyframes mdr-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .reader { animation: none; } }
    .bar {
      position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; padding: 10px 16px;
      background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--line);
    }
    .site { flex: 1 1 auto; min-width: 0; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .group { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 10px; }
    button {
      all: unset; box-sizing: border-box; cursor: pointer; height: 34px; min-width: 34px; padding: 0 10px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--fg); font: inherit;
    }
    button:hover { background: color-mix(in srgb, var(--fg) 7%, transparent); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
    button:disabled { opacity: .35; cursor: default; }
    button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .swatch { width: 18px; height: 18px; padding: 0; min-width: 34px; }
    .swatch span { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--line); display: block; }
    .swatch[aria-checked="true"] span { outline: 2px solid var(--accent); outline-offset: 2px; }
    .page { box-sizing: border-box; max-width: calc(var(--width) + 40px); margin: 0 auto; padding: 48px 20px 160px; }
    .kicker { color: var(--muted); font-size: 14px; margin: 0 0 10px; }
    h1.title { font: 700 clamp(28px, 4.2vw, 42px)/1.15 ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; margin: 0 0 14px; letter-spacing: -.01em; text-wrap: balance; }
    .byline { color: var(--muted); font-size: 14px; margin: 0 0 36px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
    article { font-size: var(--size); line-height: 1.7; overflow-wrap: break-word; }
    .reader[data-font="serif"] article { font-family: ui-serif, "Iowan Old Style", Charter, Georgia, serif; }
    .reader[data-font="sans"] article { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    article h2, article h3, article h4 { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.25; margin: 1.8em 0 .6em; }
    article h2 { font-size: 1.4em; } article h3 { font-size: 1.18em; } article h4 { font-size: 1em; }
    article p, article ul, article ol, article blockquote, article figure, article pre, article table { margin: 0 0 1.1em; }
    article a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    article img { display: block; max-width: 100%; height: auto; margin: 1.4em auto; border-radius: 6px; }
    article figure img { margin-bottom: .5em; }
    article figcaption { color: var(--muted); font-size: .8em; text-align: center; }
    article blockquote { padding-left: 1em; border-left: 3px solid var(--accent); color: var(--muted); font-style: italic; }
    article pre { background: var(--code); padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: .78em; line-height: 1.55; }
    article code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em; background: var(--code); padding: .1em .3em; border-radius: 4px; }
    article pre code { background: none; padding: 0; font-size: inherit; }
    article table { display: block; overflow-x: auto; border-collapse: collapse; font-size: .85em; color: inherit; }
    /* Quirks-mode pages (no doctype) stop colour and font inheriting into tables. */
    article td, article th { color: inherit; font-family: inherit; line-height: 1.5; }
    article th, article td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
    article hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
    article mark { background: var(--mark); color: inherit; }
    article li { margin: .25em 0; }
    .empty { color: var(--muted); text-align: center; padding: 80px 20px; font-size: 17px; }
    .progress { position: fixed; top: 0; left: 0; height: 3px; background: var(--accent); width: 0; z-index: 2; }
    .label { font-variant-numeric: tabular-nums; min-width: 40px; text-align: center; color: var(--muted); font-size: 13px; }
    @media (max-width: 720px) {
      .bar { flex-wrap: wrap; padding: 8px 10px; }
      .site { display: none; }
      .page { padding-top: 28px; }
      .hide-mobile { display: none; }
    }
  `;

  const ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    narrower: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14M3 12h4M17 12h4"/></svg>',
    wider: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14M20 5v14M8 12h8M11 9l-3 3 3 3M13 9l3 3-3 3"/></svg>',
    quick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4l12 8-12 8z"/></svg>'
  };

  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  };

  let active = null;

  const open = ({ settings, onSettingsChange }) => {
    close();
    const data = extract(document);
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    const bionicStyle = document.createElement("style");
    const swatches = core.THEME_NAMES.map((name) => {
      const theme = name === "auto" ? null : core.THEMES[name];
      const fill = theme ? theme.bg : "linear-gradient(135deg, #fbfaf7 50%, #131312 50%)";
      const label = theme ? theme.label : "Automático";
      return `<button type="button" class="swatch" role="radio" data-theme-option="${name}" aria-label="Tema ${label}" title="${label}"><span style="background:${fill}"></span></button>`;
    }).join("");
    style.textContent = STYLE;
    shadow.append(style, bionicStyle);
    const reader = document.createElement("div");
    reader.className = "reader";
    reader.setAttribute("role", "dialog");
    reader.setAttribute("aria-modal", "true");
    reader.setAttribute("aria-label", "Modo lectura");
    // Static markup only: page-derived text is inserted below with textContent.
    reader.innerHTML = `
      <div class="progress" aria-hidden="true"></div>
      <div class="bar">
        <span class="site"></span>
        <span class="group" role="group" aria-label="Tamaño de letra">
          <button type="button" data-action="smaller" aria-label="Letra más pequeña">A−</button>
          <span class="label size"></span>
          <button type="button" data-action="bigger" aria-label="Letra más grande">A+</button>
        </span>
        <span class="group hide-mobile" role="group" aria-label="Ancho de columna">
          <button type="button" data-action="narrower" aria-label="Columna más estrecha">${ICON.narrower}</button>
          <button type="button" data-action="wider" aria-label="Columna más ancha">${ICON.wider}</button>
        </span>
        <span class="group" role="group" aria-label="Tipografía">
          <button type="button" data-action="font" aria-label="Cambiar entre serif y sans">Aa</button>
        </span>
        <span class="group" role="radiogroup" aria-label="Tema">${swatches}</span>
        <span class="group" role="group" aria-label="Lectura">
          <button type="button" data-action="bionic" aria-pressed="false">Bionic</button>
          <button type="button" data-action="quick" aria-label="Lectura rápida">${ICON.quick}<span class="hide-mobile">Rápida</span></button>
        </span>
        <button type="button" data-action="close" aria-label="Salir del modo lectura">${ICON.close}</button>
      </div>
      <main class="page">
        <p class="kicker"></p>
        <h1 class="title"></h1>
        <p class="byline"></p>
        <article></article>
      </main>`;
    shadow.append(reader);
    document.documentElement.append(host);

    const $ = (selector) => shadow.querySelector(selector);
    const article = $("article");
    $(".site").textContent = data.site;
    $(".kicker").textContent = data.site;
    $(".title").textContent = data.title;
    const minutes = Math.max(1, Math.round(data.words / 230));
    $(".byline").textContent = [data.author, formatDate(data.published), `${minutes} min de lectura`]
      .filter(Boolean)
      .join(" · ");

    if (data.words < 8) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Esta página no tiene un artículo para el modo lectura. Abre una noticia o una entrada, o prueba la Lectura rápida.";
      article.append(empty);
    } else {
      article.append(...data.article.childNodes);
    }

    const state = { ...settings, bionicOn: bionic.isEnabled() };
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const render = () => {
      reader.dataset.theme = state.theme;
      reader.dataset.font = state.readerFont;
      reader.style.setProperty("--size", `${state.readerFontSize}px`);
      reader.style.setProperty("--width", `${state.readerWidth}px`);
      $(".size").textContent = String(state.readerFontSize);
      $("[data-action='smaller']").disabled = state.readerFontSize <= core.LIMITS.readerFontSize[0];
      $("[data-action='bigger']").disabled = state.readerFontSize >= core.LIMITS.readerFontSize[1];
      $("[data-action='narrower']").disabled = state.readerWidth <= core.LIMITS.readerWidth[0];
      $("[data-action='wider']").disabled = state.readerWidth >= core.LIMITS.readerWidth[1];
      $("[data-action='font']").style.fontFamily = state.readerFont === "serif" ? "ui-serif, Georgia, serif" : "inherit";
      shadow.querySelectorAll("[data-theme-option]").forEach((button) =>
        button.setAttribute("aria-checked", String(button.dataset.themeOption === state.theme))
      );
      $("[data-action='bionic']").setAttribute("aria-pressed", String(state.bionicOn));
      bionicStyle.textContent = bionic.css();
    };

    const update = (patch) => {
      Object.assign(state, patch);
      const { bionicOn, ...rest } = state;
      void bionicOn;
      onSettingsChange?.(rest);
      render();
    };

    const setBionic = (value) => {
      state.bionicOn = value;
      if (value) bionic.applyTo(article);
      else bionic.revertIn(article);
      render();
    };

    const step = (key, delta) => {
      const [min, max] = core.LIMITS[key];
      update({ [key]: core.clamp(state[key] + delta, min, max) });
    };

    const actions = {
      close,
      smaller: () => step("readerFontSize", -1),
      bigger: () => step("readerFontSize", 1),
      narrower: () => step("readerWidth", -60),
      wider: () => step("readerWidth", 60),
      font: () => update({ readerFont: state.readerFont === "serif" ? "sans" : "serif" }),
      bionic: () => setBionic(!state.bionicOn),
      quick: () =>
        quickRead.open({
          text: quickRead.blockText(article),
          title: data.title,
          settings: { ...core.normalizeSettings(state) },
          onSettingsChange
        })
    };

    shadow.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button || button.disabled) return;
      if (button.dataset.themeOption) update({ theme: button.dataset.themeOption });
      else actions[button.dataset.action]?.();
    });

    const progress = $(".progress");
    const onScroll = () => {
      const max = reader.scrollHeight - reader.clientHeight;
      progress.style.width = `${max > 0 ? (reader.scrollTop / max) * 100 : 0}%`;
    };
    reader.addEventListener("scroll", onScroll, { passive: true });

    const onKey = (event) => {
      // Quick Read opened on top owns the keyboard.
      if (quickRead.isOpen() || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);

    const onBionicChanged = (event) => setBionic(Boolean(event.detail));
    root.addEventListener("mdr:bionic-changed", onBionicChanged);

    active = {
      host,
      setSettings(next) {
        Object.assign(state, next);
        render();
      },
      teardown() {
        window.removeEventListener("keydown", onKey, true);
        root.removeEventListener("mdr:bionic-changed", onBionicChanged);
        document.documentElement.style.overflow = previousOverflow;
        host.remove();
      }
    };

    render();
    if (state.bionicOn) bionic.applyTo(article);
    reader.tabIndex = -1;
    reader.focus({ preventScroll: true });
    return active;
  };

  function close() {
    if (!active) return;
    const current = active;
    active = null;
    quickRead.close();
    current.teardown();
  }

  root.MdReaderReader = {
    open,
    close,
    extract,
    isOpen: () => Boolean(active),
    setSettings: (next) => active?.setSettings(next)
  };
})(globalThis);
