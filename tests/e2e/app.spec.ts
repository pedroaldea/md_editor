import { expect, test } from "@playwright/test";

test("renders Md Editor shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Md Editor" })).toBeVisible();
  await expect(page.getByText("Untitled.md")).toBeVisible();
});

test("opens command palette with Cmd+K", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Shortcut mapping is validated in chromium only");
  await page.goto("/");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("toggles focus mode and exits with Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(page.getByRole("button", { name: "Exit Focus" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Focus" })).toBeVisible();
});
