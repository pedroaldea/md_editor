import { invoke } from "@tauri-apps/api/core";
import { renderMermaidDiagrams } from "./mermaidRenderer";
import { rewritePreviewImageSources } from "./previewAssets";

export const PDF_EXPORT_CLASS = "pdf-exporting";
export const PDF_EXPORT_SURFACE_CLASS = "pdf-export-surface";

const PRINT_RESOURCE_TIMEOUT_MS = 8_000;
const PRINT_DIALOG_TIMEOUT_MS = 10 * 60 * 1_000;
let pdfExportSequence = 0;
const activePdfExportCleanup = new WeakMap<Document, () => void>();

interface PdfExportSourceOptions {
  html?: string;
  resolveImageSource?: (source: string) => string;
  loadImageFallback?: (source: string) => Promise<string | null>;
}

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const waitForPrintLayout = async (ownerWindow: Window | null = window): Promise<void> => {
  if (!ownerWindow || typeof ownerWindow.requestAnimationFrame !== "function") {
    return;
  }

  await new Promise<void>((resolve) => {
    ownerWindow.requestAnimationFrame(() => {
      ownerWindow.requestAnimationFrame(() => resolve());
    });
  });
};

const delay = (ownerWindow: Window | null, milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    if (!ownerWindow) {
      resolve();
      return;
    }
    ownerWindow.setTimeout(resolve, milliseconds);
  });

const waitForPreviewFallbacks = async (source: HTMLElement): Promise<void> => {
  const ownerWindow = source.ownerDocument.defaultView;
  const deadline = Date.now() + PRINT_RESOURCE_TIMEOUT_MS;

  // PreviewPane may be replacing a blocked local asset with its native data-URL
  // fallback. Give that asynchronous bridge a bounded chance to finish before
  // freezing the printable clone.
  while (Date.now() < deadline) {
    const images = [...source.querySelectorAll<HTMLImageElement>("img")];
    const hasPendingImage = images.some(
      (image) => !image.complete || image.dataset.previewFallback === "loading"
    );
    if (!hasPendingImage) return;
    await delay(ownerWindow, 50);
  }
};

const waitForImage = (image: HTMLImageElement): Promise<boolean> => {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0);

  return new Promise((resolve) => {
    const ownerWindow = image.ownerDocument.defaultView;
    let settled = false;
    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      if (timeoutId !== undefined) ownerWindow?.clearTimeout(timeoutId);
      resolve(loaded);
    };
    const onLoad = (): void => finish(image.naturalWidth > 0);
    const onError = (): void => finish(false);
    const timeoutId = ownerWindow?.setTimeout(() => finish(false), PRINT_RESOURCE_TIMEOUT_MS);

    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
  });
};

const rewriteFragmentIds = (surface: HTMLElement): void => {
  pdfExportSequence += 1;
  const prefix = `pdf-export-${pdfExportSequence}-`;
  const idMap = new Map<string, string>();
  const idCounts = new Map<string, number>();
  const usedIds = new Set<string>();

  surface.querySelectorAll<HTMLElement>("[id]").forEach((element) => {
    const currentId = element.id;
    if (!currentId) return;
    const occurrence = (idCounts.get(currentId) ?? 0) + 1;
    idCounts.set(currentId, occurrence);
    let suffix = occurrence;
    let nextId = `${prefix}${currentId}${suffix > 1 ? `-${suffix}` : ""}`;
    while (usedIds.has(nextId)) {
      suffix += 1;
      nextId = `${prefix}${currentId}-${suffix}`;
    }
    usedIds.add(nextId);
    if (!idMap.has(currentId)) idMap.set(currentId, nextId);
    element.id = nextId;
  });

  const rewriteFragment = (value: string): string => {
    if (!value.startsWith("#")) return value;
    const nextTarget = idMap.get(value.slice(1));
    return nextTarget ? `#${nextTarget}` : value;
  };
  const rewriteIdTokens = (value: string): string =>
    value
      .split(/\s+/u)
      .map((token) => idMap.get(token) ?? token)
      .join(" ");
  const rewriteUrlFragments = (value: string): string =>
    value.replace(/url\(#([^)]+)\)/gu, (match, id: string) => {
      const nextTarget = idMap.get(id);
      return nextTarget ? `url(#${nextTarget})` : match;
    });

  surface.querySelectorAll<HTMLElement>("*").forEach((element) => {
    ["href", "xlink:href"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, rewriteFragment(value));
    });
    ["for", "aria-labelledby", "aria-describedby", "headers"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, rewriteIdTokens(value));
    });
    [
      "style",
      "fill",
      "stroke",
      "clip-path",
      "mask",
      "filter",
      "marker-start",
      "marker-mid",
      "marker-end"
    ].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, rewriteUrlFragments(value));
    });
  });
};

export const removePdfExportSurface = (ownerDocument: Document = document): void => {
  ownerDocument
    .querySelectorAll<HTMLElement>(`.${PDF_EXPORT_SURFACE_CLASS}`)
    .forEach((surface) => surface.remove());
};

