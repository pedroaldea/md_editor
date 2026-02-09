import { invoke } from "@tauri-apps/api/core";

export const PDF_EXPORT_CLASS = "pdf-exporting";

export const runPdfPrint = async (
  print: () => void | Promise<unknown> = () => window.print(),
  root: HTMLElement = document.documentElement
): Promise<boolean> => {
  root.classList.add(PDF_EXPORT_CLASS);
  try {
    await invoke("plugin:webview|print");
    return true;
  } catch {
    try {
      await Promise.resolve(print());
      return true;
    } catch {
      return false;
    }
  } finally {
    root.classList.remove(PDF_EXPORT_CLASS);
  }
};
