// Content entry point: settings, messages from the popup/background, auto-bionic.
(function (root) {
  "use strict";

  if (root.MdReaderMain) return;
  const core = root.MdReaderCore;
  const bionic = root.MdReaderBionic;
  const quickRead = root.MdReaderQuickRead;
  const markdown = root.MdReaderMarkdown;

  let settings = core.DEFAULTS;
  const siteKey = () => (root.location.protocol === "file:" ? "file://" : root.location.hostname);

  const saveSettings = (patch) => {
    settings = core.normalizeSettings({ ...settings, ...patch });
    chrome.storage.sync.set({ settings }).catch(() => {});
  };

  const setBionic = (value) => {
    if (value) bionic.enable();
    else bionic.disable();
    root.dispatchEvent(new CustomEvent("mdr:bionic-changed", { detail: bionic.isEnabled() }));
    return bionic.isEnabled();
  };

  const openQuickRead = (text) => {
    const extracted = text ? { source: "selection", text } : quickRead.extractPageText();
    quickRead.open({
      text: extracted.text,
      title: extracted.source === "selection" ? "Selección" : document.title,
      settings,
      onSettingsChange: saveSettings
    });
  };

  const handlers = {
    "mdr:status": () => ({
      bionic: bionic.isEnabled(),
      quickRead: quickRead.isOpen(),
      markdown: root.MdReaderMarkdownMounted === true,
      site: siteKey(),
      autoBionic: settings.autoBionicSites.includes(siteKey())
    }),
    "mdr:toggle-bionic": () => ({ bionic: setBionic(!bionic.isEnabled()) }),
    "mdr:set-bionic": (message) => ({ bionic: setBionic(Boolean(message.value)) }),
    "mdr:quick-read": (message) => {
      if (quickRead.isOpen()) quickRead.close();
      else openQuickRead(typeof message.text === "string" ? message.text.trim() : "");
      return { quickRead: quickRead.isOpen() };
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = message && handlers[message.type];
    if (!handler) return false;
    sendResponse(handler(message));
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.settings) return;
    settings = core.normalizeSettings(changes.settings.newValue);
    bionic.setSettings(settings);
    if (markdown && root.MdReaderMarkdownMounted) document.documentElement.dataset.theme = settings.theme;
  });

  const start = async () => {
    try {
      const stored = await chrome.storage.sync.get("settings");
      settings = core.normalizeSettings(stored.settings);
    } catch {
      settings = core.normalizeSettings(null);
    }
    bionic.setSettings(settings);

    if (markdown) {
      root.MdReaderMarkdownMounted = markdown.mount({
        settings,
        isBionic: () => bionic.isEnabled(),
        onBionic: () => setBionic(!bionic.isEnabled()),
        onQuickRead: () => openQuickRead("")
      });
    }
    if (settings.autoBionicSites.includes(siteKey())) setBionic(true);
  };

  root.MdReaderMain = { start };
  start();
})(globalThis);
