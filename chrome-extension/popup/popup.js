// Popup: settings live in chrome.storage.sync; page actions go through the
// service worker so tabs opened before install still get the content scripts.
const core = globalThis.MdReaderCore;
const $ = (id) => document.getElementById(id);

let settings = core.DEFAULTS;
let tab = null;
let site = "";

const SAMPLE = "La lectura biónica guía la mirada resaltando el comienzo de cada palabra.";

const formatters = {
  bionicFixation: (value) => `${value}%`,
  bionicWeight: (value) => String(value),
  bionicMinWord: (value) => `${value} letra${value === 1 ? "" : "s"}`,
  wpm: (value) => `${value} ppm`,
  fontScale: (value) => `${value}%`
};

const forward = async (payload) => {
  if (!tab) return null;
  const result = await chrome.runtime.sendMessage({ type: "mdr:forward", tabId: tab.id, payload });
  return result?.ok ? result.response : null;
};

const save = (patch) => {
  settings = core.normalizeSettings({ ...settings, ...patch });
  render();
  return chrome.storage.sync.set({ settings });
};

const renderSample = () => {
  const sample = $("sample");
  sample.replaceChildren();
  for (const part of core.bionicParts(SAMPLE, settings.bionicFixation, settings.bionicMinWord)) {
    if (!part.focus) {
      sample.append(part.text);
      continue;
    }
    const focus = document.createElement("b");
    focus.textContent = part.focus;
    const rest = document.createElement("i");
    rest.textContent = part.rest;
    sample.append(focus, rest);
  }
  sample.style.setProperty("--weight", String(settings.bionicWeight));
  sample.classList.toggle("dim", settings.bionicDimRest);
};

const themeStyle = document.createElement("style");
themeStyle.textContent = core.themeCss(":root");
document.head.append(themeStyle);

const buildThemes = () => {
  const container = $("themes");
  for (const name of core.THEME_NAMES) {
    const theme = core.THEMES[name];
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "theme";
    input.value = name;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "Aa";
    chip.style.background = theme ? theme.bg : "linear-gradient(135deg, #fbfaf7 50%, #131312 50%)";
    chip.style.color = theme ? theme.fg : "#888";
    const caption = document.createElement("span");
    caption.className = "name";
    caption.textContent = theme ? theme.label : "Auto";
    label.append(input, chip, caption);
    container.append(label);
  }
};

function render() {
  document.documentElement.dataset.theme = settings.theme;
  for (const key of Object.keys(formatters)) {
    const input = $(key);
    const value = key === "bionicFixation" ? Math.round(settings[key] * 100) : settings[key];
    input.value = String(value);
    document.querySelector(`output[for="${key}"]`).textContent = formatters[key](value);
  }
  $("bionicDimRest").checked = settings.bionicDimRest;
  $("autoBionic").checked = settings.autoBionicSites.includes(site);
  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.checked = radio.value === settings.theme;
  });
  renderSample();
}

const setBionicButton = (enabled) => $("bionic").setAttribute("aria-pressed", String(Boolean(enabled)));

const wire = () => {
  for (const key of Object.keys(formatters)) {
    $(key).addEventListener("input", (event) => {
      const raw = Number(event.target.value);
      save({ [key]: key === "bionicFixation" ? raw / 100 : raw });
    });
  }
  $("bionicDimRest").addEventListener("change", (event) => save({ bionicDimRest: event.target.checked }));
  document.querySelectorAll('input[name="theme"]').forEach((radio) =>
    radio.addEventListener("change", () => save({ theme: radio.value }))
  );

  $("bionic").addEventListener("click", async () => {
    const response = await forward({ type: "mdr:toggle-bionic" });
    if (response) setBionicButton(response.bionic);
  });

  $("autoBionic").addEventListener("change", async (event) => {
    const sites = new Set(settings.autoBionicSites);
    if (event.target.checked) sites.add(site);
    else sites.delete(site);
    await save({ autoBionicSites: [...sites] });
    const response = await forward({ type: "mdr:set-bionic", value: event.target.checked });
    if (response) setBionicButton(response.bionic);
  });

  $("reader").addEventListener("click", async () => {
    await forward({ type: "mdr:reader" });
    window.close();
  });

  $("quick").addEventListener("click", async () => {
    await forward({ type: "mdr:quick-read" });
    window.close();
  });

  $("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
};

const start = async () => {
  const stored = await chrome.storage.sync.get("settings");
  settings = core.normalizeSettings(stored.settings);
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const scriptable = Boolean(tab?.url && /^(https?|file):/u.test(tab.url));
  if (scriptable) {
    const url = new URL(tab.url);
    site = url.protocol === "file:" ? "file://" : url.hostname;
    $("site").textContent = url.protocol === "file:" ? "archivo local" : site;
  }
  $("unavailable").hidden = scriptable;
  $("bionic").disabled = !scriptable;
  $("quick").disabled = !scriptable;
  $("reader").disabled = !scriptable;
  $("autoBionic").disabled = !scriptable;

  buildThemes();
  wire();
  render();

  if (scriptable) {
    const status = await forward({ type: "mdr:status" }).catch(() => null);
    if (status) setBionicButton(status.bionic);
  }
};

start();
