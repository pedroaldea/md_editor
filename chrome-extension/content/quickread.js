// Quick Read (RSVP) overlay for any page, isolated in a Shadow DOM.
(function (root) {
  "use strict";

  if (root.MdReaderQuickRead) return;
  const core = root.MdReaderCore;

  const HOST_ID = "mdr-quickread-host";
  const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dd, dt";
  // Not prose: code, tables, chrome, notices and boxes (e.g. Wikipedia's
  // maintenance banners and infoboxes) are noise when read word by word.
  const NOISE =
    "pre, table, nav, aside, footer, header, form, menu, dialog, [role='navigation'], [role='complementary'], [role='banner'], [role='contentinfo'], [role='note'], [role='alert'], [role='status'], [aria-hidden='true'], .noprint, .metadata, .ambox, .navbox, .infobox, .toc, .sr-only, .visually-hidden, .mdr-skip, #" +
    HOST_ID;
  // Inline bits that interrupt a sentence: footnote markers, edit links, hidden text.
  const INLINE_NOISE = "sup.reference, .mw-editsection, .noprint, script, style, [aria-hidden='true'], .sr-only, .visually-hidden";
  const FOOTNOTE = /\[(?:\d+|[a-z]|nota \d+|cita requerida)\]/giu;
  const CANDIDATES =
    "article, main, [role='main'], [itemprop='articleBody'], .markdown-body, .post-content, .entry-content, .article-body, #content";

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    if (element.hidden) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const textLength = (element) => (element.textContent || "").replace(/\s+/gu, " ").trim().length;

  /** Picks the element that most likely holds the page's main reading text. */
  const findMainRoot = (doc) => {
    const scored = new Map();
    const paragraphs = doc.body ? doc.body.querySelectorAll("p, li") : [];
    paragraphs.forEach((paragraph) => {
      if (paragraph.closest(NOISE) || core.inClutter(paragraph, doc.body)) return;
      const length = textLength(paragraph);
      if (length < 40) return;
      let parent = paragraph.parentElement;
      let weight = 1;
      // Credit the parent fully and the grandparent partially, like Readability.
      for (let depth = 0; parent && depth < 3; depth += 1) {
        scored.set(parent, (scored.get(parent) || 0) + length * weight);
        parent = parent.parentElement;
        weight /= 2;
      }
    });

    let best = null;
    let bestScore = 0;
    scored.forEach((score, element) => {
      if (score > bestScore && visible(element)) {
        best = element;
        bestScore = score;
      }
    });

    const semantic = Array.from(doc.querySelectorAll(CANDIDATES)).filter(
      (element) => visible(element) && textLength(element) > 200
    );
    const container = semantic.find((element) => best && element.contains(best));
    if (container && textLength(container) < textLength(best) * 3) return container;
    return best || semantic[0] || doc.body;
  };

  /** Readable text of `element`, one block per paragraph. */
  const IGNORED = "script, style, noscript, template, svg, math, canvas, iframe, object, button, select, textarea, input";
  // Elements whose edges separate words even with no whitespace in the source,
  // e.g. HN's <a>Hacker News</a><a>new</a>.
  const SEPARATING = new Set([
    "A", "TD", "TH", "TR", "LI", "P", "DIV", "BR", "H1", "H2", "H3", "H4", "H5", "H6",
    "SECTION", "ARTICLE", "HEADER", "FOOTER", "BLOCKQUOTE", "DD", "DT", "FIGCAPTION", "LABEL"
  ]);

  const separatorOf = (node, stop) => {
    for (let element = node.parentElement; element && element !== stop; element = element.parentElement) {
      if (SEPARATING.has(element.tagName)) return element;
    }
    return stop;
  };

  /** Text of `element` with words kept apart at link/cell/block edges. */
  const readableText = (element, skip) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return node.parentElement && !node.parentElement.closest(skip) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let text = "";
    let previousOwner = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        text += "\n";
        continue;
      }
      const owner = separatorOf(node, element);
      if (previousOwner && owner !== previousOwner && !/\s$/u.test(text) && !/^\s/u.test(node.nodeValue)) {
        text += " ";
      }
      text += node.nodeValue;
      previousOwner = owner;
    }
    return text.replace(FOOTNOTE, "").replace(/[ \t\r\f\v]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
  };

  const blockText = (element) => {
    const blocks = Array.from(element.querySelectorAll(BLOCKS)).filter(
      (block) =>
        !block.closest(NOISE) &&
        !core.inClutter(block, element.parentElement) &&
        // Keep the innermost blocks only, so <li><p>…</p></li> is read once.
        !block.querySelector(BLOCKS) &&
        visible(block)
    );
    const skip = `${IGNORED}, ${INLINE_NOISE}`;
    const parts = blocks.map((block) => readableText(block, skip).replace(/\s+/gu, " "));
    const text = parts.filter(Boolean).join("\n\n");
    if (text.length > 0) return text;
    // Pages without prose blocks (link lists, apps): read what is visible, never code.
    return readableText(element, `${IGNORED}, ${NOISE.replace("table, ", "")}, ${INLINE_NOISE}`);
  };

  const extractPageText = (doc = document) => {
    const selection = doc.getSelection?.();
    const selected = selection ? selection.toString().trim() : "";
    if (selected && core.tokenize(selected).length >= 2) {
      return { source: "selection", text: selected };
    }
    return { source: "page", text: blockText(findMainRoot(doc)) };
  };

  const STYLE = `
    :host { all: initial; }
    .overlay {
      position: fixed; inset: 0; z-index: 2147483647; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr);
      background: var(--bg); color: var(--fg);
      font: 15px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased; animation: mdr-in .16s ease-out;
    }
    ${core.themeCss(".overlay")}
    header, footer { display: flex; align-items: center; gap: 12px; padding: 14px 20px; }
    header { justify-content: space-between; border-bottom: 1px solid var(--line); }
    .title { flex: 1 1 auto; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { flex: none; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    header button { flex: none; }
    button {
      all: unset; box-sizing: border-box; cursor: pointer; min-width: 40px; height: 40px; padding: 0 12px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg);
      display: inline-flex; align-items: center; justify-content: center; font: inherit; font-variant-numeric: tabular-nums;
    }
    button:hover { border-color: var(--muted); }
    button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    @keyframes mdr-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .overlay { animation: none; } }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button:disabled { opacity: .4; cursor: default; }
    button.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); min-width: 96px; font-weight: 600; }
    .stage { position: relative; display: grid; place-items: center; overflow: hidden; padding: 0 16px; }
    .reticle { position: absolute; left: 50%; width: 2px; height: 18px; background: var(--accent); opacity: .55; transform: translateX(-50%); }
    .reticle.top { top: calc(50% - var(--size) * .95); }
    .reticle.bottom { top: calc(50% + var(--size) * .95 - 18px); }
    .word {
      display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); width: 100%;
      font: 500 var(--size)/1.15 ui-serif, Georgia, "Iowan Old Style", serif; white-space: pre;
      transform: scale(var(--fit, 1)); transform-origin: center;
    }
    .before { text-align: right; }
    .pivot { color: var(--accent); font-weight: 700; }
    .after { text-align: left; }
    .context {
      position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); width: min(720px, calc(100% - 32px));
      color: var(--muted); text-align: center; font-size: 15px; line-height: 1.55; max-height: 30%; overflow: auto;
    }
    .context mark { background: transparent; color: var(--fg); font-weight: 700; text-decoration: underline 2px var(--accent); text-underline-offset: 3px; }
    .empty { color: var(--muted); font-size: 18px; text-align: center; max-width: 520px; }
    footer { flex-direction: column; border-top: 1px solid var(--line); gap: 10px; }
    .progress { width: min(920px, 100%); accent-color: var(--accent); margin: 0; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
    .group { display: inline-flex; gap: 4px; align-items: center; }
    .value { min-width: 84px; text-align: center; font-variant-numeric: tabular-nums; }
    .hint { color: var(--muted); font-size: 12px; text-align: center; }
    @media (max-width: 560px) {
      header, footer { padding: 10px 12px; }
      .hint { display: none; }
      .value { min-width: 64px; }
    }
  `;

  const TEMPLATE = `
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="mdr-title">
      <header>
        <span class="title" id="mdr-title"></span>
        <span class="meta" aria-live="off"></span>
        <button type="button" data-action="close" aria-label="Cerrar lectura rápida"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="stage">
        <span class="reticle top" aria-hidden="true"></span>
        <div class="word" aria-live="off"><span class="before"></span><span class="pivot"></span><span class="after"></span></div>
        <span class="reticle bottom" aria-hidden="true"></span>
        <div class="context" hidden></div>
      </div>
      <footer>
        <input class="progress" type="range" min="0" value="0" step="1" aria-label="Posición en el texto" />
        <div class="controls">
          <button type="button" data-action="restart" aria-label="Volver al principio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg></button>
          <button type="button" data-action="back" aria-label="Frase anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6l-6 6 6 6M19 6l-6 6 6 6"/></svg></button>
          <button type="button" class="primary" data-action="play">Leer</button>
          <button type="button" data-action="forward" aria-label="Siguiente frase"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 6l6 6-6 6M5 6l6 6-6 6"/></svg></button>
          <span class="group" role="group" aria-label="Velocidad">
            <button type="button" data-action="slower" aria-label="Más lento">−</button>
            <span class="value wpm"></span>
            <button type="button" data-action="faster" aria-label="Más rápido">+</button>
          </span>
          <span class="group" role="group" aria-label="Tamaño del texto">
            <button type="button" data-action="smaller" aria-label="Texto más pequeño">A−</button>
            <span class="value size"></span>
            <button type="button" data-action="bigger" aria-label="Texto más grande">A+</button>
          </span>
        </div>
        <div class="hint">Espacio leer/pausa · ←/→ palabra · ⇧←/⇧→ frase · ↑/↓ velocidad · [ ] tamaño · Esc cerrar</div>
      </footer>
    </div>
  `;

  let active = null;

  const open = ({ text, title, settings, onSettingsChange, autoStart = false }) => {
    close();
    const tokens = core.tokenize(text);
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    document.documentElement.append(host);

    const $ = (selector) => shadow.querySelector(selector);
    const overlay = $(".overlay");
    const stage = $(".stage");
    const word = $(".word");
    const before = $(".before");
    const pivot = $(".pivot");
    const after = $(".after");
    const context = $(".context");
    const meta = $(".meta");
    const progress = $(".progress");
    const playButton = $("[data-action='play']");
    const previousFocus = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const state = {
      index: 0,
      playing: false,
      timer: 0,
      wpm: settings.wpm,
      fontScale: settings.fontScale
    };

    overlay.dataset.theme = settings.theme;
    $(".title").textContent = title || document.title || "Lectura rápida";
    progress.max = String(Math.max(0, tokens.length - 1));

    const persist = () => onSettingsChange?.({ wpm: state.wpm, fontScale: state.fontScale });

    const fit = () => {
      word.style.setProperty("--fit", "1");
      const half = stage.clientWidth / 2 - 12;
      const pivotHalf = pivot.offsetWidth / 2;
      const widest = Math.max(before.scrollWidth + pivotHalf, after.scrollWidth + pivotHalf, 1);
      word.style.setProperty("--fit", String(Math.min(1, half / widest)));
    };

    const renderContext = () => {
      if (state.playing || tokens.length === 0) {
        context.hidden = true;
        return;
      }
      const start = core.sentenceStart(tokens, state.index);
      let end = state.index;
      while (end < tokens.length - 1 && !/[.!?…]["'”’)\]]*$/u.test(tokens[end].text) && !tokens[end + 1].paragraphStart) {
        end += 1;
      }
      end = Math.min(end, start + 60);
      context.replaceChildren();
      for (let cursor = start; cursor <= end; cursor += 1) {
        const node = cursor === state.index ? document.createElement("mark") : document.createElement("span");
        node.textContent = tokens[cursor].text;
        context.append(node, document.createTextNode(" "));
      }
      context.hidden = false;
    };

    const render = () => {
      overlay.style.setProperty("--size", `${Math.round(64 * (state.fontScale / 100))}px`);
      $(".wpm").textContent = `${state.wpm} ppm`;
      $(".size").textContent = `${state.fontScale}%`;
      if (tokens.length === 0) {
        word.hidden = true;
        stage.querySelectorAll(".reticle").forEach((reticle) => (reticle.hidden = true));
        if (!stage.querySelector(".empty")) {
          const empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = "No he encontrado texto para leer. Selecciona un fragmento y vuelve a abrir la lectura rápida.";
          stage.append(empty);
        }
        playButton.disabled = true;
        meta.textContent = "0 palabras";
        return;
      }
      const parts = core.splitAtPivot(tokens[state.index].text);
      before.textContent = parts.before;
      pivot.textContent = parts.pivot;
      after.textContent = parts.after;
      playButton.textContent = state.playing ? "Pausa" : state.index >= tokens.length - 1 ? "Repetir" : "Leer";
      progress.value = String(state.index);
      const left = core.formatDuration(core.remainingTime(tokens, state.index, state.wpm));
      meta.textContent = `${(state.index + 1).toLocaleString()} / ${tokens.length.toLocaleString()} · ${left}`;
      $("[data-action='slower']").disabled = state.wpm <= core.LIMITS.wpm[0];
      $("[data-action='faster']").disabled = state.wpm >= core.LIMITS.wpm[1];
      $("[data-action='smaller']").disabled = state.fontScale <= core.LIMITS.fontScale[0];
      $("[data-action='bigger']").disabled = state.fontScale >= core.LIMITS.fontScale[1];
      renderContext();
      fit();
    };

    const stop = () => {
      clearTimeout(state.timer);
      state.playing = false;
    };

    const tick = () => {
      if (!state.playing) return;
      state.timer = setTimeout(() => {
        if (state.index >= tokens.length - 1) {
          stop();
          render();
          return;
        }
        state.index += 1;
        render();
        tick();
      }, core.tokenDelay(tokens[state.index], state.wpm));
    };

    const play = () => {
      if (tokens.length === 0) return;
      if (state.index >= tokens.length - 1) state.index = 0;
      state.playing = true;
      render();
      tick();
    };

    const toggle = () => (state.playing ? (stop(), render()) : play());

    const seek = (index) => {
      const wasPlaying = state.playing;
      stop();
      state.index = core.clamp(index, 0, Math.max(0, tokens.length - 1));
      render();
      if (wasPlaying) play();
    };

    const sentenceJump = (direction) => {
      if (direction < 0) {
        const start = core.sentenceStart(tokens, state.index);
        seek(start < state.index ? start : core.sentenceStart(tokens, state.index - 1));
        return;
      }
      let cursor = state.index;
      while (cursor < tokens.length - 1 && !/[.!?…]["'”’)\]]*$/u.test(tokens[cursor].text)) cursor += 1;
      seek(cursor + 1);
    };

    const setWpm = (next) => {
      state.wpm = core.clamp(next, core.LIMITS.wpm[0], core.LIMITS.wpm[1]);
      persist();
      render();
    };

    const setScale = (next) => {
      state.fontScale = core.clamp(next, core.LIMITS.fontScale[0], core.LIMITS.fontScale[1]);
      persist();
      render();
    };

    const actions = {
      close,
      play: toggle,
      restart: () => seek(0),
      back: () => sentenceJump(-1),
      forward: () => sentenceJump(1),
      slower: () => setWpm(state.wpm - 20),
      faster: () => setWpm(state.wpm + 20),
      smaller: () => setScale(state.fontScale - 10),
      bigger: () => setScale(state.fontScale + 10)
    };

    shadow.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-action]");
      if (button && !button.disabled) actions[button.dataset.action]?.();
    });
    progress.addEventListener("input", () => seek(Number(progress.value)));

    const onKey = (event) => {
      const handled = {
        Escape: close,
        " ": toggle,
        k: toggle,
        ArrowLeft: () => (event.shiftKey ? sentenceJump(-1) : seek(state.index - 1)),
        ArrowRight: () => (event.shiftKey ? sentenceJump(1) : seek(state.index + 1)),
        ArrowUp: () => setWpm(state.wpm + 20),
        ArrowDown: () => setWpm(state.wpm - 20),
        "[": () => setScale(state.fontScale - 10),
        "]": () => setScale(state.fontScale + 10),
        Home: () => seek(0),
        End: () => seek(tokens.length - 1)
      }[event.key];
      // Let Tab and Enter operate the focused control normally.
      if (!handled || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " " && shadow.activeElement?.tagName === "BUTTON" && shadow.activeElement !== playButton) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handled();
    };
    // Capture phase so page shortcuts (YouTube, Gmail…) never see our keys.
    window.addEventListener("keydown", onKey, true);
    const onResize = () => fit();
    window.addEventListener("resize", onResize);

    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(shadow.querySelectorAll("button:not(:disabled), input"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = shadow.activeElement;
      if (event.shiftKey && (current === first || !current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    shadow.addEventListener("keydown", trapFocus);

    active = {
      host,
      state,
      teardown() {
        stop();
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", onResize);
        document.documentElement.style.overflow = previousOverflow;
        host.remove();
        if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
      }
    };

    render();
    playButton.focus({ preventScroll: true });
    document.fonts?.ready.then(() => active?.host === host && fit());
    if (autoStart) play();
    return active;
  };

  function close() {
    if (!active) return;
    const current = active;
    active = null;
    current.teardown();
  }

  root.MdReaderQuickRead = {
    open,
    close,
    isOpen: () => Boolean(active),
    extractPageText,
    findMainRoot,
    blockText
  };
})(globalThis);
