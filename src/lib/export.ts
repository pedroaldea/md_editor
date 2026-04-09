import { invoke } from "@tauri-apps/api/core";

export const PDF_EXPORT_CLASS = "pdf-exporting";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const escapeHtmlText = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

export const buildHtmlExportDocument = (title: string, bodyHtml: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlText(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 2rem;
      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      line-height: 1.7;
      font-size: 16px;
      background: #0f1115;
      color: #e5ecf3;
    }
    main { max-width: 96ch; margin: 0 auto; }
    code, pre { font-family: "JetBrains Mono", "SF Mono", monospace; }
    pre {
      background: #111723;
      border-radius: 10px;
      padding: 12px;
      overflow: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #2f3948;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    a { color: #66d9ff; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
  </style>
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`;

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
