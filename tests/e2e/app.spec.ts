import { expect, test, type Page } from "@playwright/test";

const focusEditor = async (page: Page): Promise<void> => {
  const content = page.locator(".cm-content");
  await content.click();
};

test("renders Md Editor shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Md Editor" })).toBeVisible();
  await expect(page.getByText("Untitled.md")).toBeVisible();
});

test("opens command palette with Cmd+K", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Shortcut mapping is validated in chromium only");
  await page.goto("/");
  const isMac = await page.evaluate(() => navigator.userAgent.includes("Mac"));
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("toggles focus mode and exits with Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(page.getByRole("button", { name: "Exit Focus" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Focus" })).toBeVisible();
});

test("opens slash menu when slash is typed in smart context", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();
});

test("filters and applies subtitle command from slash menu", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  await page.keyboard.type("/su");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Section");

  await expect(page.locator(".cm-content")).not.toContainText("/su");
  await expect(page.locator(".preview-pane h2")).toContainText("Section");
});

test("applies code block from slash query and removes slash token", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  await page.keyboard.type("/co");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const x = 1;");

  await expect(page.locator(".cm-content")).not.toContainText("/co");
  await expect(page.locator(".preview-pane code")).toContainText("const x = 1;");
});

test("applies slash command with mouse click", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  await page.keyboard.type("/qu");
  await page.getByRole("option", { name: /Quote/i }).click();
  await page.keyboard.type("Remember this");

  await expect(page.locator(".preview-pane blockquote")).toContainText("Remember this");
});

test("closes slash menu with Escape and keeps typed slash text", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("/");
});

test("does not trigger slash menu while typing URLs", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  await page.keyboard.type("https://example.com");
  await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeHidden();
});

test("keeps app context when local preview links are clicked", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  await page.keyboard.type("[Open local](./notes.md)");
  const currentUrl = page.url();
  await page.locator(".preview-pane a").click();

  await expect.poll(() => page.url()).toBe(currentUrl);
});

test("expands preview into a printable flow for PDF export", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);

  const longDocument = [
    "# Print check",
    ...Array.from(
      { length: 60 },
      (_, index) =>
        `Paragraph ${index + 1}. This is a long print validation paragraph that should force the preview to span multiple printed pages without clipping or repeating the first screenful of content.`
    )
  ].join("\n\n");

  await page.keyboard.insertText(longDocument);
  await page.emulateMedia({ media: "print" });

  const printLayout = await page.evaluate(() => {
    document.documentElement.classList.add("pdf-exporting");

    const editor = document.querySelector<HTMLElement>(".pane-editor");
    const preview = document.querySelector<HTMLElement>(".preview-pane");
    const previewPane = document.querySelector<HTMLElement>(".pane-preview");
    const workspace = document.querySelector<HTMLElement>(".workspace-shell");

    if (!editor || !preview || !previewPane || !workspace) {
      return null;
    }

    const editorStyle = getComputedStyle(editor);
    const previewStyle = getComputedStyle(preview);
    const paneStyle = getComputedStyle(previewPane);
    const workspaceStyle = getComputedStyle(workspace);

    return {
      editorDisplay: editorStyle.display,
      previewOverflow: previewStyle.overflow,
      previewMaxHeight: previewStyle.maxHeight,
      paneOverflow: paneStyle.overflow,
      workspaceDisplay: workspaceStyle.display
    };
  });

  expect(printLayout).toEqual({
    editorDisplay: "none",
    previewOverflow: "visible",
    previewMaxHeight: "none",
    paneOverflow: "visible",
    workspaceDisplay: "block"
  });
});
