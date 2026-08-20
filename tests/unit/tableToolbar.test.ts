import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import TableToolbar from "../../src/components/TableToolbar";

const mountToolbar = (rowIndex = 2) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onAction = vi.fn();
  const onNavigate = vi.fn();
  const onDone = vi.fn();

  flushSync(() => {
    root.render(createElement(TableToolbar, {
      context: {
        from: 0,
        to: 42,
        rowIndex,
        columnIndex: 1,
        columnCount: 3,
        alignment: "center",
        canDeleteRow: rowIndex >= 2,
        canDeleteColumn: true
      },
      left: 12,
      top: 20,
      onAction,
      onNavigate,
      onDone
    }));
  });

  return {
    host,
    onAction,
    onNavigate,
    onDone,
    unmount: () => {
      flushSync(() => root.unmount());
      host.remove();
    }
  };
};

describe("TableToolbar", () => {
  it("exposes position, navigation, structure and a clear finish action", () => {
    const mounted = mountToolbar();
    try {
      expect(mounted.host.textContent).toContain("[1:2]");
      expect(mounted.host.querySelector('[role="toolbar"]')?.getAttribute("aria-describedby"))
        .toBe("table-toolbar-position");

      (mounted.host.querySelector('[aria-label="Next cell"]') as HTMLButtonElement).click();
      (Array.from(mounted.host.querySelectorAll("button")).find((button) => button.textContent === "+ row") as HTMLButtonElement).click();
      (Array.from(mounted.host.querySelectorAll("button")).find((button) => button.textContent === "done") as HTMLButtonElement).click();

      expect(mounted.onNavigate).toHaveBeenCalledWith("next");
      expect(mounted.onAction).toHaveBeenCalledWith("add-row");
      expect(mounted.onDone).toHaveBeenCalledOnce();
    } finally {
      mounted.unmount();
    }
  });

  it("identifies the header and protects it from row deletion", () => {
    const mounted = mountToolbar(0);
    try {
      expect(mounted.host.textContent).toContain("[H:2]");
      expect(mounted.host.querySelector('[aria-label^="Header"]')).not.toBeNull();
      const removeRow = Array.from(mounted.host.querySelectorAll("button"))
        .find((button) => button.textContent === "− row");
      expect(removeRow?.disabled).toBe(true);
    } finally {
      mounted.unmount();
    }
  });
});