export const preparePdfExportSurface = async (
  ownerDocument: Document = document,
  options: PdfExportSourceOptions = {}
): Promise<HTMLElement | null> => {
  removePdfExportSurface(ownerDocument);

  // When canonical HTML is supplied, prefer it over the live reading pane. It
  // represents the latest editor value and excludes display-only transforms
  // such as Bionic Reading, regardless of Edit/Split/Read/Focus mode.
  const liveSource =
    options.html === undefined
      ? ownerDocument.querySelector<HTMLElement>(".preview-content")
      : null;
  if (!liveSource && options.html === undefined) return null;
  if (!ownerDocument.body) return null;

  await waitForPrintLayout(ownerDocument.defaultView);
  if (liveSource) await waitForPreviewFallbacks(liveSource);

  const surface = liveSource
    ? (liveSource.cloneNode(true) as HTMLElement)
    : ownerDocument.createElement("div");
  if (!liveSource) {
    surface.className = "preview-content";
    surface.innerHTML = rewritePreviewImageSources(options.html ?? "", options.resolveImageSource);
  }
  surface.classList.add(PDF_EXPORT_SURFACE_CLASS);
  surface.setAttribute("role", "document");
  surface.setAttribute("aria-label", "PDF export document");
  surface.querySelectorAll<HTMLElement>("[contenteditable], [tabindex]").forEach((element) => {
    element.removeAttribute("contenteditable");
    element.removeAttribute("tabindex");
  });
  rewriteFragmentIds(surface);
  ownerDocument.body.append(surface);

  // The reading pane renders Mermaid lazily for speed. PDF export is the one
  // moment where every diagram, including off-screen diagrams, must be ready.
  await renderMermaidDiagrams(surface, "light");

  const fontSet = ownerDocument.fonts;
  if (fontSet?.ready) {
    await Promise.race([
      fontSet.ready.then(() => undefined),
      delay(ownerDocument.defaultView, PRINT_RESOURCE_TIMEOUT_MS)
    ]);
  }

  const images = [...surface.querySelectorAll<HTMLImageElement>("img")];
  images.forEach((image) => {
    // Markdown previews deliberately use lazy loading for normal reading. The
    // printable clone is off-screen, so lazy images far below the viewport may
    // never start loading unless export explicitly promotes them.
    image.loading = "eager";
    image.decoding = "sync";
  });
  const imageStates = await Promise.all(
    images.map(async (image) => {
      if (await waitForImage(image)) return true;
      const originalSource = image.dataset.previewSource;
      if (!originalSource || !options.loadImageFallback) return false;
      const fallbackSource = await options.loadImageFallback(originalSource);
      if (!fallbackSource || !image.isConnected) return false;
      image.src = fallbackSource;
      image.dataset.previewFallback = "loaded";
      return waitForImage(image);
    })
  );
  imageStates.forEach((loaded, index) => {
    if (loaded) return;
    const image = images[index];
    if (!image?.isConnected) return;
    const fallback = ownerDocument.createElement("span");
    fallback.className = "pdf-export-image-error";
    const label = image.alt.trim();
    fallback.textContent = label ? `Image unavailable: ${label}` : "Image unavailable";
    image.replaceWith(fallback);
  });

  surface.dataset.pdfExportReady = "true";
  await waitForPrintLayout(ownerDocument.defaultView);
  return surface;
};

export const escapeHtmlText = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

export const buildHtmlExportDocument = (title: string, bodyHtml: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlText(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 2rem;
      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      line-height: 1.7;
      font-size: 16px;
      background: #0f1115;
      color: #e5ecf3;
    }
    main { max-width: 96ch; margin: 0 auto; }
    code, pre { font-family: "JetBrains Mono", "SF Mono", monospace; }
    pre {
      background: #111723;
      border-radius: 10px;
      padding: 12px;
      overflow: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #2f3948;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    a { color: #66d9ff; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
  </style>
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`;

export const runPdfPrint = async (
  print: () => void | Promise<unknown> = () => window.print(),
  root: HTMLElement = document.documentElement,
  options: PdfExportSourceOptions & { title?: string; requireSurface?: boolean } = {}
): Promise<boolean> => {
  const ownerDocument = root.ownerDocument;
  activePdfExportCleanup.get(ownerDocument)?.();
  const originalTitle = ownerDocument.title;
  let surface: HTMLElement | null = null;
  let cleanupDeferred = false;
  let cancelDeferredCleanup = (): void => undefined;
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    cancelDeferredCleanup();
    surface?.remove();
    ownerDocument.title = originalTitle;
    root.classList.remove(PDF_EXPORT_CLASS);
    if (activePdfExportCleanup.get(ownerDocument) === cleanup) {
      activePdfExportCleanup.delete(ownerDocument);
    }
  };

  root.classList.add(PDF_EXPORT_CLASS);
  try {
    surface = await preparePdfExportSurface(ownerDocument, options);
    if (options.requireSurface && !surface) {
      throw new Error("Printable preview is unavailable");
    }
    if (options.title?.trim()) ownerDocument.title = options.title.trim();
    activePdfExportCleanup.set(ownerDocument, cleanup);

    // Force a style/layout pass so the print snapshot sees the export-only layout.
    root.getBoundingClientRect();
    await waitForPrintLayout(ownerDocument.defaultView);

    if (isTauriRuntime()) {
      // The Tauri print command resolves when the macOS print sheet opens, not
      // when Save as PDF/Cancel has finished. Keep the prepared surface alive
      // until WebKit signals that printing ended; otherwise the final saved PDF
      // can re-snapshot the restored application chrome.
      if (surface && ownerDocument.defaultView) {
        const ownerWindow = ownerDocument.defaultView;
        const finishAfterPrint = (): void => cleanup();
        ownerWindow.addEventListener("afterprint", finishAfterPrint, { once: true });
        const cleanupTimeout = ownerWindow.setTimeout(cleanup, PRINT_DIALOG_TIMEOUT_MS);
        cancelDeferredCleanup = () => {
          ownerWindow.removeEventListener("afterprint", finishAfterPrint);
          ownerWindow.clearTimeout(cleanupTimeout);
        };
        cleanupDeferred = true;
      }
      await invoke("plugin:webview|print");
      return true;
    }

    await Promise.resolve(print());
    return true;
  } catch {
    cleanupDeferred = false;
    return false;
  } finally {
    if (!cleanupDeferred) cleanup();
  }
};
