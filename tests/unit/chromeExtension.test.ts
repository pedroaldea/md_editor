import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as marked from "marked";
import DOMPurify from "dompurify";

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

beforeAll(async () => {
  g.marked = marked;
  g.DOMPurify = DOMPurify;
  await import("../../chrome-extension/content/core.js");
  await import("../../chrome-extension/content/bionic.js");
  await import("../../chrome-extension/content/quickread.js");
  await import("../../chrome-extension/content/markdown-view.js");
});

const flushIdle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe("extension core", () => {
  it("repairs malformed settings into bounded defaults", () => {
    const core = g.MdReaderCore;
    expect(core.normalizeSettings(null)).toEqual(core.DEFAULTS);
    const repaired = core.normalizeSettings({
      wpm: 99999,
      fontScale: "abc",
      theme: "neon",
      bionicFixation: 0.01,
      bionicWeight: 640,
      autoBionicSites: ["a.com", "a.com", 3, ""]
    });
    expect(repaired.wpm).toBe(1200);
    expect(repaired.fontScale).toBe(core.DEFAULTS.fontScale);
    expect(repaired.theme).toBe("auto");
    expect(repaired.bionicFixation).toBe(0.2);
    expect(repaired.bionicWeight).toBe(600);
    expect(repaired.autoBionicSites).toEqual(["a.com"]);
  });

  it("splits bionic words by grapheme in every script and keeps the text intact", () => {
    const core = g.MdReaderCore;
    const text = "Łódź, piękna — Привет мир! a 42";
    const parts = core.bionicParts(text, 0.5, 3);
    expect(parts.map((part: any) => part.text).join("")).toBe(text);
    const words = parts.filter((part: any) => part.focus);
    expect(words.map((part: any) => [part.focus, part.rest])).toEqual([
      ["Łó", "dź"],
      ["pię", "kna"],
      ["При", "вет"],
      ["ми", "р"]
    ]);
  });

  it("keeps punctuation on RSVP tokens and paces sentences, clauses and paragraphs", () => {
    const core = g.MdReaderCore;
    const tokens = core.tokenize("Hola, mundo. Adiós\n\nNuevo párrafo • fin");
    expect(tokens.map((token: any) => token.text)).toEqual([
      "Hola,",
      "mundo.",
      "Adiós",
      "Nuevo",
      "párrafo",
      "fin"
    ]);
    expect(tokens[3].paragraphStart).toBe(true);
    const base = 60000 / 300;
    expect(core.tokenDelay(tokens[2], 300)).toBe(base);
    expect(core.tokenDelay(tokens[0], 300)).toBe(Math.round(base * 1.5));
    expect(core.tokenDelay(tokens[1], 300)).toBe(Math.round(base * 2.2));
    expect(core.tokenDelay(tokens[3], 300)).toBe(Math.round(base * 1.8));
    expect(core.sentenceStart(tokens, 2)).toBe(2);
    expect(core.sentenceStart(tokens, 1)).toBe(0);
  });

  it("anchors the optimal recognition point after leading punctuation", () => {
    const core = g.MdReaderCore;
    expect(core.splitAtPivot("a")).toEqual({ before: "", pivot: "a", after: "" });
    expect(core.splitAtPivot("lectura")).toEqual({ before: "le", pivot: "c", after: "tura" });
    expect(core.splitAtPivot("«Hola»")).toEqual({ before: "«H", pivot: "o", after: "la»" });
    expect(core.formatDuration(61_000)).toBe("1:01");
  });
});

