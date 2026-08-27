import { expect, test, type Page } from "@playwright/test";

const focusEditor = async (page: Page): Promise<void> => {
  await page.locator(".cm-content").click();
};

const readColorScheme = async (page: Page): Promise<string> =>
  page.evaluate(() => {
    const themeSurface = document.querySelector<HTMLElement>(".app-shell") ?? document.documentElement;
    return getComputedStyle(themeSurface).colorScheme.trim();
  });

test.describe("ASCII minimalist redesign", () => {
  test("exposes the desktop rail and keeps every control inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    for (const label of ["Library", "Outline", "Command"]) {
      await expect(page.getByText(new RegExp(`^${label}$`, "i")).first()).toBeVisible();
    }

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

  test("cycles between effective dark and light themes", async ({ page }) => {
    await page.goto("/");

    const themeToggle = page
      .getByRole("button", { name: /\b(?:theme|dark|light|appearance|modo)\b/i })
      .first();
    await expect(themeToggle).toBeVisible();

    const initialScheme = await readColorScheme(page);
    expect(["dark", "light"]).toContain(initialScheme);

    await themeToggle.click();
    await expect.poll(() => readColorScheme(page)).not.toBe(initialScheme);

    const toggledScheme = await readColorScheme(page);
    expect(new Set([initialScheme, toggledScheme])).toEqual(new Set(["dark", "light"]));

    await themeToggle.click();
    await expect.poll(() => readColorScheme(page)).toBe(initialScheme);
  });

  test("switches cleanly between edit, split and read surfaces", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".pane-editor")).toBeVisible();
    await expect(page.locator(".pane-preview")).toBeHidden();

    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect(page.locator(".pane-editor")).toBeVisible();
    await expect(page.locator(".pane-preview")).toBeVisible();

    await page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(page.locator(".pane-editor")).toBeHidden();
    await expect(page.locator(".pane-preview")).toBeVisible();
  });

  test("centers a wide writing desk in Edit without stretching Split", async ({ page }) => {
    await page.setViewportSize({ width: 1144, height: 768 });
    await page.goto("/");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".cm-content")).toBeVisible();

    const editGeometry = await page.locator(".editor-layout").evaluate((layout) => {
      const layoutRect = layout.getBoundingClientRect();
      const gutterRect = layout.querySelector<HTMLElement>(".cm-gutters")?.getBoundingClientRect();
      const contentRect = layout.querySelector<HTMLElement>(".cm-content")?.getBoundingClientRect();
      if (!gutterRect || !contentRect) throw new Error("Editor geometry is unavailable");
      return {
        contentWidth: Math.round(contentRect.width),
        leftGap: Math.round(gutterRect.left - layoutRect.left),
        rightGap: Math.round(layoutRect.right - contentRect.right),
        pageFits: document.documentElement.scrollWidth <= window.innerWidth
      };
    });

    expect(editGeometry.contentWidth).toBeGreaterThanOrEqual(840);
    expect(Math.abs(editGeometry.leftGap - editGeometry.rightGap)).toBeLessThanOrEqual(4);
    expect(editGeometry.pageFits).toBe(true);

    await page.getByRole("button", { name: "Split", exact: true }).click();
    const splitContentWidth = await page.locator(".cm-content").evaluate((content) =>
      Math.round(content.getBoundingClientRect().width)
    );
    expect(splitContentWidth).toBeLessThan(editGeometry.contentWidth);
  });

  test("keeps both Split surfaces centered from 25:75 through 75:25", async ({ page }) => {
    const readGeometry = () => page.evaluate(() => {
      const layout = document.querySelector<HTMLElement>(".editor-layout")?.getBoundingClientRect();
      const editorPane = document.querySelector<HTMLElement>(".pane-editor")?.getBoundingClientRect();
      const previewPane = document.querySelector<HTMLElement>(".pane-preview")?.getBoundingClientRect();
      const divider = document.querySelector<HTMLElement>(".pane-divider")?.getBoundingClientRect();
      const gutter = document.querySelector<HTMLElement>(".cm-gutters")?.getBoundingClientRect();
      const content = document.querySelector<HTMLElement>(".cm-content")?.getBoundingClientRect();
      const previewContent = document.querySelector<HTMLElement>(".preview-content")?.getBoundingClientRect();
      if (!layout || !editorPane || !previewPane || !divider || !gutter || !content || !previewContent) {
        throw new Error("Split geometry is unavailable");
      }
      const editorCenter = (gutter.left + content.right) / 2;
      const previewCenter = (previewContent.left + previewContent.right) / 2;
      return {
        layout: { left: layout.left, width: layout.width },
        dividerWidth: divider.width,
        editorWidth: editorPane.width,
        previewWidth: previewPane.width,
        editorCenterDelta: editorCenter - (editorPane.left + editorPane.right) / 2,
        previewCenterDelta: previewCenter - (previewPane.left + previewPane.right) / 2,
        editorInside: gutter.left >= editorPane.left - 1 && content.right <= editorPane.right + 1,
        previewInside: previewContent.left >= previewPane.left - 1 && previewContent.right <= previewPane.right + 1,
        pageFits: document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth
      };
    });

    for (const viewport of [
      { width: 1144, height: 768 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.getByRole("button", { name: "Split", exact: true }).click();
      const separator = page.getByRole("separator", { name: "Resize panes" });
      await separator.focus();

      const ratios = [25, 50, 75];
      await page.keyboard.press("Home");
      for (const ratio of ratios) {
        if (ratio === 50) {
          for (let step = 0; step < 5; step += 1) await page.keyboard.press("Shift+ArrowRight");
        } else if (ratio === 75) {
          await page.keyboard.press("End");
        }
        await expect(separator).toHaveAttribute("aria-valuenow", String(ratio));
        const geometry = await readGeometry();
        const usableWidth = geometry.layout.width - geometry.dividerWidth;
        expect(Math.abs(geometry.editorWidth - usableWidth * ratio / 100)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.previewWidth - usableWidth * (100 - ratio) / 100)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.editorCenterDelta)).toBeLessThanOrEqual(5);
        expect(Math.abs(geometry.previewCenterDelta)).toBeLessThanOrEqual(2);
        expect(geometry.editorInside).toBe(true);
        expect(geometry.previewInside).toBe(true);
        expect(geometry.pageFits).toBe(true);
      }
    }

    const separator = page.getByRole("separator", { name: "Resize panes" });
    const separatorBox = await separator.boundingBox();
    const layoutGeometry = await readGeometry();
    if (!separatorBox) throw new Error("Separator geometry is unavailable");
    const targetX = layoutGeometry.layout.left + layoutGeometry.dividerWidth / 2
      + (layoutGeometry.layout.width - layoutGeometry.dividerWidth) * 0.5;
    const pointerY = separatorBox.y + separatorBox.height / 2;
    await page.mouse.move(separatorBox.x + separatorBox.width / 2, pointerY);
    await page.mouse.down();
    await expect(page.locator(".app-shell")).toHaveClass(/is-resizing/u);
    await page.mouse.move(targetX, pointerY, { steps: 8 });
    await page.mouse.up();
    await expect(separator).toHaveAttribute("aria-valuenow", "50");
    await expect(page.locator(".app-shell")).not.toHaveClass(/is-resizing/u);
    await page.mouse.move(targetX + 180, pointerY);
    await expect(separator).toHaveAttribute("aria-valuenow", "50");
  });

  test("opens the complete formatting menu when slash is typed", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1487, height: 1058 });
    await page.goto("/");
    await focusEditor(page);
    await page.keyboard.insertText(
      "# Field notes\n\nA quiet place to read, think and mark what matters.\n\n## Today\n\n- Review the brief\n- Highlight the decision\n- Return to the source\n\n### Context\n\nGood notes are specific and traceable. They capture decisions, link to evidence, and remain useful over time. The goal is not to write more, but to think more clearly.\n\n> Clarity is the precondition for insight.\n\n### References\n\n- [Project Brief](docs/brief.pdf#page=2)\n- [Source Report](docs/report.pdf#page=14)\n\n---\n\n*Last updated: 2024-05-14*\n\n/"
    );

    const menu = page.getByRole("listbox", { name: "Slash commands" });
    await expect(menu).toBeVisible();

    const options = menu.getByRole("option");
    for (const label of [
      "Heading",
      "List",
      "Checklist",
      "Quote",
      "Code",
      "Diagram",
      "Table",
      "Image",
      "Callout",
      "Divider",
      "Highlight",
      "Underline"
    ]) {
      const option = options.filter({ hasText: new RegExp(`\\b${label}\\b`, "i") }).first();
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeVisible();
    }

    await page.screenshot({
      path: `/private/tmp/md-editor-design-qa-${testInfo.repeatEachIndex}.png`,
      animations: "disabled"
    });
  });

  test("keeps the editor, reading surface and core controls accessible on a narrow viewport", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const edit = page.getByRole("button", { name: "Edit", exact: true });
    const read = page.getByRole("button", { name: "Read", exact: true });
    await expect(edit).toBeVisible();
    await expect(read).toBeVisible();

    await edit.click();
    await expect(page.locator(".pane-editor")).toBeVisible();

    await read.click();
    await expect(page.locator(".pane-preview")).toBeVisible();

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
});
