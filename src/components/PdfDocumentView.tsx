import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  Util,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport
} from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  createPdfAnnotation,
  getPdfAnnotationStorageKey,
  parsePdfAnnotationStore,
  removePdfAnnotation,
  serializePdfAnnotationStore,
  type PdfAnnotation,
  type PdfAnnotationKind,
  type PdfAnnotationRect
} from "../lib/pdfAnnotations";
import {
  getPdfFileName,
  PDF_VIEWER_CAPABILITIES,
  parsePdfPage,
  sanitizePdfPage,
  type PdfZoom
} from "../lib/pdf";
import { installPdfRuntimeCompatibility } from "../lib/pdfRuntimeCompatibility";

installPdfRuntimeCompatibility();
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfReaderPaneProps {
  path: string;
  sourceUrl: string | Uint8Array | null;
  onClose: () => void;
  loadAnnotations?: (path: string) => Promise<PdfAnnotation[]>;
  saveAnnotations?: (path: string, annotations: PdfAnnotation[]) => Promise<void>;
  onStatusChange?: (message: string) => void;
}

type PdfLoadState = "idle" | "loading" | "loaded" | "error";

interface PageMeta {
  pageNumber: number;
  width: number;
  height: number;
}

interface PendingSelection {
  pageNumber: number;
  quote: string;
  rects: PdfAnnotationRect[];
}

const zoomOptions: ReadonlyArray<{ label: string; value: PdfZoom }> = [
  { label: "Fit width", value: "page-width" },
  { label: "Fit page", value: "page-fit" },
  { label: "80%", value: 80 },
  { label: "100%", value: 100 },
  { label: "125%", value: 125 },
  { label: "150%", value: 150 },
  { label: "200%", value: 200 }
];

interface LocalAnnotationSnapshot {
  exists: boolean;
  annotations: PdfAnnotation[];
}

const safeLocalStorageRead = (key: string): LocalAnnotationSnapshot => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return { exists: false, annotations: [] };
    const candidate: unknown = JSON.parse(raw);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      (candidate as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !Array.isArray((candidate as { annotations?: unknown }).annotations)
    ) {
      return { exists: false, annotations: [] };
    }
    return { exists: true, annotations: parsePdfAnnotationStore(raw).annotations };
  } catch {
    return { exists: false, annotations: [] };
  }
};

const safeLocalStorageWrite = (key: string, annotations: PdfAnnotation[]): boolean => {
  try {
    window.localStorage.setItem(key, serializePdfAnnotationStore(annotations));
    return true;
  } catch {
    return false;
  }
};

const clampRect = (value: number): number => Math.min(1, Math.max(0, value));
const preferredScrollBehavior = (): ScrollBehavior =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

const isPdfTextItem = (item: TextContent["items"][number]): item is TextItem =>
  "str" in item;

const isTauriWebView = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const renderPortableTextLayer = (
  textContent: TextContent,
  container: HTMLDivElement,
  viewport: PageViewport
): void => {
  container.replaceChildren();
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  for (const item of textContent.items) {
    if (!isPdfTextItem(item) || !item.str) continue;
    const style = textContent.styles[item.fontName];
    const transform = Util.transform(viewport.transform, item.transform);
    let angle = Math.atan2(transform[1], transform[0]);
    if (style?.vertical) angle += Math.PI / 2;
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const fontFamily = style?.fontFamily || "sans-serif";
    const span = document.createElement("span");
    span.textContent = item.str;
    span.dir = item.dir;
    span.style.left = `${transform[4]}px`;
    span.style.top = `${transform[5] - fontHeight * (style?.ascent ?? 0.8)}px`;
    span.style.setProperty("--font-height", `${fontHeight}px`);
    span.style.fontFamily = fontFamily;
    if (angle !== 0) {
      span.style.setProperty("--rotate", `${angle * (180 / Math.PI)}deg`);
    }
    if (measureContext && item.width > 0) {
      measureContext.font = `${fontHeight}px ${fontFamily}`;
      const measuredWidth = measureContext.measureText(item.str).width;
      if (measuredWidth > 0) {
        span.style.setProperty("--scale-x", `${item.width * viewport.scale / measuredWidth}`);
      }
    }
    container.append(span);
  }
};

