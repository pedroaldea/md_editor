import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const replaceDocument = async (page: Page, markdown: string): Promise<void> => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(markdown);
  await page.getByRole("button", { name: "Split", exact: true }).click();
};

const extractPdfText = async (pdfBytes: Uint8Array): Promise<{ pages: number; text: string }> => {
  const loadingTask = getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pdfPage = await pdf.getPage(pageNumber);
    const content = await pdfPage.getTextContent();
    pageTexts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ")
    );
  }

  const pages = pdf.numPages;
  await loadingTask.destroy();
  return { pages, text: pageTexts.join("\n") };
};

test("generates a clean multi-page PDF with loaded image and off-screen Mermaid", async ({
  page,
  browserName
}, testInfo) => {
  test.skip(browserName !== "chromium", "Chromium provides deterministic PDF bytes for inspection");

  const longBody = Array.from(
    { length: 42 },
    (_, index) =>
      `Paragraph ${index + 1}. A clean export keeps readable margins and lets the document continue naturally without clipping the application into the page.`
  ).join("\n\n");
  const markdown = `# PDF isolation proof

Only the rendered document belongs in this file.

| Check | Expected |
| --- | --- |
| Application chrome | Absent |
| Media | Ready before print |
| Long reference | https://example.test/this-is-a-deliberately-long-unbroken-reference-token-that-must-wrap-inside-the-table-cell-without-clipping |

![Export proof image](/tests/fixtures/native-preview/diagram.svg)

${longBody}

![Off-screen export proof image](/tests/fixtures/native-preview/diagram.svg)

## Prepared diagram

\`\`\`mermaid
flowchart LR
    A[Markdown] --> B[Prepared document]
    B --> C[Clean PDF]
\`\`\`

## Completion

END OF PDF ISOLATION PROOF
`;

  await page.goto("/");
  await replaceDocument(page, markdown);
  await expect(page.getByRole("img", { name: "Export proof image", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".preview-content")).toHaveCount(0);
  await page.evaluate(() => {
    const testWindow = window as Window & { __finishPdfPrint?: () => void };
    window.print = () =>
      new Promise<void>((resolve) => {
        testWindow.__finishPdfPrint = resolve;
      });
  });

  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "PDF (Print)", exact: true }).click();

  await expect(page.locator("html")).toHaveClass(/pdf-exporting/u);
  const surface = page.locator(".pdf-export-surface");
  await expect(surface).toHaveAttribute("data-pdf-export-ready", "true", { timeout: 15_000 });
  await expect(surface.locator(".mermaid-canvas svg")).toHaveCount(1);
  await expect(surface).not.toContainText("Rendering diagram…");
  const diagramViewBox = await surface.locator(".mermaid-canvas svg").getAttribute("viewBox");
  const viewBoxValues = diagramViewBox?.split(/\s+/u).map(Number) ?? [];
  expect(viewBoxValues[2]).toBeGreaterThan(100);
  expect(viewBoxValues[3]).toBeGreaterThan(20);
  await expect(surface.locator("img")).toHaveCount(2);
  await expect
    .poll(() =>
      surface
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => {
            const media = image as HTMLImageElement;
            return media.loading === "eager" && media.decoding === "sync";
          })
        )
    )
    .toBe(true);
  await expect
    .poll(() =>
      surface.locator("img").evaluateAll((images) =>
        images.every((image) => {
          const media = image as HTMLImageElement;
          return media.complete && media.naturalWidth > 0;
        })
      )
    )
    .toBe(true);

  await page.emulateMedia({ media: "print" });

  const printBoundary = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#root");
    const printSurface = document.querySelector<HTMLElement>(".pdf-export-surface");
    if (!root || !printSurface) return null;
    const surfaceStyle = getComputedStyle(printSurface);
    return {
      rootDisplay: getComputedStyle(root).display,
      surfaceDisplay: surfaceStyle.display,
      surfaceBackground: surfaceStyle.backgroundColor,
      surfaceText: printSurface.innerText,
      surfaceContained: printSurface.scrollWidth <= printSurface.clientWidth + 1,
      tablesContained: [...printSurface.querySelectorAll("table")].every(
        (table) => table.getBoundingClientRect().right <= printSurface.getBoundingClientRect().right + 1
      )
    };
  });
  expect(printBoundary).toMatchObject({
    rootDisplay: "none",
    surfaceDisplay: "block",
    surfaceBackground: "rgb(255, 255, 255)",
    surfaceContained: true,
    tablesContained: true
  });
  expect(printBoundary?.surfaceText).not.toMatch(/LIBRARY|OUTLINE|COMMAND|INSERT|utf-8/u);

  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" }
  });
  await writeFile(testInfo.outputPath("clean-export.pdf"), pdfBuffer);

  const extracted = await extractPdfText(new Uint8Array(pdfBuffer));
  expect(extracted.pages).toBeGreaterThanOrEqual(3);
  expect(extracted.text).toContain("PDF isolation proof");
  expect(extracted.text).toContain("Paragraph 42");
  expect(extracted.text).toContain("Markdown");
  expect(extracted.text).toContain("Prepared document");
  expect(extracted.text).toContain("Clean PDF");
  expect(extracted.text).toContain("END OF PDF ISOLATION PROOF");
  expect(extracted.text).not.toContain("Rendering diagram");
  expect(extracted.text).not.toMatch(/\b(?:LIBRARY|OUTLINE|COMMAND|INSERT|utf-8)\b/u);

  await page.evaluate(() => {
    (window as Window & { __finishPdfPrint?: () => void }).__finishPdfPrint?.();
  });
  await expect(page.locator("html")).not.toHaveClass(/pdf-exporting/u);
  await expect(page.locator(".pdf-export-surface")).toHaveCount(0);
});
