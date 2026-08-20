import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
  textLayerRender: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
  Util: {
    transform: (first: number[], second: number[]) => [
      first[0] * second[0] + first[2] * second[1],
      first[1] * second[0] + first[3] * second[1],
      first[0] * second[2] + first[2] * second[3],
      first[1] * second[2] + first[3] * second[3],
      first[0] * second[4] + first[2] * second[5] + first[4],
      first[1] * second[4] + first[3] * second[5] + first[5]
    ]
  },
  TextLayer: class TextLayer {
    render = pdfMocks.textLayerRender;
    cancel = vi.fn();
  }
}));

import { getDocument } from "pdfjs-dist";
import PdfDocumentView from "../../src/components/PdfDocumentView";

const setReactActEnvironment = (enabled: boolean): void => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = enabled;
};

const mountPdf = (
  sourceUrl: string | Uint8Array | null = null,
  overrides: Partial<React.ComponentProps<typeof PdfDocumentView>> = {}
) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  const onStatusChange = vi.fn();

  flushSync(() => {
    root.render(
      createElement(PdfDocumentView, {
        path: "/tmp/report.pdf",
        sourceUrl,
        onClose,
        onStatusChange,
        ...overrides
      })
    );
  });

  return {
    host,
    onClose,
    onStatusChange,
    unmount: () => {
      flushSync(() => root.unmount());
      host.remove();
    }
  };
};

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  pdfMocks.textLayerRender.mockResolvedValue(undefined);
});

