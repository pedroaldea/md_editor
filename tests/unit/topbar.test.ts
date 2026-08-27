import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import TopBar, { type ViewMode } from "../../src/components/TopBar";
import type { ReaderPreferences } from "../../src/types/app";

const mountTopBar = (
  viewMode: ViewMode = "split",
  onReaderFontSizeChange = vi.fn(),
  onReaderContentWidthChange = vi.fn(),
  readerPreferences: ReaderPreferences = { fontSize: 18, contentWidth: 960 }
) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  flushSync(() => {
    root.render(
      createElement(TopBar, {
        path: "/tmp/demo.md",
        dirty: false,
        status: "Ready",
        error: null,
        ultraRead: {
          enabled: false,
          fixation: 0.45,
          minWordLength: 4,
          focusWeight: 760
        },
        readerPreferences,
        viewMode,
        focusMode: false,
        checklistLabel: "Tasks 1/2 (50%)",
        sidebarAvailable: true,
        sidebarCollapsed: false,
        onNew: vi.fn(),
        onOpen: vi.fn(),
        onOpenFolder: vi.fn(),
        onSave: vi.fn(),
        onSaveAs: vi.fn(),
        onOpenCommandPalette: vi.fn(),
        onOpenExport: vi.fn(),
        onOpenHistory: vi.fn(),
        onValidateLinks: vi.fn(),
        onFormatTables: vi.fn(),
        onViewModeChange: vi.fn(),
        onToggleFocusMode: vi.fn(),
        onUltraReadEnabledChange: vi.fn(),
        onUltraReadFixationChange: vi.fn(),
        onUltraReadMinWordLengthChange: vi.fn(),
        onUltraReadFocusWeightChange: vi.fn(),
        onReaderFontSizeChange,
        onReaderContentWidthChange,
        onToggleSidebar: vi.fn()
      })
    );
  });

  return {
    host,
    unmount: () => {
      flushSync(() => {
        root.unmount();
      });
      host.remove();
    }
  };
};

describe("TopBar", () => {
  it("surfaces the minimal view, theme, and secondary tool contract", () => {
    const { host, unmount } = mountTopBar();
    try {
      const text = host.textContent ?? "";
      expect(text).toContain("[more]");
      expect(text).toContain("Check Links");
      expect(text).toContain("Format Tables");
      expect(text).toContain("Comfort");
      expect(text).toContain("Files");
      expect(text).toContain("Bionic");
      expect(text).toContain("[edit]");
      expect(text).toContain("[split]");
      expect(text).toContain("[read]");
      expect(text).toContain("[theme: dark]");
      expect(text).toContain("[search]");
      expect(text).not.toContain("Md Editor");
    } finally {
      unmount();
    }
  });

  it("shows direct reading controls only in Read and dispatches their changes", () => {
    const onFontSize = vi.fn();
    const onContentWidth = vi.fn();
    const { host, unmount } = mountTopBar("read", onFontSize, onContentWidth);
    try {
      expect(host.querySelector<HTMLOutputElement>('[aria-label="Reading text size"]')?.textContent).toBe("18px");
      expect(host.querySelector<HTMLOutputElement>('[aria-label="Reading canvas width"]')?.textContent).toBe("960px");

      host.querySelector<HTMLButtonElement>('[aria-label="Increase reading text size"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="Widen reading column"]')?.click();

      expect(onFontSize).toHaveBeenCalledWith(19);
      expect(onContentWidth).toHaveBeenCalledWith(1040);
    } finally {
      unmount();
    }
  });

  it("disables growth controls at the safe Read limits", () => {
    const { host, unmount } = mountTopBar("read", vi.fn(), vi.fn(), {
      fontSize: 24,
      contentWidth: 1280
    });
    try {
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Increase reading text size"]')?.disabled).toBe(true);
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Widen reading column"]')?.disabled).toBe(true);
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Decrease reading text size"]')?.disabled).toBe(false);
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Narrow reading column"]')?.disabled).toBe(false);
    } finally {
      unmount();
    }
  });
});
