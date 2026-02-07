import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";

interface PreviewPaneProps {
  html: string;
  activeBlockIndex: number;
  targetScrollRatio: number | null;
  onScrollRatioChange: (ratio: number) => void;
  onExternalLink: (href: string) => void;
}

export default function PreviewPane({
  html,
  activeBlockIndex,
  targetScrollRatio,
  onScrollRatioChange,
  onExternalLink
}: PreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const applyingExternalScrollRef = useRef(false);

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
    container.scrollTop = Math.max(0, maxScrollable * targetScrollRatio);
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
      behavior: "smooth",
      block: "nearest"
    });
  }, [activeBlockIndex, html]);

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
    }
  };

  return (
    <div
      className="preview-pane"
      ref={containerRef}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
