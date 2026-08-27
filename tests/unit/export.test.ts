import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import {
  buildHtmlExportDocument,
  escapeHtmlText,
  PDF_EXPORT_CLASS,
  PDF_EXPORT_SURFACE_CLASS,
  preparePdfExportSurface,
  removePdfExportSurface,
  runPdfPrint
} from "../../src/lib/export";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

const setTauriRuntime = (enabled: boolean): void => {
  const tauriWindow = window as TauriWindow;
  if (enabled) {
    tauriWindow.__TAURI_INTERNALS__ = {};
    return;
  }
  delete tauriWindow.__TAURI_INTERNALS__;
};

describe("runPdfPrint", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setTauriRuntime(false);
  });

  afterEach(() => {
    setTauriRuntime(false);
    removePdfExportSurface();
    document.body.replaceChildren();
  });

  it("uses browser print fallback outside Tauri runtime", async () => {
    const root = document.createElement("div");
    const print = vi.fn(() => {
      expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(true);
    });

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("calls Tauri print command when runtime is Tauri", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue(undefined);

    const root = document.createElement("div");
    const print = vi.fn();

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("plugin:webview|print");
    expect(print).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("keeps the native print surface alive until WebKit finishes printing", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue(undefined);
    document.title = "Md Editor";
    document.body.innerHTML = '<div id="root"><div class="preview-content"><p>Native PDF</p></div></div>';

    const opened = await runPdfPrint(vi.fn(), document.documentElement, {
      title: "native-proof",
      requireSurface: true
    });

    expect(opened).toBe(true);
    expect(document.documentElement.classList.contains(PDF_EXPORT_CLASS)).toBe(true);
    expect(document.querySelector(`.${PDF_EXPORT_SURFACE_CLASS}`)?.textContent).toContain(
      "Native PDF"
    );
    expect(document.title).toBe("native-proof");

    window.dispatchEvent(new Event("afterprint"));

    expect(document.documentElement.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
    expect(document.querySelector(`.${PDF_EXPORT_SURFACE_CLASS}`)).toBeNull();
    expect(document.title).toBe("Md Editor");
  });

  it("returns false when Tauri print command fails", async () => {
    setTauriRuntime(true);
    invokeMock.mockRejectedValue(new Error("denied"));

    const root = document.createElement("div");
    const print = vi.fn();

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("plugin:webview|print");
    expect(print).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("cleans export class when browser print fallback throws", async () => {
    setTauriRuntime(false);
    const print = vi.fn(() => {
      throw new Error("print unsupported");
    });
    const root = document.createElement("div");

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(false);
    expect(print).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("prints from a document-only surface and restores the page afterwards", async () => {
    document.title = "Md Editor";
    document.body.innerHTML = `
      <div id="root">
        <nav>LIBRARY OUTLINE COMMAND</nav>
        <main><div class="preview-content"><h1 id="proof">Clean article</h1><a href="#proof">Jump</a></div></main>
        <footer>INSERT md utf-8</footer>
      </div>
    `;

    const print = vi.fn(() => {
      const surface = document.querySelector<HTMLElement>(`.${PDF_EXPORT_SURFACE_CLASS}`);
      expect(document.documentElement.classList.contains(PDF_EXPORT_CLASS)).toBe(true);
      expect(document.title).toBe("clean-export");
      expect(surface?.dataset.pdfExportReady).toBe("true");
      expect(surface?.textContent).toContain("Clean article");
      expect(surface?.textContent).not.toContain("LIBRARY");
      expect(surface?.textContent).not.toContain("INSERT");
      expect(surface?.querySelector("h1")?.id).toMatch(/^pdf-export-\d+-proof$/u);
      expect(surface?.querySelector("a")?.getAttribute("href")).toMatch(
        /^#pdf-export-\d+-proof$/u
      );
    });

    const opened = await runPdfPrint(print, document.documentElement, {
      title: "clean-export",
      requireSurface: true
    });

    expect(opened).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Md Editor");
    expect(document.querySelector(`.${PDF_EXPORT_SURFACE_CLASS}`)).toBeNull();
    expect(document.documentElement.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("makes duplicate ids unique and preserves common fragment references", async () => {
    document.body.innerHTML = `
      <div class="preview-content">
        <label for="note">Note</label>
        <p id="note">First</p>
        <p id="note">Second</p>
        <p id="note-2">Third</p>
        <a href="#note" aria-describedby="note">Jump</a>
      </div>
    `;

    const surface = await preparePdfExportSurface();
    const ids = [...(surface?.querySelectorAll<HTMLElement>("[id]") ?? [])].map(
      (element) => element.id
    );
    const firstId = ids[0];

    expect(new Set(ids).size).toBe(ids.length);
    expect(firstId).toMatch(/^pdf-export-\d+-note$/u);
    expect(surface?.querySelector("label")?.htmlFor).toBe(firstId);
    expect(surface?.querySelector("a")?.getAttribute("href")).toBe(`#${firstId}`);
    expect(surface?.querySelector("a")?.getAttribute("aria-describedby")).toBe(firstId);
  });

  it("builds a printable surface from HTML when Edit mode has no mounted preview", async () => {
    document.body.innerHTML = "<div id=\"root\"><main>Editor only</main></div>";
    const print = vi.fn(() => {
      const surface = document.querySelector<HTMLElement>(`.${PDF_EXPORT_SURFACE_CLASS}`);
      expect(surface?.textContent).toContain("Fresh editor content");
      expect(surface?.textContent).not.toContain("Editor only");
    });

    const opened = await runPdfPrint(print, document.documentElement, {
      html: "<h1>Fresh editor content</h1>",
      requireSurface: true
    });

    expect(opened).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`.${PDF_EXPORT_SURFACE_CLASS}`)).toBeNull();
  });

  it("prefers fresh canonical HTML over a stale or display-transformed live preview", async () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="preview-content"><p class="bionic-word">OLD PREVIEW</p></div>
      </div>
    `;
    const print = vi.fn(() => {
      const surface = document.querySelector<HTMLElement>(`.${PDF_EXPORT_SURFACE_CLASS}`);
      expect(surface?.textContent).toContain("FRESH DOCUMENT");
      expect(surface?.textContent).not.toContain("OLD PREVIEW");
      expect(surface?.querySelector(".bionic-word")).toBeNull();
    });

    const opened = await runPdfPrint(print, document.documentElement, {
      html: "<p>FRESH DOCUMENT</p>",
      requireSurface: true
    });

    expect(opened).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("refuses a required PDF export when no rendered preview exists", async () => {
    const print = vi.fn();

    const opened = await runPdfPrint(print, document.documentElement, {
      requireSurface: true
    });

    expect(opened).toBe(false);
    expect(print).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });
});

describe("preparePdfExportSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removePdfExportSurface();
    document.body.replaceChildren();
  });

  it("replaces stale print surfaces instead of accumulating hidden documents", async () => {
    document.body.innerHTML = '<div class="preview-content"><p>First version</p></div>';
    const firstSurface = await preparePdfExportSurface();
    expect(firstSurface?.textContent).toContain("First version");

    document.querySelector<HTMLElement>("#root .preview-content")?.replaceChildren();
    const source = document.querySelector<HTMLElement>(
      `.preview-content:not(.${PDF_EXPORT_SURFACE_CLASS})`
    );
    if (source) source.innerHTML = "<p>Second version</p>";
    const secondSurface = await preparePdfExportSurface();

    expect(secondSurface?.textContent).toContain("Second version");
    expect(document.querySelectorAll(`.${PDF_EXPORT_SURFACE_CLASS}`)).toHaveLength(1);
  });

  it("promotes off-screen lazy images before waiting for printable resources", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(640);
    document.body.innerHTML = `
      <div class="preview-content">
        <img src="proof.png" alt="Proof" loading="lazy" decoding="async" />
      </div>
    `;

    const surface = await preparePdfExportSurface();
    const image = surface?.querySelector("img");

    expect(image?.loading).toBe("eager");
    expect(image?.decoding).toBe("sync");
    expect(image?.alt).toBe("Proof");
  });
});

describe("buildHtmlExportDocument", () => {
  it("escapes unsafe title text", () => {
    const title = `A <script>alert("x")</script> & "quotes"`;
    const html = buildHtmlExportDocument(title, "<p>Body</p>");

    expect(html).toContain(`<title>${escapeHtmlText(title)}</title>`);
    expect(html).not.toContain("<title>A <script>");
  });
});
