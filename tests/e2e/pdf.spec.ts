import { expect, test, type Page } from "@playwright/test";

const PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxMTEgPj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgo3MiA3MjAgVGQKKFBERi5qcyBpbnRlZ3JhdGlvbiB0ZXN0KSBUagowIC0zNiBUZAooU2VsZWN0IHRoaXMgdGV4dC4pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzg0IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDU0CiUlRU9GCg==";

const selectText = async (page: Page, index: number) => {
  await page.locator(".pdf-page-text-layer span").nth(index).evaluate((element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.closest(".pdf-page")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
};

const mountPdf = async (
  page: Page,
  sourceUrl: string,
  path = "/tmp/report.pdf",
  persistence: "local" | "sidecar-fails" | "load-fails" = "local"
) => {
  await page.evaluate(async ({ sourceUrl, path, persistence }) => {
    const pdfComponentPath = "/src/components/PdfDocumentView.tsx";
    const reactDomPath = "/@id/react-dom/client";
    const reactPath = "/@id/react";
    const [{ default: PdfDocumentView }, reactDomModule, reactModule] = await Promise.all([
      import(/* @vite-ignore */ pdfComponentPath),
      import(/* @vite-ignore */ reactDomPath),
      import(/* @vite-ignore */ reactPath)
    ]);
    const host = document.createElement("div");
    document.body.innerHTML = "";
    document.body.append(host);
    const testWindow = window as Window & {
      pdfAnnotationSaveCount?: number;
      pdfAnnotationStatus?: string;
    };
    reactDomModule.default.createRoot(host).render(
      reactModule.default.createElement(PdfDocumentView, {
        path,
        sourceUrl,
        onClose: () => undefined,
        loadAnnotations: persistence === "load-fails"
          ? async () => { throw new Error("sidecar unavailable"); }
          : undefined,
        saveAnnotations: persistence === "sidecar-fails"
          ? async () => {
              testWindow.pdfAnnotationSaveCount = (testWindow.pdfAnnotationSaveCount ?? 0) + 1;
              await new Promise((resolve) => window.setTimeout(resolve, 180));
              throw new Error("sidecar unavailable");
            }
          : undefined,
        onStatusChange: (message: string) => {
          testWindow.pdfAnnotationStatus = message;
        }
      })
    );
  }, { sourceUrl, path, persistence });
};

test("renders PDF.js text and persists highlight, underline, and opaque redaction marks", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await mountPdf(page, `data:application/pdf;base64,${PDF_BASE64}`);

  const reader = page.locator("[data-pdf-renderer='pdfjs']");
  await expect(reader).toBeVisible();
  await expect(page.getByRole("note")).toHaveText(
    "Redaction is a visual cover only. It does not securely delete the underlying PDF text."
  );
  await expect(reader).not.toHaveClass(/has-selection/);
  expect(await reader.evaluate((element) => getComputedStyle(element).gridTemplateRows.trim().split(/\s+/u).length)).toBe(3);
  await expect(page.locator(".pdf-page-text-layer span")).toHaveCount(2);
  await selectText(page, 0);
  await expect(reader).toHaveClass(/has-selection/);
  expect(await reader.evaluate((element) => getComputedStyle(element).gridTemplateRows.trim().split(/\s+/u).length)).toBe(4);
  await page.getByRole("toolbar", { name: "PDF annotation actions" }).getByRole("button", { name: "Highlight" }).click();
  await selectText(page, 1);
  await page.getByRole("toolbar", { name: "PDF annotation actions" }).getByRole("button", { name: "Underline" }).click();
  await selectText(page, 0);
  await page.getByRole("toolbar", { name: "PDF annotation actions" }).getByRole("button", { name: "Redact" }).click();

  await expect(page.locator(".pdf-annotation-mark.is-highlight")).toHaveCount(1);
  await expect(page.locator(".pdf-annotation-mark.is-underline")).toHaveCount(1);
  await expect(page.locator(".pdf-annotation-mark.is-redact")).toHaveCount(1);
  await expect(page.locator(".pdf-annotation-mark.is-redact")).toHaveCSS("background-color", "rgb(8, 10, 11)");
  const stored = await page.evaluate(() => JSON.parse(
    localStorage.getItem("md-editor:pdf-annotations:/tmp/report.pdf") ?? "{}"
  ).annotations);
  expect(stored).toHaveLength(3);
  expect(stored.find((annotation: { kind: string }) => annotation.kind === "redact")).toMatchObject({
    kind: "redact",
    quote: "[redacted]"
  });
  expect(errors).toEqual([]);
});

test("falls back to local annotations and blocks concurrent sidecar writes", async ({ page }) => {
  const path = "/tmp/read-only-report.pdf";
  await page.goto("/");
  await mountPdf(page, `data:application/pdf;base64,${PDF_BASE64}`, path, "sidecar-fails");
  await expect(page.locator(".pdf-page-text-layer span")).toHaveCount(2);

  await selectText(page, 0);
  const highlight = page
    .getByRole("toolbar", { name: "PDF annotation actions" })
    .getByRole("button", { name: "Highlight" });
  await highlight.click();
  await expect(highlight).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { pdfAnnotationStatus?: string }
  ).pdfAnnotationStatus ?? "")).toContain("local backup (sidecar unavailable)");
  expect(await page.evaluate(() => (
    window as Window & { pdfAnnotationSaveCount?: number }
  ).pdfAnnotationSaveCount)).toBe(1);
  expect(await page.evaluate((storageKey) => (
    JSON.parse(localStorage.getItem(storageKey) ?? "{}").annotations?.length
  ), `md-editor:pdf-annotations:${path}`)).toBe(1);

  await mountPdf(page, `data:application/pdf;base64,${PDF_BASE64}`, path, "load-fails");
  await expect(page.locator(".pdf-annotation-sidebar")).toContainText("PDF.js integration test");
});

