import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import TopBar from "../../src/components/TopBar";

const mountTopBar = () => {
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
        readerPalette: "void",
        ultraRead: {
          enabled: false,
          fixation: 0.45,
          minWordLength: 4,
          focusWeight: 760
        },
        readMode: false,
        focusMode: false,
        checklistLabel: "Tasks 1/2 (50%)",
        cosmicOpen: false,
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
        onOpenUserGuide: vi.fn(),
        onValidateLinks: vi.fn(),
        onFormatTables: vi.fn(),
        onToggleReadMode: vi.fn(),
        onToggleFocusMode: vi.fn(),
        onToggleCosmic: vi.fn(),
        onReaderPaletteChange: vi.fn(),
        onUltraReadEnabledChange: vi.fn(),
        onUltraReadFixationChange: vi.fn(),
        onUltraReadMinWordLengthChange: vi.fn(),
        onUltraReadFocusWeightChange: vi.fn(),
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
  it("surfaces clearer utility labels", () => {
    const { host, unmount } = mountTopBar();
    try {
      const text = host.textContent ?? "";
      expect(text).toContain("More");
      expect(text).toContain("Check Links");
      expect(text).toContain("Format Tables");
      expect(text).toContain("User Guide");
      expect(text).toContain("Reader");
      expect(text).toContain("Hide Files");
      expect(text).toContain("Cmd+K");
    } finally {
      unmount();
    }
  });
});
