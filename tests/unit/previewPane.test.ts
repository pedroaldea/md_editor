import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import PreviewPane from "../../src/components/PreviewPane";

const mountPreview = (html: string, handlers?: Partial<{ onExternalLink: (href: string) => void; onLocalLink: (href: string) => void; resolveImageSource: (source: string) => string; loadImageFallback: (source: string) => Promise<string | null> }>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const onExternalLink = handlers?.onExternalLink ?? vi.fn();
  const onLocalLink = handlers?.onLocalLink ?? vi.fn();

  flushSync(() => {
    root.render(
      createElement(PreviewPane, {
        html,
        activeBlockIndex: 0,
        targetScrollRatio: null,
        onScrollRatioChange: vi.fn(),
        onExternalLink,
        onLocalLink,
        resolveImageSource: handlers?.resolveImageSource,
        loadImageFallback: handlers?.loadImageFallback,
        themeMode: "light",
        ultraReadEnabled: false
      })
    );
  });

  return {
    host,
    onExternalLink,
    onLocalLink,
    unmount: () => {
      flushSync(() => {
        root.unmount();
      });
      host.remove();
    }
  };
};

describe("PreviewPane link handling", () => {
  it("renders resolved image sources instead of broken Markdown-relative URLs", () => {
    const resolver = vi.fn(() => "asset://localhost/workspace/assets/diagram.png");
    const { host, unmount } = mountPreview('<p><img src="assets/diagram.png" alt="Diagram"></p>', {
      resolveImageSource: resolver
    });

    try {
      expect(resolver).toHaveBeenCalledWith("assets/diagram.png");
      expect(host.querySelector("img")?.getAttribute("src")).toBe(
        "asset://localhost/workspace/assets/diagram.png"
      );
    } finally {
      unmount();
    }
  });

  it("falls back to validated native image data when the asset URL is blocked", async () => {
    const fallback = vi.fn(async () => "data:image/png;base64,AAAA");
    const { host, unmount } = mountPreview('<p><img src="assets/diagram.png" alt="Diagram"></p>', {
      resolveImageSource: () => "asset://localhost/outside-scope/diagram.png",
      loadImageFallback: fallback
    });

    try {
      const image = host.querySelector("img");
      image?.dispatchEvent(new Event("error"));
      await Promise.resolve();
      await Promise.resolve();
      expect(fallback).toHaveBeenCalledWith("assets/diagram.png");
      expect(image?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    } finally {
      unmount();
    }
  });

  it("routes external links to the external handler", () => {
    const external = vi.fn();
    const local = vi.fn();
    const { host, unmount } = mountPreview('<p><a href="https://example.com">Open</a></p>', {
      onExternalLink: external,
      onLocalLink: local
    });

    try {
      const link = host.querySelector("a");
      expect(link).not.toBeNull();
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(external).toHaveBeenCalledWith("https://example.com");
      expect(local).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("routes local markdown links to the local handler", () => {
    const external = vi.fn();
    const local = vi.fn();
    const { host, unmount } = mountPreview('<p><a href="./notes.md">Open</a></p>', {
      onExternalLink: external,
      onLocalLink: local
    });

    try {
      const link = host.querySelector("a");
      expect(link).not.toBeNull();
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(local).toHaveBeenCalledWith("./notes.md");
      expect(external).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("scrolls to local anchors without triggering link handlers", () => {
    const external = vi.fn();
    const local = vi.fn();
    const originalScroll = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy
    });

    const { host, unmount } = mountPreview(
      '<h2 id="section-one">Section</h2><p><a href="#section-one">Jump</a></p>',
      {
        onExternalLink: external,
        onLocalLink: local
      }
    );

    try {
      const link = host.querySelector("a");
      expect(link).not.toBeNull();
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(local).not.toHaveBeenCalled();
      expect(external).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScroll
      });
      unmount();
    }
  });
});
