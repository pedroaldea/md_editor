import { expect, test } from "@playwright/test";

test("inserts and edits a table without manually managing Markdown pipes", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("/table");
  await page.keyboard.press("Enter");

  const toolbar = page.getByRole("toolbar", { name: "Table editing tools" });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(".table-toolbar-position")).toHaveText("[1:1]");

  await page.keyboard.press("Tab");
  await expect(toolbar.locator(".table-toolbar-position")).toHaveText("[1:2]");
  await page.keyboard.press("Shift+Tab");
  await expect(toolbar.locator(".table-toolbar-position")).toHaveText("[1:1]");

  await toolbar.getByRole("button", { name: "+ row" }).click();
  await expect(page.locator(".cm-line")).toHaveCount(4);
  await toolbar.getByRole("button", { name: "+ col" }).click();
  await expect(page.locator(".cm-line").first()).toContainText("Column 3");

  await toolbar.getByRole("button", { name: /align/i }).click();
  await expect(toolbar.getByRole("button", { name: "align L" })).toBeVisible();
  await toolbar.getByRole("button", { name: "tidy" }).click();
  await expect(page.locator(".preview-pane table")).toBeVisible();

  await toolbar.getByRole("button", { name: "done" }).click();
  await expect(toolbar).toBeHidden();
  await expect(editor).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(toolbar).toBeVisible();
});

test("keeps editor popovers inside a panel while Split is resized", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const editor = page.locator(".cm-content");
  const separator = page.getByRole("separator", { name: "Resize panes" });
  const expectInsideEditor = async (selector: string): Promise<void> => {
    await expect.poll(() => page.evaluate((overlaySelector) => {
      const pane = document.querySelector<HTMLElement>(".pane-editor")?.getBoundingClientRect();
      const overlay = document.querySelector<HTMLElement>(overlaySelector)?.getBoundingClientRect();
      return Boolean(pane && overlay && overlay.left >= pane.left + 7 && overlay.right <= pane.right - 7);
    }, selector)).toBe(true);
  };

  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("/");
  await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
  await separator.focus();
  await page.keyboard.press("Home");
  await expectInsideEditor(".slash-menu");

  await editor.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("Selected text");
  await page.keyboard.press("Meta+A");
  await expect(page.getByRole("toolbar", { name: "Text annotation tools" })).toBeVisible();
  await separator.focus();
  await page.keyboard.press("Home");
  await expectInsideEditor(".selection-toolbar");

  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("| A | B |\n| --- | --- |\n| one | two |");
  await expect(page.getByRole("toolbar", { name: "Table editing tools" })).toBeVisible();
  await separator.focus();
  await page.keyboard.press("Home");
  await expectInsideEditor(".table-toolbar");
});

test("turns a vertical selection into a one-column table with its mini editor", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText("Alpha\nBeta");
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("/table");

  const menu = page.getByRole("listbox", { name: "Slash commands" });
  await expect(menu.getByRole("option", { name: /Table/i })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(editor).toContainText("| Column |");
  await expect(editor).toContainText("| Alpha |");
  await expect(editor).toContainText("| Beta |");
  const toolbar = page.getByRole("toolbar", { name: "Table editing tools" });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(".table-toolbar-position")).toHaveText("[2:1]");
  await expect(toolbar.getByRole("button", { name: "− col" })).toBeDisabled();
});

test.describe("mobile table sheet", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("keeps every table action inside the viewport with touch-sized controls", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".cm-content");
    await editor.tap();
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText("| A | B |\n| --- | --- |\n| one | two |");

    const toolbar = page.getByRole("toolbar", { name: "Table editing tools" });
    await expect(toolbar).toBeVisible();
    await expect.poll(() => toolbar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const buttons = Array.from(element.querySelectorAll("button"));
      return {
        left: Math.round(rect.left),
        right: Math.round(window.innerWidth - rect.right),
        minTarget: Math.round(Math.min(...buttons.map((button) => button.getBoundingClientRect().height))),
        pageFits: document.documentElement.scrollWidth <= window.innerWidth
      };
    })).toEqual({ left: 8, right: 8, minTarget: 44, pageFits: true });
  });
});
