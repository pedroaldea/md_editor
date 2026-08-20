import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { renderMermaidDiagrams } from "../lib/mermaidRenderer";
import { rewritePreviewImageSources } from "../lib/previewAssets";
import type { ThemeMode } from "../types/app";

const preferredScrollBehavior = (): ScrollBehavior =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

interface PreviewPaneProps {
  html: string;
  activeBlockIndex: number;
  targetScrollRatio: number | null;
  onScrollRatioChange: (ratio: number) => void;
  onExternalLink: (href: string) => void;
  onLocalLink: (href: string) => void;
  resolveImageSource?: (source: string) => string;
  loadImageFallback?: (source: string) => Promise<string | null>;
  themeMode: ThemeMode;
  ultraReadEnabled: boolean;
}

const PreviewHtml = memo(function PreviewHtml({ html }: { html: string }) {
  return <div className="preview-content" dangerouslySetInnerHTML={{ __html: html }} />;
});

export default function PreviewPane({
  html,
  activeBlockIndex,
  targetScrollRatio,
  onScrollRatioChange,
  onExternalLink,
  onLocalLink,
  resolveImageSource,
  loadImageFallback,
  themeMode,
  ultraReadEnabled
}: PreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const applyingExternalScrollRef = useRef(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const resolvedHtml = useMemo(
    () => rewritePreviewImageSources(html, resolveImageSource),
    [html, resolveImageSource]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();
    const diagrams = [...container.querySelectorAll<HTMLElement>(".mermaid-diagram")];
    const pendingDiagrams = new Set(diagrams);
    const timeouts = new Set<number>();
    let visibilityPoll = 0;
    let remainingVisibilityPolls = 40;
    let lastViewportChangeAt = Number.NEGATIVE_INFINITY;
    const stopVisibilityPoll = (): void => {
      if (visibilityPoll === 0) return;
      window.clearInterval(visibilityPoll);
      visibilityPoll = 0;
    };
    const renderDiagram = (diagram: HTMLElement): void => {
      if (diagram.dataset.mermaidRenderScheduled === "true") return;
      diagram.dataset.mermaidRenderScheduled = "true";
      diagram.dataset.mermaidRenderState = "scheduled";
      let timeout = 0;
      const beginWhenViewportIsStill = (): void => {
        timeouts.delete(timeout);
        const idleFor = performance.now() - lastViewportChangeAt;
        if (idleFor < 180) {
          timeout = window.setTimeout(beginWhenViewportIsStill, 180 - idleFor);
          timeouts.add(timeout);
          return;
        }
        pendingDiagrams.delete(diagram);
        delete diagram.dataset.mermaidRenderScheduled;
        diagram.dataset.mermaidRenderState = "rendering";
        void renderMermaidDiagrams(diagram, themeMode, controller.signal);
      };
      timeout = window.setTimeout(beginWhenViewportIsStill, 120);
      timeouts.add(timeout);
    };

    const renderNearbyDiagrams = (): void => {
      const containerBounds = container.getBoundingClientRect();
      pendingDiagrams.forEach((diagram) => {
        const bounds = diagram.getBoundingClientRect();
        const isNearby =
          bounds.bottom >= containerBounds.top - 600 &&
          bounds.top <= containerBounds.bottom + 600;
        if (!isNearby) return;
        renderDiagram(diagram);
      });
      if (pendingDiagrams.size === 0) stopVisibilityPoll();
    };
    const handleViewportChange = (): void => {
      lastViewportChangeAt = performance.now();
      renderNearbyDiagrams();
    };
    container.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    const initialFrame = window.requestAnimationFrame(renderNearbyDiagrams);
    // WebKit can update a nested pane without a reliable scroll event. Keep a
    // short safety window for that case; normal scroll/resize events remain
    // active afterwards, so an untouched off-screen diagram costs no idle CPU.
    if (pendingDiagrams.size > 0) {
      visibilityPoll = window.setInterval(() => {
        renderNearbyDiagrams();
        remainingVisibilityPolls -= 1;
        if (remainingVisibilityPolls <= 0) stopVisibilityPoll();
      }, 250);
    }

    return () => {
      window.cancelAnimationFrame(initialFrame);
      stopVisibilityPoll();
      container.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      controller.abort();
    };
  }, [resolvedHtml, themeMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loadImageFallback) return;

    const cleanups: Array<() => void> = [];
    container.querySelectorAll<HTMLImageElement>("img[data-preview-source]").forEach((image) => {
      const loadFallback = (): void => {
        const source = image.dataset.previewSource;
        if (!source || image.dataset.previewFallback === "loading") return;
        image.dataset.previewFallback = "loading";
        void loadImageFallback(source).then((fallbackSource) => {
          if (!fallbackSource || !image.isConnected) return;
          image.src = fallbackSource;
          image.dataset.previewFallback = "loaded";
        });
      };

      image.addEventListener("error", loadFallback, { once: true });
      cleanups.push(() => image.removeEventListener("error", loadFallback));
      if (image.complete && image.naturalWidth === 0) queueMicrotask(loadFallback);
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [loadImageFallback, resolvedHtml]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onScroll = (): void => {
      if (applyingExternalScrollRef.current) {
        return;
      }
      const maxScrollable = container.scrollHeight - container.clientHeight;
      const ratio = maxScrollable > 0 ? container.scrollTop / maxScrollable : 0;
      setScrollProgress(Math.max(0, Math.min(1, ratio)));
      onScrollRatioChange(ratio);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [onScrollRatioChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || targetScrollRatio === null) {
      return;
    }

    applyingExternalScrollRef.current = true;
    const maxScrollable = container.scrollHeight - container.clientHeight;
    const nextRatio = Math.max(0, Math.min(1, targetScrollRatio));
    container.scrollTop = Math.max(0, maxScrollable * nextRatio);
    setScrollProgress(nextRatio);
    requestAnimationFrame(() => {
      applyingExternalScrollRef.current = false;
    });
  }, [targetScrollRatio]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const target = container.querySelector<HTMLElement>(
      `[data-block-index="${activeBlockIndex}"]`
    );

    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "nearest"
    });
  }, [activeBlockIndex]);

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a");

    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href");
    if (!href) {
      return;
    }

    if (href.startsWith("http://") || href.startsWith("https://")) {
      event.preventDefault();
      onExternalLink(href);
      return;
    }

    if (href.startsWith("#")) {
      event.preventDefault();
      const anchorId = href.slice(1).trim();
      if (!anchorId) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      let decodedAnchorId = anchorId;
      try {
        decodedAnchorId = decodeURIComponent(anchorId);
      } catch {
        // Keep raw id when decoding fails.
      }
      const anchorTarget = container.ownerDocument.getElementById(decodedAnchorId);
      if (anchorTarget && container.contains(anchorTarget)) {
        anchorTarget.scrollIntoView({
          behavior: preferredScrollBehavior(),
          block: "nearest"
        });
      }
      return;
    }

    if (/^[a-z][a-z\d+\-.]*:/iu.test(href)) {
      return;
    }

    event.preventDefault();
    onLocalLink(href);
  };

  return (
    <div
      className={`preview-pane${ultraReadEnabled ? " ultra-read" : ""}`}
      ref={containerRef}
      onClick={handleClick}
    >
      <div className="preview-progress-rail" aria-hidden="true">
        <span
          className="preview-progress-fill"
          style={{ transform: `scaleY(${scrollProgress})` }}
        />
      </div>
      <PreviewHtml html={resolvedHtml} />
    </div>
  );
}
