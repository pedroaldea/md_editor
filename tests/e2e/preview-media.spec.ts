import { expect, test, type Page } from "@playwright/test";

const replaceDocument = async (page: Page, markdown: string): Promise<void> => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(markdown);
};

test("renders Mermaid diagrams on demand and redraws them for the active theme", async ({ page }) => {
  await page.goto("/");
  await replaceDocument(
    page,
    "# Controlled diagram\n\n```mermaid\nflowchart LR\n    A[Start] --> B[Verified]\n```"
  );
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const diagram = page.locator(".mermaid-diagram");
  const canvas = diagram.locator(".mermaid-canvas");
  await expect(diagram).toBeVisible();
  await expect(canvas.locator("svg")).toBeVisible({ timeout: 10_000 });
  await expect(diagram.locator(".mermaid-source")).toBeHidden();
  await expect(canvas).toContainText("Start");
  await page.screenshot({ path: "/private/tmp/md-editor-mermaid-read.png", animations: "disabled" });
  const firstId = await canvas.locator("svg").getAttribute("id");

  await page.getByRole("button", { name: /Theme:/i }).click();
  await expect.poll(() => canvas.locator("svg").getAttribute("id")).not.toBe(firstId);
  await expect(canvas.locator("svg")).toBeVisible();
});

test("creates a working Mermaid diagram from the slash menu", async ({ page }) => {
  await page.goto("/");
  await replaceDocument(page, "/diag");
  const menu = page.getByRole("listbox", { name: "Slash commands" });
  await expect(menu.getByRole("option", { name: /Diagram/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("flowchart LR");

  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.locator(".mermaid-canvas svg")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".mermaid-canvas")).toContainText("Next step");
});

test("renders a complex flowchart with escaped line breaks like a real document", async ({ page }) => {
  await page.goto("/");
  const longLead = Array.from(
    { length: 60 },
    (_, index) => `Paragraph ${index}: content before the off-screen diagram.`
  ).join("\n\n");
  await replaceDocument(
    page,
    `${longLead}\n\n\`\`\`mermaid\nflowchart LR\n    T[Disparador\\nperson · botón · ticket · calendario] --> H[Arnés\\nsesión + permisos + límites]\n    H --> S[Skill del proceso\\ninstrucciones y reglas]\n    S --> M[MCP / herramientas\\nERP · datos · documentos · APIs]\n    M --> V[Validaciones\\nesquema · reglas · conciliación]\n    V --> O[Salida tipada\\nresultado + incidencias + evidencia]\n    O --> A{¿Requiere revisión?}\n    A -- Sí --> P[Persona responsable]\n    A -- No --> E[Acción permitida]\n    P --> E\n    E --> L[Registro, métricas y aprendizaje]\n    L -. mejora controlada .-> S\n\`\`\``
  );
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const canvas = page.locator(".mermaid-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas.locator("svg")).toBeVisible({ timeout: 10_000 });
  await expect(canvas).toContainText("sesión + permisos + límites");
  const dottedFeedback = canvas.locator('path[data-md-dotted-feedback="true"]');
  await expect(dottedFeedback).toHaveCount(1);
  await expect.poll(() => dottedFeedback.evaluate((path) => getComputedStyle(path).strokeDasharray)).toContain("4");
  await expect(page.getByText("Rendering diagram…")).toBeHidden();
});

test("keeps an open Mermaid edge solid before dotted feedback", async ({ page }) => {
  await page.goto("/");
  await replaceDocument(
    page,
    "```mermaid\nflowchart LR\nA --- B\nB -. feedback .-> A\n```"
  );
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const paths = page.locator(".mermaid-canvas .edgePaths .flowchart-link");
  await expect(paths).toHaveCount(2, { timeout: 10_000 });
  await expect(paths.nth(0)).not.toHaveAttribute("data-md-dotted-feedback", "true");
  await expect(paths.nth(1)).toHaveAttribute("data-md-dotted-feedback", "true");
  await expect
    .poll(() => paths.nth(1).evaluate((path) => getComputedStyle(path).strokeDasharray))
    .toContain("4");
});

test("ignores link-like node labels and dots the exact Mermaid feedback edge", async ({ page }) => {
  await page.goto("/");
  await replaceDocument(
    page,
    '```mermaid\nflowchart LR\nA["---"] --> B\nB -. feedback .-> A\nB --> C\n```'
  );
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const paths = page.locator(".mermaid-canvas .edgePaths .flowchart-link");
  await expect(paths).toHaveCount(3, { timeout: 10_000 });
  await expect(paths.nth(0)).not.toHaveAttribute("data-md-dotted-feedback", "true");
  await expect(paths.nth(1)).toHaveAttribute("data-md-dotted-feedback", "true");
  await expect(paths.nth(2)).not.toHaveAttribute("data-md-dotted-feedback", "true");
  await expect
    .poll(() => paths.nth(1).evaluate((path) => getComputedStyle(path).strokeDasharray))
    .toContain("4");
});

test("shows a useful error instead of blank output for invalid Mermaid", async ({ page }) => {
  await page.goto("/");
  await replaceDocument(page, "```mermaid\nflowchart LR\nA --->\n```");
  await page.getByRole("button", { name: "Read", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("Diagram could not be rendered", {
    timeout: 10_000
  });
});

test("centers a wide editorial column in Read while keeping Split compact", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await replaceDocument(
    page,
    "# A calm reading surface\n\nThe page now uses the available window while keeping each line comfortable to read. Content is centered instead of being crushed against the left edge.\n\n## Balanced space\n\nWide media, tables and diagrams have room to breathe, while ordinary paragraphs stay within an editorial measure."
  );
  if (await page.locator(".app-shell").getAttribute("data-theme") !== "light") {
    await page.getByRole("button", { name: /Theme:/i }).click();
  }
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const readGeometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".pane-preview")?.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".preview-content")?.getBoundingClientRect();
    if (!pane || !content) throw new Error("Read geometry unavailable");
    return {
      paneWidth: pane.width,
      contentWidth: content.width,
      leftGap: content.left - pane.left,
      rightGap: pane.right - content.right
    };
  });

  expect(readGeometry.contentWidth).toBeGreaterThanOrEqual(880);
  expect(readGeometry.contentWidth).toBeLessThanOrEqual(961);
  expect(Math.abs(readGeometry.leftGap - readGeometry.rightGap)).toBeLessThanOrEqual(2);
  expect(readGeometry.contentWidth / readGeometry.paneWidth).toBeGreaterThan(0.65);
  await page.screenshot({ path: "/private/tmp/md-editor-read-wide.png", animations: "disabled" });

  await page.getByRole("button", { name: "Split", exact: true }).click();
  const splitGeometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".pane-preview")?.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".preview-content")?.getBoundingClientRect();
    if (!pane || !content) throw new Error("Split geometry unavailable");
    return {
      contentWidth: content.width,
      leftGap: content.left - pane.left,
      rightGap: pane.right - content.right
    };
  });
  expect(splitGeometry.contentWidth).toBeLessThanOrEqual(761);
  expect(Math.abs(splitGeometry.leftGap - splitGeometry.rightGap)).toBeLessThanOrEqual(2);
});

test("keeps Read and Mermaid inside a 390px mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await replaceDocument(
    page,
    "```mermaid\nflowchart TD\n    A[Mobile] --> B[No overflow]\n```"
  );
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.locator(".mermaid-canvas svg")).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = await page.locator(".preview-content").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
});
