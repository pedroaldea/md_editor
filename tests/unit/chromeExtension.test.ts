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
  await import("../../chrome-extension/content/reader.js");
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
    const text = "Łódź, piękna — Привет мир! a 2023";
    const parts = core.bionicParts(text, 0.5, 3);
    expect(parts.map((part: any) => part.text).join("")).toBe(text);
    const words = parts.filter((part: any) => part.focus);
    expect(words.map((part: any) => [part.focus, part.rest])).toEqual([
      ["Łó", "dź"],
      ["pię", "kna"],
      ["При", "вет"],
      ["ми", "р"]
    ]);
    // "2023" stays plain: numbers are not split.
    expect(parts.at(-1)).toEqual({ text: "2023" });
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

  it("leaves site chrome and stand-alone UI links alone but keeps prose links", async () => {
    document.body.innerHTML = `
      <nav><a href="#">Productos</a></nav>
      <div class="topics"><a id="ui" href="#">markdown</a></div>
      <div role="button">Suscribirse</div>
      <p id="prose">Lee la <a href="#">documentación completa</a> ahora</p>`;
    g.MdReaderBionic.enable();
    await flushIdle();
    expect(document.querySelector("nav mdr-w, #ui mdr-w, [role='button'] mdr-w")).toBeNull();
    expect(document.querySelectorAll("#prose a mdr-w")).toHaveLength(2);
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

  it("keeps words apart at link edges and never reads code on pages without prose", () => {
    document.body.innerHTML = `
      <script>var dd = {"cid": "captcha"};</script>
      <table><tr><td><b><a href="#">Hacker News</a></b><a href="#">new</a> | <a href="#">past</a></td></tr></table>`;
    expect(g.MdReaderQuickRead.extractPageText(document).text).toBe("Hacker News new | past");
  });

  it("treats <br> as a word break", () => {
    document.body.innerHTML = "<article><p>July 2023<br><br>If you collected lists of techniques for doing great work.</p></article>";
    expect(g.MdReaderQuickRead.extractPageText(document).text).toBe(
      "July 2023 If you collected lists of techniques for doing great work."
    );
  });

  it("skips ads and promos inside the article", () => {
    document.body.innerHTML = `
      <article>
        <p>Primer párrafo real del artículo con texto suficiente para puntuar bien.</p>
        <div class="ad-slot"><p>Compra ahora este producto increíble con descuento exclusivo.</p></div>
        <div class="newsletter-box"><p>Suscríbete a nuestra newsletter para recibir novedades.</p></div>
        <p>Segundo párrafo real del artículo, también con texto suficiente.</p>
      </article>`;
    expect(g.MdReaderQuickRead.extractPageText(document).text).toBe(
      "Primer párrafo real del artículo con texto suficiente para puntuar bien.\n\nSegundo párrafo real del artículo, también con texto suficiente."
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

describe("reader mode", () => {
  it("rebuilds the article without ads, chrome, styles or unsafe links", () => {
    document.head.innerHTML = '<meta property="og:site_name" content="Diario"><meta name="author" content="Ana Pérez">';
    document.body.innerHTML = `
      <header><nav><a href="/">Portada</a></nav></header>
      <article>
        <h1>Gran titular</h1>
        <p style="color:red" class="lead" onclick="alert(1)">Entrada con <a href="javascript:alert(1)">enlace malo</a> y <a href="/bueno">enlace bueno</a>.</p>
        <div id="div-gpt-ad-1"><p>Anuncio</p></div>
        <aside class="related-articles"><p>Te puede interesar</p></aside>
        <figure><img src="/foto.jpg" alt="Foto" width="800"><figcaption>Pie de foto</figcaption></figure>
        <img src="/pixel.gif" width="1" alt="">
        <div class="share-bar"><button>Compartir</button></div>
        <p>Cuerpo del artículo con varias palabras más.</p>
      </article>`;
    const data = g.MdReaderReader.extract(document);
    expect(data.title).toBe("Gran titular");
    expect(data.site).toBe("Diario");
    expect(data.author).toBe("Ana Pérez");
    const html = data.article.innerHTML;
    expect(html).not.toMatch(/Anuncio|Te puede interesar|Compartir|Portada|pixel|style=|onclick|class=|javascript:/u);
    expect(data.article.querySelector("h1")).toBeNull();
    const links = Array.from(data.article.querySelectorAll("a")) as HTMLAnchorElement[];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([null, "http://localhost:3000/bueno"]);
    expect(links[1].rel).toBe("noopener noreferrer");
    expect(data.article.querySelector("img")?.getAttribute("src")).toBe("http://localhost:3000/foto.jpg");
    expect(data.article.querySelector("figcaption")?.textContent).toBe("Pie de foto");
    expect(data.article.textContent).toContain("Cuerpo del artículo");
  });

  it("cleans site suffixes from titles and unwraps layout tables", () => {
    document.head.innerHTML = '<title>Cómo leer más rápido | Mi Blog</title><meta property="og:site_name" content="Mi Blog">';
    document.body.innerHTML = `
      <table><tr><td><img src="/nav.gif" width="69" height="400" usemap="#nav"><img src="/logo.gif" width="400" height="40" alt="Mi Blog"></td></tr>
      <tr><td><img src="/t.gif" width="300" height="30" alt="Cómo leer más rápido">
        <br><br><br><table><tr><td>Un texto largo dentro de una tabla de maquetación que es el cuerpo del ensayo y debe leerse como prosa normal.</td></tr></table>
      </td></tr></table>
      <table><thead><tr><th>Método</th><th>ppm</th></tr></thead><tbody><tr><td>RSVP</td><td>500</td></tr></tbody></table>`;
    const data = g.MdReaderReader.extract(document);
    expect(data.title).toBe("Cómo leer más rápido");
    expect(data.article.querySelectorAll("table")).toHaveLength(1);
    expect(data.article.querySelector("th")?.textContent).toBe("Método");
    expect(data.article.querySelector("img")).toBeNull();
    expect(data.article.textContent).toContain("debe leerse como prosa normal");
    expect(data.article.firstChild?.nodeName).not.toBe("BR");
  });

  it("does not flag ordinary class names as clutter", () => {
    const element = document.createElement("div");
    for (const name of ["header", "thread-list", "download", "badge", "heading", "post-content", "SharedMarkdownContent__JRRdYK", "has-sidebar", "adventure"]) {
      element.className = name;
      expect(g.MdReaderCore.isClutter(element)).toBe(false);
    }
    for (const name of ["ad", "top-ad", "advertisement", "share-bar", "related-articles", "comments"]) {
      element.className = name;
      expect(g.MdReaderCore.isClutter(element)).toBe(true);
    }
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

  it("strips forms and styles that could imitate the hosting site", () => {
    const html = g.MdReaderMarkdown.render(
      '<form action="https://evil.example"><input name="password"><button>Entrar</button></form><style>body{display:none}</style><p style="position:fixed">x</p>'
    );
    expect(html).not.toMatch(/<form|<input|<button|<style|style=/u);
  });
});
