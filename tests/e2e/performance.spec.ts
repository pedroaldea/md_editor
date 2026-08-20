import { expect, test } from "@playwright/test";

test("keeps the initial shell and core transitions frame-bounded", async ({ page }) => {
  await page.goto("/");

  const metrics = await page.evaluate(async () => {
    const nextPaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

    const findButton = (label: string): HTMLButtonElement => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
        candidate.textContent?.toLowerCase().includes(label.toLowerCase())
      );
      if (!button) throw new Error(`Missing button: ${label}`);
      return button;
    };

    const transitionMs: number[] = [];
    for (const label of ["theme:", "theme:", "edit", "split", "read", "split"]) {
      const started = performance.now();
      findButton(label).click();
      await nextPaint();
      transitionMs.push(performance.now() - started);
    }

    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const firstPaint = performance.getEntriesByName("first-contentful-paint")[0];

    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
      firstContentfulPaintMs: firstPaint?.startTime ?? 0,
      transitionMs
    };
  });

  expect(metrics.domContentLoadedMs).toBeLessThan(2_000);
  if (metrics.firstContentfulPaintMs > 0) {
    expect(metrics.firstContentfulPaintMs).toBeLessThan(2_000);
  }
  expect(Math.max(...metrics.transitionMs)).toBeLessThan(200);
});

test("keeps typing responsive while a large preview is waiting to render", async ({ page }) => {
  await page.goto("/");
  await page.locator(".cm-content").click();

  const largeDocument = Array.from(
    { length: 650 },
    (_, index) =>
      `Paragraph ${index + 1}. A compact but deliberately repeated sentence exercises deferred preview work without turning the browser driver itself into the benchmark.`
  ).join("\n\n");

  const bulkStarted = performance.now();
  await page.keyboard.insertText(largeDocument);
  const bulkInputMs = performance.now() - bulkStarted;

  const keyStarted = performance.now();
  await page.keyboard.insertText("\n\nResponsive tail");
  const followupInputMs = performance.now() - keyStarted;

  // Bulk insertion includes the browser driver's transfer and CodeMirror document creation.
  // The follow-up key is the user-facing latency guard once that large document is mounted.
  expect(bulkInputMs).toBeLessThan(2_500);
  expect(followupInputMs).toBeLessThan(250);
  await expect(page.locator(".preview-pane")).toContainText("Responsive tail", { timeout: 10_000 });
});
