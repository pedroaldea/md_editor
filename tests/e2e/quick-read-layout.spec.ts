import { expect, test, type Locator, type Page } from "@playwright/test";

const WORDS = ["the", "fuentes", "cooperación", "2026-2027", "extraordinariamente"];

const focusEditor = async (page: Page): Promise<void> => {
  await page.locator(".cm-content").click();
};

const expectSafeWordGeometry = async (word: Locator): Promise<void> => {
  const geometry = await word.evaluate((element) => {
    const stage = element.closest<HTMLElement>(".quick-read-stage");
    const segments = Array.from(element.querySelectorAll<HTMLElement>("span"));
    if (!stage || segments.length !== 3) {
      throw new Error("Quick Read geometry is unavailable");
    }

    const textBounds = segments.map((segment) => {
      const range = document.createRange();
      range.selectNodeContents(segment);
      const bounds = range.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    });
    const elementBounds = segments.map((segment) => {
      const bounds = segment.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width };
    });
    const stageBounds = stage.getBoundingClientRect();
    const focusBounds = textBounds[1];
    const visibleBounds = textBounds.filter(({ right, left }) => right > left);

    return {
      word: element.getAttribute("aria-label"),
      segments: segments.map((segment) => segment.textContent ?? ""),
      textBounds,
      elementBounds,
      focusDelta:
        (focusBounds.left + focusBounds.right) / 2 -
        (stageBounds.left + stageBounds.right) / 2,
      insideStage:
        Math.min(...visibleBounds.map(({ left }) => left)) >= stageBounds.left - 1 &&
        Math.max(...visibleBounds.map(({ right }) => right)) <= stageBounds.right + 1,
      noHorizontalScroll: stage.scrollWidth <= stage.clientWidth,
      prefixFocusOverlap:
        textBounds[0].right <= textBounds[0].left
          ? 0
          : Math.max(0, textBounds[0].right - focusBounds.left),
      focusRestOverlap:
        textBounds[2].right <= textBounds[2].left
          ? 0
          : Math.max(0, focusBounds.right - textBounds[2].left)
    };
  });

  expect(Math.abs(geometry.focusDelta), JSON.stringify(geometry)).toBeLessThanOrEqual(0.75);
  expect(geometry.insideStage).toBe(true);
  expect(geometry.noHorizontalScroll).toBe(true);
  expect(geometry.prefixFocusOverlap, JSON.stringify(geometry)).toBeLessThanOrEqual(1);
  expect(geometry.focusRestOverlap, JSON.stringify(geometry)).toBeLessThanOrEqual(1);
};

test("keeps RSVP segments separate and the focus centred from 70% through 150%", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await focusEditor(page);
  await page.keyboard.insertText(WORDS.join(" "));

  await page.locator(".top-more > summary").click();
  await page.getByRole("button", { name: "Quick read" }).click();

  const dialog = page.getByRole("dialog");
  const word = dialog.locator(".quick-read-word");
  const decrease = dialog.getByRole("button", { name: "Decrease Quick Read text size" });
  const increase = dialog.getByRole("button", { name: "Increase Quick Read text size" });
  const scaleOutput = dialog.locator(".quick-read-text-size output");

  for (let index = 0; index < 3; index += 1) {
    await decrease.click();
  }

  for (let scale = 70; scale <= 150; scale += 10) {
    await expect(scaleOutput).toHaveText(`${scale}%`);
    await dialog.getByRole("button", { name: "Restart reading" }).click();

    for (let wordIndex = 0; wordIndex < WORDS.length; wordIndex += 1) {
      await expect(word).toHaveAttribute("aria-label", WORDS[wordIndex]);
      await expectSafeWordGeometry(word);
      if (wordIndex < WORDS.length - 1) {
        await dialog.focus();
        await page.keyboard.press("ArrowRight");
      }
    }

    if (scale < 150) {
      await increase.click();
    }
  }
});
