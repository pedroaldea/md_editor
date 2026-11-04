// Reversible bionic reading for any page. Words become <mdr-w><mdr-f>foc</mdr-f>us</mdr-w>;
// custom tags keep page CSS from restyling them and make the undo exact.
(function (root) {
  "use strict";

  if (root.MdReaderBionic) return;
  const core = root.MdReaderCore;

  const SKIP =
    "script, style, noscript, template, textarea, input, select, option, button, code, pre, kbd, samp, var, svg, math, canvas, video, audio, iframe, object, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], [aria-hidden='true'], mdr-w, #mdr-quickread-host, .mdr-skip";
  const STYLE_ID = "mdr-bionic-style";
  const CHUNK = 400;

  let enabled = false;
  let settings = core.DEFAULTS;
  let observer = null;
  let pending = new Set();
  let scheduled = false;

  const schedule = (callback) =>
    typeof root.requestIdleCallback === "function"
      ? root.requestIdleCallback(callback, { timeout: 200 })
      : setTimeout(() => callback({ timeRemaining: () => 8 }), 16);

  const applyStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).append(style);
    }
    style.textContent = `
      mdr-w { display: inline; font: inherit; color: inherit; letter-spacing: inherit; }
      mdr-f { display: inline; font-weight: ${settings.bionicWeight} !important; color: inherit; }
      ${settings.bionicDimRest ? "mdr-w > mdr-r { opacity: .78; }" : ""}
      mdr-r { display: inline; }
    `;
  };

  const skippable = (textNode) => {
    const parent = textNode.parentElement;
    if (!parent) return true;
    if (parent.closest(SKIP)) return true;
    return parent.isContentEditable;
  };

  const transform = (textNode) => {
    if (!textNode.isConnected || skippable(textNode)) return;
    const text = textNode.nodeValue;
    if (!text || !text.trim()) return;
    const parts = core.bionicParts(text, settings.bionicFixation, settings.bionicMinWord);
    if (!parts.some((part) => part.focus)) return;

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part.focus) {
        fragment.append(document.createTextNode(part.text));
        continue;
      }
      const word = document.createElement("mdr-w");
      const focus = document.createElement("mdr-f");
      focus.textContent = part.focus;
      word.append(focus);
      if (part.rest) {
        const rest = document.createElement("mdr-r");
        rest.textContent = part.rest;
        word.append(rest);
      }
      fragment.append(word);
    }
    textNode.replaceWith(fragment);
  };

  const collect = (rootNode) => {
    if (rootNode.nodeType === Node.TEXT_NODE) {
      pending.add(rootNode);
      return;
    }
    if (rootNode.nodeType !== Node.ELEMENT_NODE && rootNode.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (rootNode.nodeType === Node.ELEMENT_NODE && rootNode.closest(SKIP)) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) pending.add(node);
  };

  const flush = (deadline) => {
    scheduled = false;
    if (!enabled) {
      pending.clear();
      return;
    }
    // Our own DOM writes must not feed back into the observer.
    observer?.disconnect();
    const iterator = pending.values();
    let processed = 0;
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      pending.delete(next.value);
      transform(next.value);
      processed += 1;
      if (processed % CHUNK === 0 && deadline.timeRemaining() < 2) break;
    }
    observe();
    if (pending.size > 0) queue();
  };

  const queue = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(flush);
  };

  const observe = () => {
    if (!enabled || !document.body) return;
    if (!observer) {
      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") {
            if (record.target.parentElement?.closest("mdr-w")) continue;
            pending.add(record.target);
          } else {
            record.addedNodes.forEach(collect);
          }
        }
        if (pending.size > 0) queue();
      });
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  const revert = () => {
    const words = document.querySelectorAll("mdr-w");
    const parents = new Set();
    words.forEach((word) => {
      parents.add(word.parentNode);
      word.replaceWith(document.createTextNode(word.textContent));
    });
    parents.forEach((parent) => parent?.normalize());
  };

  const enable = () => {
    if (enabled || !document.body) return;
    enabled = true;
    applyStyle();
    collect(document.body);
    queue();
    observe();
  };

  const disable = () => {
    if (!enabled) return;
    enabled = false;
    observer?.disconnect();
    pending.clear();
    revert();
    document.getElementById(STYLE_ID)?.remove();
  };

  root.MdReaderBionic = {
    isEnabled: () => enabled,
    enable,
    disable,
    toggle() {
      if (enabled) disable();
      else enable();
      return enabled;
    },
    setSettings(next) {
      const changedSplit =
        next.bionicFixation !== settings.bionicFixation || next.bionicMinWord !== settings.bionicMinWord;
      settings = next;
      if (!enabled) return;
      applyStyle();
      if (changedSplit) {
        observer?.disconnect();
        revert();
        collect(document.body);
        queue();
        observe();
      }
    }
  };
})(globalThis);