describe("PdfDocumentView", () => {
  it("renders the PDF.js text-layer boundary and annotation controls", () => {
    const { host, unmount } = mountPdf();
    try {
      expect(host.querySelector("[data-pdf-renderer='pdfjs']")).not.toBeNull();
      expect(host.querySelector("[data-pdf-annotations='supported']")).not.toBeNull();
      expect(host.textContent).toContain("Select text to highlight, underline or visually redact");
      expect(host.querySelector('[role="note"]')?.textContent).toContain(
        "does not securely delete the underlying PDF text"
      );
      expect(host.querySelector("input[aria-label='Jump to page']")).not.toBeNull();
      expect(host.querySelector("select[aria-label='PDF zoom']")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("shows a desktop fallback when the asset URL is unavailable", () => {
    const { host, unmount } = mountPdf(null);
    try {
      expect(host.querySelector("iframe")).toBeNull();
      expect(host.textContent).toContain("available in the Tauri desktop app");
      expect(host.textContent).toContain("Text selection, highlights, underlines and redactions");
    } finally {
      unmount();
    }
  });

  it("routes the close action to the caller", () => {
    const { host, onClose, unmount } = mountPdf();
    try {
      const closeButton = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Back to editor"
      );
      closeButton?.click();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("keeps the selection action toolbar hidden until text is selected", () => {
    const { host, unmount } = mountPdf();
    try {
      expect(host.querySelector("[role='toolbar']")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("restores local annotations when the desktop sidecar cannot be read", async () => {
    setReactActEnvironment(true);
    window.localStorage.setItem(
      "md-editor:pdf-annotations:/tmp/report.pdf",
      JSON.stringify({
        schemaVersion: 1,
        annotations: [{
          id: "local-backup",
          pageNumber: 1,
          kind: "highlight",
          quote: "Recovered from local backup",
          rects: [{ left: 0.1, top: 0.1, width: 0.3, height: 0.04 }],
          createdAt: "2026-08-19T00:00:00.000Z"
        }]
      })
    );
    const loadAnnotations = vi.fn().mockRejectedValue(new Error("read-only folder"));
    let mounted!: ReturnType<typeof mountPdf>;
    act(() => {
      mounted = mountPdf(null, { loadAnnotations });
    });
    const { host, onStatusChange, unmount } = mounted;

    try {
      await act(async () => {
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(host.textContent).toContain("Recovered from local backup");
      });
      expect(onStatusChange).toHaveBeenCalledWith(
        "PDF annotations restored from local backup"
      );
    } finally {
      act(() => unmount());
      setReactActEnvironment(false);
    }
  });

  it("creates a long-document structure after page one without walking every page", async () => {
    setReactActEnvironment(true);
    const getPage = vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 612, height: 792 }),
      cleanup: vi.fn(),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: () => Promise.resolve({ items: [] })
    });
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 40, getPage, cleanup: vi.fn() }),
      destroy: vi.fn().mockResolvedValue(undefined)
    } as never);

    const originalObserver = window.IntersectionObserver;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    window.IntersectionObserver = class IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "600px 0px";
      readonly thresholds = [0];
      constructor(private readonly callback: IntersectionObserverCallback) {}
      disconnect() {}
      observe(element: Element) {
        const pageNumber = Number((element as HTMLElement).dataset.pageNumber);
        this.callback([{ isIntersecting: pageNumber === 1, target: element } as IntersectionObserverEntry], this);
      }
      takeRecords() { return []; }
      unobserve() {}
    };

    let mounted!: ReturnType<typeof mountPdf>;
    act(() => {
      mounted = mountPdf(new Uint8Array([37, 80, 68, 70, 45]));
    });
    const { host, unmount } = mounted;
    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(host.querySelectorAll(".pdf-page")).toHaveLength(40);
      });
      expect(getPage).toHaveBeenCalled();
      expect(getPage.mock.calls.every(([pageNumber]) => pageNumber === 1)).toBe(true);
      expect(host.querySelectorAll(".pdf-page-canvas")).toHaveLength(1);
      expect(host.querySelectorAll(".pdf-page-text-layer")).toHaveLength(1);
    } finally {
      act(() => unmount());
      window.IntersectionObserver = originalObserver;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      setReactActEnvironment(false);
    }
  });

  it("keeps selectable PDF text when the native WebView cannot render PDF.js TextLayer", async () => {
    setReactActEnvironment(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    pdfMocks.textLayerRender.mockRejectedValueOnce(new TypeError("Unsupported WebKit API"));
    const getPage = vi.fn().mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 612 * scale,
        height: 792 * scale,
        scale,
        transform: [scale, 0, 0, -scale, 0, 792 * scale]
      }),
      cleanup: vi.fn(),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: () => Promise.resolve({
        items: [{
          str: "Selectable fallback",
          dir: "ltr",
          width: 180,
          height: 24,
          transform: [24, 0, 0, 24, 72, 720],
          fontName: "F1",
          hasEOL: false
        }],
        styles: { F1: { fontFamily: "sans-serif", ascent: 0.8, vertical: false } }
      })
    });
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage, cleanup: vi.fn() }),
      destroy: vi.fn().mockResolvedValue(undefined)
    } as never);

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      measureText: () => ({ width: 160 })
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    let mounted!: ReturnType<typeof mountPdf>;
    act(() => {
      mounted = mountPdf(new Uint8Array([37, 80, 68, 70, 45]));
    });

    try {
      await act(async () => {
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(mounted.host.querySelector("[data-pdf-keyboard-text='true']")?.textContent)
          .toBe("Selectable fallback");
      });
      expect(mounted.host.querySelector(".pdf-page-error")).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("portable selectable-text fallback"),
        expect.any(TypeError)
      );
    } finally {
      act(() => mounted.unmount());
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      warn.mockRestore();
      setReactActEnvironment(false);
    }
  });

  it("uses the portable selectable text renderer directly inside Tauri", async () => {
    setReactActEnvironment(true);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {}
    });
    const getPage = vi.fn().mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 612 * scale,
        height: 792 * scale,
        scale,
        transform: [scale, 0, 0, -scale, 0, 792 * scale]
      }),
      cleanup: vi.fn(),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: () => Promise.resolve({
        items: [{
          str: "Native selectable text",
          dir: "ltr",
          width: 180,
          height: 24,
          transform: [24, 0, 0, 24, 72, 720],
          fontName: "F1",
          hasEOL: false
        }],
        styles: { F1: { fontFamily: "sans-serif", ascent: 0.8, vertical: false } }
      })
    });
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage, cleanup: vi.fn() }),
      destroy: vi.fn().mockResolvedValue(undefined)
    } as never);

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      measureText: () => ({ width: 160 })
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    let mounted!: ReturnType<typeof mountPdf>;
    act(() => {
      mounted = mountPdf(new Uint8Array([37, 80, 68, 70, 45]));
    });

    try {
      await act(async () => {
        for (let index = 0; index < 6; index += 1) await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(mounted.host.querySelector("[data-pdf-keyboard-text='true']")?.textContent)
          .toBe("Native selectable text");
      });
      expect(pdfMocks.textLayerRender).not.toHaveBeenCalled();
      expect(mounted.host.querySelector(".pdf-page-error")).toBeNull();
    } finally {
      act(() => mounted.unmount());
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      setReactActEnvironment(false);
    }
  });
});
