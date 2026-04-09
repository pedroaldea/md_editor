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
    :root { color-scheme: light; }
    @page { margin: 16mm 18mm; }
    body {
      margin: 0;
      padding: 40px 32px 72px;
      font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      line-height: 1.75;
      font-size: 16px;
      background: #f5f0e6;
      color: #1f2329;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
    }
    article {
      width: min(100%, 82ch);
      margin: 0 auto;
    }
    article > * {
      max-width: 100%;
    }
    h1, h2, h3, h4, h5, h6 {
      margin: 1.4em 0 0.45em;
      line-height: 1.18;
      letter-spacing: -0.015em;
    }
    p, ul, ol, blockquote, pre, table {
      margin: 0 0 1rem;
    }
    code, pre { font-family: "JetBrains Mono", "SF Mono", monospace; }
    pre {
      background: #f1eadf;
      border: 1px solid #d8cfc1;
      border-radius: 14px;
      padding: 14px 16px;
      overflow: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      background: #fffdfa;
    }
    th, td {
      border: 1px solid #d8cfc1;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    a { color: #3d6480; }
    blockquote {
      margin-left: 0;
      padding-left: 1rem;
      border-left: 3px solid #d8cfc1;
      color: #4a5564;
    }
    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 1.4rem auto;
      border-radius: 12px;
      box-shadow: 0 14px 32px rgba(57, 44, 18, 0.12);
    }
    hr {
      border: none;
      border-top: 1px solid #d8cfc1;
      margin: 2rem 0;
    }
  </style>
</head>
<body>
  <main><article>${bodyHtml}</article></main>
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
