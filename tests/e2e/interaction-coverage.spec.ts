import { expect, test, type Page } from "@playwright/test";

const focusEditor = async (page: Page): Promise<void> => {
  await page.locator(".cm-content").click();
};

const readEditorPalette = async (page: Page): Promise<{
  colorScheme: string;
  background: string;
  color: string;
}> =>
  page.locator(".cm-editor").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      colorScheme: style.colorScheme,
      background: style.backgroundColor,
      color: style.color
    };
  });

test("persists light theme through reload and keeps CodeMirror light", async ({ page }) => {
  await page.goto("/");

  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Theme: dark" }).click();

  await expect(shell).toHaveAttribute("data-theme", "light");
  await expect.poll(() => readEditorPalette(page)).toEqual({
    colorScheme: "light",
    background: "rgb(240, 242, 239)",
    color: "rgb(23, 26, 26)"
  });
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("md-editor.theme-mode")))
    .toBe("light");

  await page.reload();

  await expect(shell).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Theme: light" })).toBeVisible();
  await expect.poll(() => readEditorPalette(page)).toEqual({
    colorScheme: "light",
    background: "rgb(240, 242, 239)",
    color: "rgb(23, 26, 26)"
  });
});

test("moves through slash commands with ArrowDown and applies with Enter", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.insertText("/");

  const menu = page.getByRole("listbox", { name: "Slash commands" });
  await expect(menu).toBeVisible();
  await expect(menu.locator("#slash-command-title")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("#slash-command-bullet-list")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Keyboard item");

  await expect(menu).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("- Keyboard item");
  await expect(page.locator(".preview-pane li")).toHaveText("Keyboard item");
});

