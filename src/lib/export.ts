import { invoke } from "@tauri-apps/api/core";

export const PDF_EXPORT_CLASS = "pdf-exporting";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const runPdfPrint = async (
  print: () => void | Promise<unknown> = () => window.print(),
  root: HTMLElement = document.documentElement
): Promise<boolean> => {
  root.classList.add(PDF_EXPORT_CLASS);
  try {
    if (isTauriRuntime()) {
      await invoke("plugin:webview|print");
      return true;
    }

    await Promise.resolve(print());
    return true;
  } catch {
    return false;
  } finally {
    root.classList.remove(PDF_EXPORT_CLASS);
  }
};
