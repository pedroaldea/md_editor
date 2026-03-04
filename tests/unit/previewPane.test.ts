import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import PreviewPane from "../../src/components/PreviewPane";

const mountPreview = (html: string, handlers?: Partial<{ onExternalLink: (href: string) => void; onLocalLink: (href: string) => void }>) => {
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