test("inserts images from slash and exposes searchable advanced blocks", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.insertText("/img");

  const menu = page.getByRole("listbox", { name: "Slash commands" });
  await expect(menu.getByRole("option", { name: "Image", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("![Alt text](image.png)");

  await page.keyboard.insertText("\n/remote");
  await expect(menu.getByRole("option", { name: "Remote image", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("![Alt text](https://)");
  await page.keyboard.press("End");

  await page.keyboard.insertText("\n/warn");
  await expect(menu.getByRole("option", { name: /Warning/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Check access");
  await expect(page.locator(".cm-content")).toContainText("> [!WARNING]");
  const warning = page.locator(".preview-content .callout-warning");
  await expect(warning).toContainText("Warning");
  await expect(warning).toContainText("Check access");
  await expect(warning).not.toContainText("[!WARNING]");

  await page.keyboard.insertText("\n\n/tip");
  await expect(menu.getByRole("option", { name: /^Tip/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Use this path");
  const tip = page.locator(".preview-content .callout-tip");
  await expect(tip).toContainText("Tip");
  await expect(tip).toContainText("Use this path");
  await expect(tip).not.toContainText("[!TIP]");
  await expect(menu).toBeHidden();
});

test("edits a Markdown table through the contextual mini toolbar", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("| A | B |\n| --- | --- |\n| one | two |");

  const toolbar = page.getByRole("toolbar", { name: "Table editing tools" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "+ row" }).click();
  await expect(page.locator(".cm-line")).toHaveCount(4);

  await toolbar.getByRole("button", { name: "+ col" }).click();
  await expect(page.locator(".cm-line").first()).toContainText("Column 3");
  await toolbar.getByRole("button", { name: /align/i }).click();
  await expect(toolbar.getByRole("button", { name: /align L/i })).toBeVisible();
  await toolbar.getByRole("button", { name: "− col" }).click();
  await toolbar.getByRole("button", { name: "− row" }).click();
  await expect(page.locator(".cm-line")).toHaveCount(3);
  await expect(page.locator(".preview-pane table")).toBeVisible();
});

test("opens the export UI and completes the browser PDF print flow", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __mdEditorPrintCalls?: number };
    testWindow.__mdEditorPrintCalls = 0;
    window.print = () => {
      testWindow.__mdEditorPrintCalls = (testWindow.__mdEditorPrintCalls ?? 0) + 1;
    };
  });
  await page.goto("/");

  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Export", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Export options" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Clean Markdown (.md)", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "HTML (.html)", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "PDF (Print)", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __mdEditorPrintCalls?: number }).__mdEditorPrintCalls ?? 0
      )
    )
    .toBe(1);
  await expect(page.locator(".top-status")).toContainText(
    "Opened print dialog. Choose Save as PDF."
  );
  await expect(page.locator("html")).not.toHaveClass(/pdf-exporting/u);
});

test.describe("mobile touch interactions", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("opens More by touch and operates Quick Read", async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").tap();
    await page.keyboard.insertText("One two three four five six seven eight nine ten");

    await page.locator(".top-more > summary").tap();
    const quickReadAction = page.getByRole("button", { name: "Quick read" });
    await expect(quickReadAction).toBeVisible();
    await quickReadAction.tap();

    const dialog = page.getByRole("dialog", { name: "Untitled.md" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".quick-read-word")).toHaveAttribute("aria-label", "One");
    await dialog.getByRole("button", { name: "Play reading" }).tap();
    await expect(dialog.getByRole("button", { name: "Pause reading" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close quick reader" }).tap();
    await expect(dialog).toBeHidden();
  });

  test("renders the slash menu as a bottom sheet and applies a command by tap", async ({ page }) => {
    await page.goto("/");
    await page.locator(".cm-content").tap();
    await page.keyboard.insertText("/");

    const menu = page.getByRole("listbox", { name: "Slash commands" });
    await expect(menu).toBeVisible();
    await expect
      .poll(() =>
        menu.evaluate((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            position: style.position,
            bottomGap: Math.round(window.innerHeight - rect.bottom),
            left: Math.round(rect.left),
            rightGap: Math.round(window.innerWidth - rect.right)
          };
        })
      )
      .toEqual({ position: "fixed", bottomGap: 8, left: 8, rightGap: 8 });

    await menu.locator("#slash-command-title").tap();
    await page.keyboard.insertText("Mobile title");

    await expect(menu).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText("# Mobile title");
    await expect(page.locator(".preview-pane h1")).toHaveText("Mobile title");
  });

  test("keeps every table action reachable in the mobile mini toolbar", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".cm-content");
    await editor.tap();
    await page.keyboard.insertText("| A | B |\n| --- | --- |\n| one | two |");

    const toolbar = page.getByRole("toolbar", { name: "Table editing tools" });
    await expect(toolbar).toBeVisible();
    await expect.poll(() => toolbar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const actions = Array.from(element.querySelectorAll("button")).map((button) =>
        button.getBoundingClientRect().height
      );
      return {
        position: getComputedStyle(element).position,
        left: Math.round(rect.left),
        rightGap: Math.round(window.innerWidth - rect.right),
        minimumTarget: Math.round(Math.min(...actions))
      };
    })).toEqual({ position: "fixed", left: 8, rightGap: 8, minimumTarget: 44 });

    await toolbar.getByRole("button", { name: "+ row" }).tap();
    await expect(page.locator(".cm-line")).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("keeps a long mobile document constrained when the slash sheet opens", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".cm-content");
    await editor.tap({ position: { x: 90, y: 28 } });
    await page.keyboard.insertText(`${"Long document line\n".repeat(80)}/`);

    await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const shell = document.querySelector<HTMLElement>(".app-shell");
          const bar = document.querySelector<HTMLElement>(".top-bar")?.getBoundingClientRect();
          const pane = document.querySelector<HTMLElement>(".pane-editor")?.getBoundingClientRect();
          const editorSurface = document.querySelector<HTMLElement>(".cm-editor")?.getBoundingClientRect();
          return {
            shellScroll: shell?.scrollTop ?? -1,
            topBarTop: Math.round(bar?.top ?? -1),
            editorFitsPane: Boolean(pane && editorSurface && editorSurface.height <= pane.height + 1)
          };
        })
      )
      .toEqual({ shellScroll: 0, topBarTop: 0, editorFitsPane: true });
  });
});
