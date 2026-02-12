import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import { PDF_EXPORT_CLASS, runPdfPrint } from "../../src/lib/export";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

const setTauriRuntime = (enabled: boolean): void => {
  const tauriWindow = window as TauriWindow;
  if (enabled) {
    tauriWindow.__TAURI_INTERNALS__ = {};
    return;
  }
  delete tauriWindow.__TAURI_INTERNALS__;
};

describe("runPdfPrint", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setTauriRuntime(false);
  });

  afterEach(() => {
    setTauriRuntime(false);
  });

  it("uses browser print fallback outside Tauri runtime", async () => {
    const root = document.createElement("div");
    const print = vi.fn(() => {
      expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(true);
    });

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("calls Tauri print command when runtime is Tauri", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue(undefined);

    const root = document.createElement("div");
    const print = vi.fn();

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("plugin:webview|print");
    expect(print).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("returns false when Tauri print command fails", async () => {
    setTauriRuntime(true);
    invokeMock.mockRejectedValue(new Error("denied"));

    const root = document.createElement("div");
    const print = vi.fn();

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("plugin:webview|print");
    expect(print).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });

  it("cleans export class when browser print fallback throws", async () => {
    setTauriRuntime(false);
    const print = vi.fn(() => {
      throw new Error("print unsupported");
    });
    const root = document.createElement("div");

    const opened = await runPdfPrint(print, root);

    expect(opened).toBe(false);
    expect(print).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(root.classList.contains(PDF_EXPORT_CLASS)).toBe(false);
  });
});
