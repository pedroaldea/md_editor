import { expect, test, type Page } from "@playwright/test";

const resetReaderPreferences = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("read-controls-test-ready")) {
      window.localStorage.removeItem("md-editor.reader-preferences");
      window.sessionStorage.setItem("read-controls-test-ready", "true");
    }
  });
};

test("changes and persists the real Read font size and centered column width", async ({ page }) => {
  await resetReaderPreferences(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("# Reading scale\n\nA calm line that proves the reading controls affect the rendered document.");
  await page.getByRole("button", { name: "Read", exact: true }).click();

  const content = page.locator(".preview-content");
  const heading = content.getByRole("heading", { level: 1 });
  const textOutput = page.getByRole("status", { name: "Reading text size" });
  const widthOutput = page.getByRole("status", { name: "Reading canvas width" });
  await expect(textOutput).toHaveText("18px");
  await expect(widthOutput).toHaveText("960px");

  const before = await content.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
  }));
  const headingBefore = Number.parseFloat(await heading.evaluate((element) => getComputedStyle(element).fontSize));

  const increaseText = page.getByRole("button", { name: "Increase reading text size" });
  await increaseText.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Widen reading column" }).click();
  await page.getByRole("button", { name: "Widen reading column" }).click();

  await expect(textOutput).toHaveText("20px");
  await expect(widthOutput).toHaveText("1120px");
  const after = await content.evaluate((element) => {
    const pane = element.closest<HTMLElement>(".pane-preview")?.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    if (!pane) throw new Error("Read pane geometry unavailable");
    return {
      width: bounds.width,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      leftGap: bounds.left - pane.left,
      rightGap: pane.right - bounds.right
    };
  });

  expect(after.fontSize).toBe(20);
  expect(after.fontSize).toBeGreaterThan(before.fontSize);
  await expect.poll(() => heading.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(headingBefore);
  expect(after.width).toBeCloseTo(1120, 0);
  expect(after.width).toBeGreaterThan(before.width);
  expect(Math.abs(after.leftGap - after.rightGap)).toBeLessThanOrEqual(2);

  await page.reload();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByRole("status", { name: "Reading text size" })).toHaveText("20px");
  await expect(page.getByRole("status", { name: "Reading canvas width" })).toHaveText("1120px");
  await expect.poll(() => content.evaluate((element) => getComputedStyle(element).fontSize)).toBe("20px");
  await expect.poll(() => content.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(1120);
});

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 390, height: 844 }
]) {
  test(`keeps Read controls operable and the 1280px preference fluid at ${viewport.width}px`, async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("md-editor.reader-preferences", JSON.stringify({
        fontSize: 22,
        contentWidth: 1280
      }));
    });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Read", exact: true }).click();

    const increaseText = page.getByRole("button", { name: "Increase reading text size" });
    await expect(increaseText).toBeVisible();
    await increaseText.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status", { name: "Reading text size" })).toHaveText("23px");
    await expect(page.getByRole("status", { name: "Reading canvas width" })).toHaveText("1280px");
    await expect.poll(() => page.locator(".preview-content").evaluate((element) => getComputedStyle(element).fontSize)).toBe("23px");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await page.locator(".preview-content").boundingBox();
    expect(bounds).not.toBeNull();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  });
}

for (const width of [1200, 1280, 1299]) {
  test(`keeps every Read appearance control visible at the ${width}px desktop boundary`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(page.getByRole("button", { name: "Search commands" })).toBeVisible();
    await expect(page.locator(".top-more > summary")).toBeVisible();

    const geometry = await page.getByRole("group", { name: "Reading appearance" }).evaluate(
      (controls) => {
        const switcher = controls.closest<HTMLElement>(".view-switcher");
        if (!switcher) throw new Error("View switcher unavailable");
        const container = switcher.getBoundingClientRect();
        const items = Array.from(controls.querySelectorAll<HTMLElement>("button, output"));
        return {
          scrollWidth: switcher.scrollWidth,
          clientWidth: switcher.clientWidth,
          allInside: items.every((item) => {
            const bounds = item.getBoundingClientRect();
            return bounds.left >= container.left - 1 && bounds.right <= container.right + 1;
          })
        };
      }
    );

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.allInside).toBe(true);
  });
}
