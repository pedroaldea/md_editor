import { expect, test, type Locator, type Page } from "@playwright/test";

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const expectFocusInside = async (container: Locator, page: Page): Promise<void> => {
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "none")).not.toBe("BODY");
  await expect.poll(() => container.evaluate((element) => element.contains(document.activeElement))).toBe(true);
};

const expectVisibleFocusRing = async (control: Locator): Promise<void> => {
  await control.focus();
  await expect(control).toBeFocused();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          style: style.outlineStyle,
          width: Number.parseFloat(style.outlineWidth)
        };
      })
    )
    .toEqual({ style: "solid", width: 2 });
};

test("treats the mobile navigation as a keyboard-contained dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Folder" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expectFocusInside(dialog, page);

  const focusable = dialog.locator(focusableSelector);
  const first = focusable.first();
  const last = focusable.last();

  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keeps reader controls in More visibly keyboard-focused", async ({ page }) => {
  await page.goto("/");
  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Bionic" }).click();
  await page.locator(".comfort-settings > summary").click();

  await expectVisibleFocusRing(page.getByLabel("Min word"));
  await expectVisibleFocusRing(page.getByLabel("Weight"));
});

test("does not nest interactive controls", async ({ page }) => {
  await page.goto("/");

  const invalidNesting = [
    "button button",
    "button a[href]",
    "button input",
    "button select",
    "button textarea",
    "a[href] button",
    "a[href] a[href]",
    "a[href] input",
    "a[href] select",
    "a[href] textarea",
    "summary button",
    "summary a[href]",
    "summary input",
    "summary select",
    "summary textarea"
  ].join(", ");

  await expect(page.locator(invalidNesting)).toHaveCount(0);
});

test("collapses interface motion when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const durations = await page.evaluate(() => {
    const style = window.getComputedStyle(document.documentElement);
    return ["--duration-fast", "--duration-base", "--duration-slow"].map((token) =>
      Number.parseFloat(style.getPropertyValue(token))
    );
  });

  expect(durations).toEqual([1, 1, 1]);
});

test("contains export modal focus and restores it to the invoking control", async ({ page }) => {
  await page.goto("/");
  await page.locator(".top-more > summary").click();
  const trigger = page.getByRole("button", { name: "Export", exact: true });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Export options" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Clean Markdown (.md)" })).toBeFocused();

  const focusable = dialog.locator(focusableSelector);
  await focusable.last().focus();
  await page.keyboard.press("Tab");
  await expect(focusable.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("exposes command-palette selection and restores focus on Escape", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Search commands" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Command palette" });
  const input = dialog.getByRole("combobox", { name: "Command palette query" });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-controls", "command-palette-options");
  const initialActive = await input.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => input.getAttribute("aria-activedescendant")).not.toBe(initialActive);
  await expect(dialog.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("exposes slash command state on the focused CodeMirror editor", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.type("/");

  const listbox = page.getByRole("listbox", { name: "Slash commands" });
  await expect(listbox).toBeVisible();
  await expect(editor).toHaveAttribute("aria-expanded", "true");
  await expect(editor).toHaveAttribute("aria-controls", await listbox.getAttribute("id") ?? "");
  const firstActive = await editor.getAttribute("aria-activedescendant");

  await page.keyboard.press("ArrowDown");
  await expect.poll(() => editor.getAttribute("aria-activedescendant")).not.toBe(firstActive);
  await expect(editor).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(editor).toHaveAttribute("aria-expanded", "false");
  await expect(editor).not.toHaveAttribute("aria-controls", /.+/u);
});

test("resizes the split view with an accessible keyboard separator", async ({ page }) => {
  await page.goto("/");
  const separator = page.getByRole("separator", { name: "Resize panes" });
  await expect(separator).toHaveAttribute("aria-valuemin", "25");
  await expect(separator).toHaveAttribute("aria-valuemax", "75");
  const initial = Number(await separator.getAttribute("aria-valuenow"));

  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(initial + 2));
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "75");
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "25");
});

for (const width of [320, 430]) {
  test(`keeps navigation and content inside the exact ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <= window.innerWidth &&
            document.body.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true);
  });
}
