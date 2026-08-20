import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import CommandPalette from "../../src/components/CommandPalette";
import ExportModal from "../../src/components/ExportModal";
import HistoryModal from "../../src/components/HistoryModal";
import LinkValidationModal from "../../src/components/LinkValidationModal";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const mount = (element: ReactElement) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    flushSync(() => root.render(element));
  });
  return {
    host,
    unmount: () => {
      act(() => flushSync(() => root.unmount()));
      host.remove();
    }
  };
};

describe("modal accessibility", () => {
  it.each([
    ["export", (onClose: () => void) => createElement(ExportModal, { open: true, onClose, onSelect: vi.fn() })],
    ["history", (onClose: () => void) => createElement(HistoryModal, { open: true, snapshots: [], loading: false, onClose, onRestore: vi.fn() })],
    ["link validation", (onClose: () => void) => createElement(LinkValidationModal, { open: true, issues: [], checkedExternal: false, onClose, onJumpToLine: vi.fn() })]
  ])("closes the %s dialog with Escape", (_name, renderDialog) => {
    const onClose = vi.fn();
    const { host, unmount } = mount(renderDialog(onClose));
    try {
      const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.getAttribute("aria-modal")).toBe("true");
      expect(dialog?.getAttribute("tabindex")).toBe("-1");
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      unmount();
    }
  });

  it("links the command combobox to its active option", () => {
    const { host, unmount } = mount(
      createElement(CommandPalette, {
        open: true,
        onClose: vi.fn(),
        items: [
          { id: "first", type: "action", title: "First", keywords: [], run: vi.fn() },
          { id: "second", type: "action", title: "Second", keywords: [], run: vi.fn() }
        ]
      })
    );
    try {
      const input = host.querySelector<HTMLInputElement>('[role="combobox"]');
      const listbox = host.querySelector<HTMLElement>('[role="listbox"]');
      expect(input?.getAttribute("aria-controls")).toBe(listbox?.id);
      expect(input?.getAttribute("aria-activedescendant")).toBe("command-palette-first");
      expect(host.querySelector('[role="option"][aria-selected="true"]')?.id).toBe(
        "command-palette-first"
      );
    } finally {
      unmount();
    }
  });
});
