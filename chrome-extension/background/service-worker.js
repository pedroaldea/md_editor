// Context menus, keyboard commands and on-demand injection for tabs that were
// already open before the extension was installed or updated.
const CONTENT_FILES = ["content/core.js", "content/bionic.js", "content/quickread.js", "content/reader.js", "content/main.js"];

const MENU = {
  quickSelection: "mdr-quick-selection",
  quickPage: "mdr-quick-page",
  bionic: "mdr-bionic",
  reader: "mdr-reader"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.quickSelection, title: "Lectura rápida de la selección", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.quickPage, title: "Lectura rápida de esta página", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.reader, title: "Modo lectura (sin anuncios)", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.bionic, title: "Alternar lectura biónica", contexts: ["page", "selection"] });
  });
});

const isScriptable = (url = "") => /^(https?|file):/u.test(url);

/** Sends a message to the tab, injecting the content scripts first if needed. */
async function sendToTab(tab, message) {
  if (!tab?.id || !isScriptable(tab.url)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU.quickSelection) {
    sendToTab(tab, { type: "mdr:quick-read", text: info.selectionText || "" }).catch(() => {});
  } else if (info.menuItemId === MENU.quickPage) {
    sendToTab(tab, { type: "mdr:quick-read", text: "" }).catch(() => {});
  } else if (info.menuItemId === MENU.reader) {
    sendToTab(tab, { type: "mdr:reader" }).catch(() => {});
  } else if (info.menuItemId === MENU.bionic) {
    sendToTab(tab, { type: "mdr:toggle-bionic" }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const type = { "toggle-bionic": "mdr:toggle-bionic", "quick-read": "mdr:quick-read", reader: "mdr:reader" }[command];
  if (type) sendToTab(target, { type }).catch(() => {});
});

// The popup reuses the same injection path.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "mdr:forward") return false;
  chrome.tabs
    .get(message.tabId)
    .then((tab) => sendToTab(tab, message.payload))
    .then((response) => sendResponse({ ok: true, response }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
