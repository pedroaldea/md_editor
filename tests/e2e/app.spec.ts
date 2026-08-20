import { expect, test, type Page } from "@playwright/test";

const focusEditor = async (page: Page): Promise<void> => {
  const content = page.locator(".cm-content");
  await content.click();
};

test("renders the minimal editor shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByText("untitled.md", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("starts cleanly outside the Tauri bridge", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the reading desk inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keeps split mode useful on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".pane-editor")).toBeVisible();
  await expect(page.locator(".pane-preview")).toBeVisible();
});

test("keeps every desktop toolbar control inside the shell", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const bounds = await page.locator(".top-bar").evaluate((bar) => {
    return Array.from(bar.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return { right: rect.right, visible: rect.width > 0 && rect.height > 0 };
    }).filter((item) => item.visible);
  });

  expect(bounds.every(({ right }) => right <= 1280)).toBe(true);
});

test("opens command palette with Cmd+K", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Shortcut mapping is validated in chromium only");
  await page.goto("/");
  const isMac = await page.evaluate(() => navigator.userAgent.includes("Mac"));
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("toggles focus mode and exits with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(page.getByRole("button", { name: "Exit Focus" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const layout = document.querySelector<HTMLElement>(".editor-layout");
        const pane = document.querySelector<HTMLElement>(".editor-layout > .pane");
        if (!layout || !pane) return 0;
        return pane.getBoundingClientRect().width / layout.getBoundingClientRect().width;
      })
    )
    .toBeGreaterThan(0.98);

  const focusEditorGeometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".pane-editor")?.getBoundingClientRect();
    const gutter = document.querySelector<HTMLElement>(".cm-gutters")?.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".cm-content")?.getBoundingClientRect();
    if (!pane || !gutter || !content) throw new Error("Focus editor geometry unavailable");
    return {
      contentWidth: content.width,
      centerDelta: (gutter.left + content.right - pane.left - pane.right) / 2
    };
  });
  expect(focusEditorGeometry.contentWidth).toBeGreaterThanOrEqual(840);
  expect(Math.abs(focusEditorGeometry.centerDelta)).toBeLessThanOrEqual(5);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const focusPreviewGeometry = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".pane-preview")?.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".preview-content")?.getBoundingClientRect();
    if (!pane || !content) throw new Error("Focus preview geometry unavailable");
    return {
      contentWidth: content.width,
      centerDelta: (content.left + content.right - pane.left - pane.right) / 2
    };
  });
  expect(focusPreviewGeometry.contentWidth).toBeGreaterThanOrEqual(779);
  expect(focusPreviewGeometry.contentWidth).toBeLessThanOrEqual(781);
  expect(Math.abs(focusPreviewGeometry.centerDelta)).toBeLessThanOrEqual(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("banner")).toBeVisible();
});

test("keeps the single focus surface full-height on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Focus" }).click();

  const ratio = await page.evaluate(() => {
    const layout = document.querySelector<HTMLElement>(".editor-layout");
    const pane = document.querySelector<HTMLElement>(".editor-layout > .pane");
    if (!layout || !pane) return { width: 0, height: 0 };
    const layoutRect = layout.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    return {
      width: paneRect.width / layoutRect.width,
      height: paneRect.height / layoutRect.height
    };
  });

  expect(ratio.width).toBeGreaterThan(0.98);
  expect(ratio.height).toBeGreaterThan(0.98);
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

test("renders lightweight highlight and underline marks", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.insertText("==highlight this== and ++underline this++");

  await expect(page.locator(".preview-pane mark.inline-highlight")).toHaveText("highlight this");
  await expect(page.locator(".preview-pane u.inline-underline")).toHaveText("underline this");
});

test("offers contextual annotation actions for a text selection", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.insertText("Annotate me");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");

  const toolbar = page.getByRole("toolbar", { name: "Text annotation tools" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Highlight selection" }).click();

  await expect(page.locator(".cm-content")).toContainText("==Annotate me==");
  await expect(page.locator(".preview-pane mark.inline-highlight")).toHaveText("Annotate me");
});

test("jumps to headings while the editor is hidden in read mode", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  const document = [
    "# First heading",
    ...Array.from({ length: 20 }, (_, index) => `A long reading paragraph ${index + 1}.`),
    "# Second heading",
    "The destination paragraph."
  ].join("\n\n");
  await page.keyboard.insertText(document);
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const preview = page.locator(".preview-pane");
  await expect(page.locator(".pane-editor")).toBeHidden();
  await page.getByRole("button", { name: /Search/ }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command palette query" }).fill("Second heading");
  await palette.getByRole("option", { name: /Second heading/ }).click();
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("opens quick read and supports keyboard stepping", async ({ page }) => {
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.insertText("One two three");

  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Quick read" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".quick-read-word")).toHaveText("One");

  await page.keyboard.press("ArrowRight");
  await expect(dialog.locator(".quick-read-word")).toHaveText("two");
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("button", { name: "Pause reading" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
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