test("creates a privacy-preserving PDF redaction from a keyboard-focused text chunk", async ({ page }) => {
  await page.goto("/");
  await mountPdf(page, `data:application/pdf;base64,${PDF_BASE64}`, "/tmp/keyboard-report.pdf");

  const firstTextChunk = page.locator('[data-pdf-keyboard-text="true"]').first();
  await expect(firstTextChunk).toHaveAttribute("tabindex", "0");
  await expect(firstTextChunk).toHaveAttribute("aria-keyshortcuts", "H U R");
  await firstTextChunk.focus();
  await page.keyboard.press("r");

  await expect(page.locator(".pdf-annotation-mark.is-redact")).toHaveCount(1);
  await expect(page.locator(".pdf-annotation-sidebar")).toContainText("[redacted]");
  await expect(page.getByRole("status")).toContainText("1 annotations");
  const persisted = await page.evaluate(() => (
    localStorage.getItem("md-editor:pdf-annotations:/tmp/keyboard-report.pdf") ?? ""
  ));
  expect(persisted).toContain('"quote": "[redacted]"');
  expect(persisted).not.toContain("PDF.js integration test");
});

test("keeps PDF zoom, marks, and removal usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await mountPdf(page, `data:application/pdf;base64,${PDF_BASE64}`, "/tmp/mobile-report.pdf");

  await expect(page.locator("[data-pdf-renderer='pdfjs']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

  const viewerWidth = await page.locator(".pdf-reader-scroll").evaluate((element) => element.clientWidth);
  const fitWidth = await page.locator(".pdf-page").evaluate((element) => element.getBoundingClientRect().width);
  expect(fitWidth).toBeLessThanOrEqual(viewerWidth + 1);

  await page.getByLabel("PDF zoom").selectOption("150");
  await expect.poll(() => page.locator(".pdf-page").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(fitWidth);

  await page.getByLabel("PDF zoom").selectOption("page-width");
  await selectText(page, 0);
  await page.getByRole("toolbar", { name: "PDF annotation actions" }).getByRole("button", { name: "Redact" }).click();

  const marks = page.locator(".pdf-annotation-sidebar");
  await expect(marks).toBeVisible();
  await expect(marks.getByText("[redacted]", { exact: false })).toBeVisible();
  await marks.getByRole("button", { name: "Remove redact on page 1" }).click();
  await expect(page.locator(".pdf-annotation-mark")).toHaveCount(0);
  await expect(marks.getByText("Select a sentence to highlight, underline or redact it.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("shows a bounded error state for a corrupt PDF", async ({ page }) => {
  await page.goto("/");
  await mountPdf(page, "data:application/pdf;base64,bm90LWEtcGRm", "/tmp/corrupt.pdf");

  await expect(page.getByText("PDF could not be opened", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Could not load this PDF");
  await expect(page.getByRole("button", { name: "Close PDF and return to editor" })).toBeVisible();
});