const getSelectionForPage = (
  pageElement: HTMLElement,
  pageNumber: number
): PendingSelection | null => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!pageElement.contains(range.startContainer) || !pageElement.contains(range.endContainer)) {
    return null;
  }

  const quote = selection.toString().replace(/\s+/gu, " ").trim();
  const pageRect = pageElement.getBoundingClientRect();
  if (!quote || pageRect.width <= 0 || pageRect.height <= 0) return null;

  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: clampRect((rect.left - pageRect.left) / pageRect.width),
      top: clampRect((rect.top - pageRect.top) / pageRect.height),
      width: clampRect(rect.width / pageRect.width),
      height: clampRect(rect.height / pageRect.height)
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);

  return rects.length > 0 ? { pageNumber, quote, rects } : null;
};

interface PdfPageViewProps {
  pdf: PDFDocumentProxy;
  meta: PageMeta;
  scale: number;
  annotations: PdfAnnotation[];
  onSelection: (selection: PendingSelection | null) => void;
  onKeyboardAnnotation: (selection: PendingSelection, kind: PdfAnnotationKind) => void;
  onMetaChange: (meta: PageMeta) => void;
}

function PdfPageView({
  pdf,
  meta,
  scale,
  annotations,
  onSelection,
  onKeyboardAnnotation,
  onMetaChange
}: PdfPageViewProps) {
  const pageElementRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(meta.pageNumber === 1);

  useEffect(() => {
    const element = pageElementRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsNearViewport(entry.isIntersecting);
    }, { rootMargin: "600px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isNearViewport) return;
    setPageError(null);
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayer: TextLayer | null = null;
    let loadedPage: PDFPageProxy | null = null;
    let renderStage = "load PDF page";

    void pdf
      .getPage(meta.pageNumber)
      .then(async (nextPage) => {
        if (cancelled) {
          nextPage.cleanup();
          return;
        }

        loadedPage = nextPage;
        const viewport = nextPage.getViewport({ scale });
        const baseViewport = nextPage.getViewport({ scale: 1 });
        onMetaChange({
          pageNumber: meta.pageNumber,
          width: baseViewport.width,
          height: baseViewport.height
        });
        const canvas = canvasRef.current;
        const textLayerContainer = textLayerRef.current;
        if (!canvas || !textLayerContainer) return;

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayerContainer.replaceChildren();

        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF canvas is unavailable");
        renderStage = "render PDF canvas";
        renderTask = nextPage.render({
          canvasContext: context,
          canvas,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
        });
        await renderTask.promise;

        renderStage = "read PDF text";
        const textContent = await nextPage.getTextContent();
        if (cancelled) return;
        renderStage = "render selectable PDF text";
        if (isTauriWebView()) {
          renderPortableTextLayer(textContent, textLayerContainer, viewport);
        } else {
          try {
            textLayer = new TextLayer({
              textContentSource: textContent,
              container: textLayerContainer,
              viewport
            });
            await textLayer.render();
          } catch (error: unknown) {
            textLayer = null;
            console.warn(
              `PDF page ${meta.pageNumber} used the portable selectable-text fallback`,
              error
            );
            renderPortableTextLayer(textContent, textLayerContainer, viewport);
          }
        }
        textLayerContainer.querySelectorAll<HTMLElement>("span").forEach((span) => {
          const text = span.textContent?.replace(/\s+/gu, " ").trim();
          if (!text) return;
          span.tabIndex = 0;
          span.dataset.pdfKeyboardText = "true";
          span.setAttribute("role", "button");
          span.setAttribute("aria-keyshortcuts", "H U R");
          span.setAttribute(
            "aria-label",
            `${text}. Press H to highlight, U to underline, or R to redact this text.`
          );
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(`PDF page ${meta.pageNumber} render failed`, error);
          setPageError(
            renderStage === "read PDF text" || renderStage === "render selectable PDF text"
              ? "Selectable text is unavailable on this page."
              : "This PDF page could not be rendered."
          );
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      loadedPage?.cleanup();
    };
  }, [isNearViewport, meta.pageNumber, onMetaChange, pdf, scale]);

  const pageStyle = useMemo<CSSProperties>(
    () => ({
      width: `${meta.width * scale}px`,
      height: `${meta.height * scale}px`
    }),
    [meta.height, meta.width, scale]
  );

  const pageAnnotations = annotations.filter((annotation) => annotation.pageNumber === meta.pageNumber);

  return (
    <div
      className="pdf-page"
      data-pdf-page={meta.pageNumber}
      data-page-number={meta.pageNumber}
      role="group"
      aria-label={`PDF page ${meta.pageNumber}`}
      ref={pageElementRef}
      style={pageStyle}
      onMouseUp={() => {
        window.setTimeout(() => {
          if (pageElementRef.current) {
            onSelection(getSelectionForPage(pageElementRef.current, meta.pageNumber));
          }
        }, 0);
      }}
      onKeyDown={(event) => {
        const shortcut = event.key.toLowerCase();
        if (shortcut !== "h" && shortcut !== "u" && shortcut !== "r") return;
        const target = event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[data-pdf-keyboard-text="true"]')
          : null;
        const pageElement = pageElementRef.current;
        if (!target || !pageElement) return;
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(target);
        const browserSelection = window.getSelection();
        browserSelection?.removeAllRanges();
        browserSelection?.addRange(range);
        const selection = getSelectionForPage(pageElement, meta.pageNumber);
        if (selection) {
          const kind: PdfAnnotationKind = shortcut === "h"
            ? "highlight"
            : shortcut === "u"
              ? "underline"
              : "redact";
          onKeyboardAnnotation(selection, kind);
        }
      }}
    >
      {isNearViewport ? (
        <>
          <canvas className="pdf-page-canvas" ref={canvasRef} aria-hidden="true" />
          <div className="textLayer pdf-page-text-layer" ref={textLayerRef} />
        </>
      ) : (
        <span className="pdf-page-loading" aria-hidden="true">Page {meta.pageNumber}</span>
      )}
      <div className="pdf-annotation-layer" aria-hidden="true">
        {pageAnnotations.flatMap((annotation) =>
          annotation.rects.map((rect, index) => (
            <span
              className={`pdf-annotation-mark is-${annotation.kind}`}
              data-annotation-id={annotation.id}
              data-annotation-kind={annotation.kind}
              key={`${annotation.id}-${index}`}
              style={{
                left: `${rect.left * 100}%`,
                top: `${rect.top * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`
              }}
              title={annotation.quote}
            />
          ))
        )}
      </div>
      {pageError ? (
        <div className="pdf-page-error">
          <strong>Page could not be rendered.</strong>
          <span>{pageError}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function PdfDocumentView({
  path,
  sourceUrl,
  onClose,
  loadAnnotations,
  saveAnnotations,
  onStatusChange
}: PdfReaderPaneProps) {
  const name = useMemo(() => getPdfFileName(path), [path]);
  const titleId = useId();
  const capabilityId = useId();
  const annotationsTitleId = useId();
  const redactionSafetyId = useId();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const annotationsRef = useRef<PdfAnnotation[]>([]);
  const annotationBusyRef = useRef(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageMetas, setPageMetas] = useState<PageMeta[]>([]);
  const [page, setPage] = useState(1);
  const [draftPage, setDraftPage] = useState("1");
  const [zoom, setZoom] = useState<PdfZoom>("page-width");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [loadState, setLoadState] = useState<PdfLoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [annotationBusy, setAnnotationBusy] = useState(false);

  const storageKey = useMemo(() => getPdfAnnotationStorageKey(path), [path]);

  const replaceAnnotations = useCallback((next: PdfAnnotation[]): void => {
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  useEffect(() => {
    const element = viewerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const local = safeLocalStorageRead(storageKey);
    replaceAnnotations([]);
    if (!loadAnnotations) {
      replaceAnnotations(local.annotations);
      return () => {
        active = false;
      };
    }

    void loadAnnotations(path)
      .then((loaded) => {
        if (!active) return;
        const next = local.exists ? local.annotations : loaded;
        replaceAnnotations(next);
        if (!local.exists) safeLocalStorageWrite(storageKey, loaded);
      })
      .catch(() => {
        if (!active) return;
        replaceAnnotations(local.annotations);
        if (local.exists) onStatusChange?.("PDF annotations restored from local backup");
      });
    return () => {
      active = false;
    };
  }, [loadAnnotations, onStatusChange, path, replaceAnnotations, storageKey]);

  useEffect(() => {
    let cancelled = false;
    if (!sourceUrl) {
      setPdf(null);
      setPageMetas([]);
      setLoadState("idle");
      setLoadError(null);
      return;
    }

    setLoadState("loading");
    setLoadError(null);
    const loadingTask = getDocument(
      // PDF.js can transfer ownership of typed arrays to its worker. Keep the
      // state-owned bytes intact so React Strict Mode can safely restart this effect.
      typeof sourceUrl === "string" ? { url: sourceUrl } : { data: sourceUrl.slice() }
    );
    void loadingTask.promise
      .then(async (document) => {
        if (cancelled) {
          await document.cleanup();
          return;
        }
        const firstLoadedPage = await document.getPage(1);
        const firstViewport = firstLoadedPage.getViewport({ scale: 1 });
        firstLoadedPage.cleanup();
        if (cancelled) {
          await document.cleanup();
          return;
        }
        const metas: PageMeta[] = Array.from({ length: document.numPages }, (_, index) => ({
          pageNumber: index + 1,
          width: firstViewport.width,
          height: firstViewport.height
        }));
        setPdf(document);
        setPageMetas(metas);
        setPage(1);
        setDraftPage("1");
        setLoadState("loaded");
        onStatusChange?.(`PDF loaded · ${document.numPages} ${document.numPages === 1 ? "page" : "pages"}`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPdf(null);
        setPageMetas([]);
        setLoadState("error");
        setLoadError(error instanceof Error ? error.message : "The PDF could not be opened");
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [onStatusChange, sourceUrl]);

  const updatePageMeta = useCallback((nextMeta: PageMeta): void => {
    setPageMetas((current) => {
      const index = nextMeta.pageNumber - 1;
      const previous = current[index];
      if (
        !previous ||
        (Math.abs(previous.width - nextMeta.width) < 0.01 &&
          Math.abs(previous.height - nextMeta.height) < 0.01)
      ) {
        return current;
      }
      const next = [...current];
      next[index] = nextMeta;
      return next;
    });
  }, []);

  useEffect(() => {
    const target = pageRefs.current.get(page);
    target?.scrollIntoView?.({ behavior: preferredScrollBehavior(), block: "start" });
  }, [page, pageMetas.length]);

  const firstPage = pageMetas[0];
  const scale = useMemo(() => {
    if (!firstPage) return 1;
    const horizontalPadding = viewportSize.width > 0 && viewportSize.width <= 767 ? 20 : 48;
    const availableWidth = Math.max(240, viewportSize.width - horizontalPadding);
    const fitWidth = availableWidth / firstPage.width;
    if (zoom === "page-width") return Math.min(2.5, Math.max(0.45, fitWidth));
    if (zoom === "page-fit") {
      const availableHeight = Math.max(420, viewportSize.height - 120);
      return Math.min(2.5, Math.max(0.5, Math.min(fitWidth, availableHeight / firstPage.height)));
    }
    return typeof zoom === "number"
      ? Math.min(3, Math.max(0.5, zoom / 100))
      : Math.min(2.5, Math.max(0.45, fitWidth));
  }, [firstPage, viewportSize.height, viewportSize.width, zoom]);

  const persistAnnotations = useCallback(
    async (next: PdfAnnotation[]): Promise<"primary" | "fallback"> => {
      if (annotationBusyRef.current) {
        throw new Error("PDF annotation persistence is already in progress");
      }
      annotationBusyRef.current = true;
      setAnnotationBusy(true);
      const previous = annotationsRef.current;
      replaceAnnotations(next);
      const localSaved = safeLocalStorageWrite(storageKey, next);
      try {
        if (!saveAnnotations) {
          if (!localSaved) throw new Error("Local annotation storage is unavailable");
          return "primary";
        }
        try {
          await saveAnnotations(path, next);
          return "primary";
        } catch (error) {
          if (localSaved) return "fallback";
          throw error;
        }
      } catch (error) {
        replaceAnnotations(previous);
        throw error;
      } finally {
        annotationBusyRef.current = false;
        setAnnotationBusy(false);
      }
    },
    [path, replaceAnnotations, saveAnnotations, storageKey]
  );

  const commitSelectionAnnotation = useCallback(
    async (selection: PendingSelection, kind: PdfAnnotationKind) => {
      if (annotationBusyRef.current) return;
      const annotation = createPdfAnnotation({
        ...selection,
        kind,
        quote: kind === "redact" ? "[redacted]" : selection.quote
      });
      if (!annotation) return;
      try {
        const persistence = await persistAnnotations([...annotationsRef.current, annotation]);
        const actionLabel = kind === "highlight"
          ? "Highlighted"
          : kind === "underline"
            ? "Underlined"
            : "Redacted";
        onStatusChange?.(
          `${actionLabel} · page ${annotation.pageNumber}` +
          (persistence === "fallback" ? " · local backup (sidecar unavailable)" : "")
        );
        setPendingSelection(null);
        window.getSelection()?.removeAllRanges();
      } catch {
        onStatusChange?.("Could not persist PDF annotation");
      }
    }, [onStatusChange, persistAnnotations]
  );

  const commitAnnotation = useCallback(
    async (kind: PdfAnnotationKind) => {
      if (!pendingSelection) return;
      await commitSelectionAnnotation(pendingSelection, kind);
    }, [commitSelectionAnnotation, pendingSelection]
  );

  const removeAnnotation = useCallback(
    async (id: string) => {
      if (annotationBusyRef.current) return;
      try {
        const persistence = await persistAnnotations(removePdfAnnotation(annotationsRef.current, id));
        onStatusChange?.(
          "PDF annotation removed" +
          (persistence === "fallback" ? " · local backup (sidecar unavailable)" : "")
        );
      } catch {
        onStatusChange?.("Could not persist PDF annotation removal");
      }
    },
    [onStatusChange, persistAnnotations]
  );

  const commitPage = (rawPage: string): void => {
    const parsed = parsePdfPage(rawPage);
    if (parsed === null) {
      setDraftPage(String(page));
      return;
    }
    const nextPage = Math.min(pageMetas.length || 100_000, sanitizePdfPage(parsed));
    setPage(nextPage);
    setDraftPage(String(nextPage));
  };

  const handlePageInput = (value: string): void => {
    setDraftPage(value);
    if (parsePdfPage(value) !== null) commitPage(value);
  };

  const statusText = loadState === "error"
    ? `Could not load this PDF${loadError ? ` · ${loadError}` : ""}`
    : loadState === "loading"
      ? "Loading PDF…"
      : `${pageMetas.length || 0} pages · ${annotations.length} annotations`;

  return (
    <section
      className={`pdf-reader-pane pdf-reader-pane-js${pendingSelection ? " has-selection" : ""}`}
      aria-labelledby={titleId}
      data-pdf-renderer={PDF_VIEWER_CAPABILITIES.renderer}
      data-pdf-annotations="supported"
    >
      <header className="pdf-reader-toolbar">
        <div className="pdf-reader-title">
          <span className="pdf-reader-eyebrow">PDF</span>
          <strong id={titleId} title={path}>{name}</strong>
          <span className="pdf-reader-capability" id={capabilityId}>
            Select text to highlight, underline or visually redact
          </span>
        </div>
        <div className="pdf-reader-controls" role="group" aria-label="PDF controls" aria-describedby={capabilityId}>
          <button className="pdf-reader-nav-button" type="button" onClick={() => commitPage(String(Math.max(1, page - 1)))} disabled={page <= 1} aria-label="Previous page">Prev</button>
          <label className="pdf-reader-page-label">
            <span>Page</span>
            <input
              type="number"
              min="1"
              max={pageMetas.length || undefined}
              inputMode="numeric"
              value={draftPage}
              onChange={(event) => handlePageInput(event.currentTarget.value)}
              onBlur={(event) => commitPage(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Enter") commitPage(event.currentTarget.value); }}
              aria-label="Jump to page"
            />
          </label>
          <span className="pdf-reader-page-count">/ {pageMetas.length || "–"}</span>
          <button className="pdf-reader-nav-button" type="button" onClick={() => commitPage(String(page + 1))} disabled={!pageMetas.length || page >= pageMetas.length} aria-label="Next page">Next</button>
          <label className="pdf-reader-zoom-label">
            <span>Zoom</span>
            <select value={String(zoom)} onChange={(event) => {
              const next = zoomOptions.find((option) => String(option.value) === event.currentTarget.value);
              if (next) setZoom(next.value);
            }} aria-label="PDF zoom">
              {zoomOptions.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <button className="pdf-reader-close" type="button" onClick={onClose} aria-label="Close PDF and return to editor">Back to editor</button>
      </header>

      {pendingSelection ? (
        <div
          className="pdf-selection-toolbar"
          role="toolbar"
          aria-label="PDF annotation actions"
          aria-describedby={redactionSafetyId}
        >
          <span className="pdf-selection-quote" title={pendingSelection.quote}>“{pendingSelection.quote.slice(0, 72)}{pendingSelection.quote.length > 72 ? "…" : ""}”</span>
          <button className="pdf-selection-action is-highlight" type="button" disabled={annotationBusy} onClick={() => void commitAnnotation("highlight")}>Highlight</button>
          <button className="pdf-selection-action is-underline" type="button" disabled={annotationBusy} onClick={() => void commitAnnotation("underline")}>Underline</button>
          <button className="pdf-selection-action is-redact" type="button" disabled={annotationBusy} onClick={() => void commitAnnotation("redact")}>Redact</button>
          <button type="button" className="pdf-selection-action is-quiet" onClick={() => setPendingSelection(null)}>Cancel</button>
        </div>
      ) : null}

      <div className="pdf-reader-body">
        <div className="pdf-reader-scroll" ref={viewerRef}>
          {sourceUrl && pdf ? (
            <div className="pdf-pages" aria-label="PDF pages">
              {pageMetas.map((meta) => (
                <div key={meta.pageNumber} ref={(element) => {
                  if (element) pageRefs.current.set(meta.pageNumber, element);
                  else pageRefs.current.delete(meta.pageNumber);
                }}>
                  <PdfPageView
                    pdf={pdf}
                    meta={meta}
                    scale={scale}
                    annotations={annotations}
                    onSelection={setPendingSelection}
                    onKeyboardAnnotation={(selection, kind) => {
                      void commitSelectionAnnotation(selection, kind);
                    }}
                    onMetaChange={updatePageMeta}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="pdf-reader-empty">
              <strong>{sourceUrl ? (loadState === "error" ? "PDF could not be opened" : "Loading PDF reader") : "PDF preview is available in the Tauri desktop app"}</strong>
              <span>{sourceUrl ? statusText : "Open this file from the packaged app to use the local reader."}</span>
              <span>Text selection, highlights, underlines and redactions are stored beside the PDF.</span>
            </div>
          )}
        </div>
        <aside className="pdf-annotation-sidebar" aria-labelledby={annotationsTitleId} aria-busy={annotationBusy}>
          <div className="pdf-annotation-sidebar-head"><span id={annotationsTitleId}>Marks</span><strong>{annotations.length}</strong></div>
          <p id={redactionSafetyId} role="note">
            Redaction is a visual cover only. It does not securely delete the underlying PDF text.
          </p>
          {annotationBusy ? <span className="pdf-annotation-saving">Saving…</span> : null}
          {annotations.length === 0 ? (
            <p>Select a sentence to highlight, underline or redact it.</p>
          ) : (
            <div className="pdf-annotation-list">
              {annotations.map((annotation) => (
                <div key={annotation.id} className="pdf-annotation-item">
                  <button type="button" className="pdf-annotation-jump" onClick={() => {
                    setPage(annotation.pageNumber);
                    pageRefs.current.get(annotation.pageNumber)?.scrollIntoView?.({ behavior: preferredScrollBehavior(), block: "start" });
                  }}>
                    <span className={`pdf-annotation-dot is-${annotation.kind}`} />
                    <span><strong>p. {annotation.pageNumber}</strong> {annotation.quote}</span>
                  </button>
                  <button
                    type="button"
                    className="pdf-annotation-remove"
                    aria-label={`Remove ${annotation.kind} on page ${annotation.pageNumber}`}
                    disabled={annotationBusy}
                    onClick={() => void removeAnnotation(annotation.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      <p className="pdf-reader-status" role="status" aria-live="polite">{statusText}</p>
    </section>
  );
}