describe("page bionic", () => {
  beforeEach(() => {
    g.MdReaderBionic.disable();
    g.MdReaderBionic.setSettings(g.MdReaderCore.DEFAULTS);
  });

  it("wraps readable text, skips code and form fields, and reverts exactly", async () => {
    document.body.innerHTML =
      '<p id="p">Lectura <em>rápida</em> siempre</p><pre>const valor = 1;</pre><textarea>texto libre</textarea><div contenteditable="true">editable texto</div>';
    const before = document.body.innerHTML;

    g.MdReaderBionic.enable();
    await flushIdle();
    expect(document.querySelectorAll("#p mdr-w")).toHaveLength(3);
    expect(document.querySelector("#p mdr-f")?.textContent).toBe("Lec");
    expect(document.querySelector("pre mdr-w, textarea mdr-w, [contenteditable] mdr-w")).toBeNull();
    expect(document.getElementById("p")?.textContent).toBe("Lectura rápida siempre");

    g.MdReaderBionic.disable();
    expect(document.querySelector("mdr-w")).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  it("follows content added after activation", async () => {
    document.body.innerHTML = "<p>Primero</p>";
    g.MdReaderBionic.enable();
    await flushIdle();
    const added = document.createElement("p");
    added.textContent = "Contenido dinámico";
    document.body.append(added);
    await flushIdle();
    expect(added.querySelectorAll("mdr-w")).toHaveLength(2);
  });
});

describe("quick read extraction", () => {
  it("reads the main article and ignores navigation and asides", () => {
    document.body.innerHTML = `
      <nav><p>Inicio Productos Contacto menú enlaces de navegación de la cabecera</p></nav>
      <article>
        <h1>Título</h1>
        <table class="ambox"><tr><td><ul><li>Necesita ser wikificado conforme a las convenciones de estilo.</li></ul></td></tr></table>
        <p>Este es el primer párrafo del artículo<sup class="reference">[1]</sup> con suficiente texto para contar.</p>
        <ul><li><p>Elemento de lista con un párrafo interno bastante largo.</p></li></ul>
        <pre><code>const ignorado = "código no se lee";</code></pre>
      </article>
      <aside><p>Publicidad lateral que no se debería leer en ningún caso.</p></aside>`;
    const { source, text } = g.MdReaderQuickRead.extractPageText(document);
    expect(source).toBe("page");
    expect(text).toBe(
      "Título\n\nEste es el primer párrafo del artículo con suficiente texto para contar.\n\nElemento de lista con un párrafo interno bastante largo."
    );
  });

  it("prefers the user's selection", () => {
    document.body.innerHTML = "<p id='s'>Solo esta frase seleccionada.</p><p>Otra cosa.</p>";
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("s")!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(g.MdReaderQuickRead.extractPageText(document)).toEqual({
      source: "selection",
      text: "Solo esta frase seleccionada."
    });
    document.getSelection()!.removeAllRanges();
  });

  it("opens, plays, persists speed and closes the overlay with the keyboard", () => {
    vi.useFakeTimers();
    const onSettingsChange = vi.fn();
    g.MdReaderQuickRead.open({
      text: "Uno dos tres.",
      title: "Prueba",
      settings: g.MdReaderCore.DEFAULTS,
      onSettingsChange
    });
    const shadow = document.getElementById("mdr-quickread-host")!.shadowRoot!;
    const word = () => shadow.querySelector(".word")!.textContent;
    expect(word()).toBe("Uno");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    vi.advanceTimersByTime(60000 / 360 + 5);
    expect(word()).toBe("dos");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(onSettingsChange).toHaveBeenLastCalledWith({ wpm: 380, fontScale: 100 });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("mdr-quickread-host")).toBeNull();
    expect(g.MdReaderQuickRead.isOpen()).toBe(false);
    vi.useRealTimers();
  });
});

describe("markdown viewer", () => {
  it("renders sanitized Markdown with marks outside code only", () => {
    const html = g.MdReaderMarkdown.render(
      "# Hola\n\nTexto ==clave== y ++subrayado++ `a == b == c`\n\n<img src=x onerror=alert(1)><script>alert(1)</script>"
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    g.MdReaderMarkdown.applyInlineMarks(container);
    expect(container.querySelector("h1")?.textContent).toBe("Hola");
    expect(container.querySelector("mark")?.textContent).toBe("clave");
    expect(container.querySelector("u")?.textContent).toBe("subrayado");
    expect(container.querySelector("code")?.textContent).toBe("a == b == c");
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.querySelector("script")).toBeNull();
  });
});
