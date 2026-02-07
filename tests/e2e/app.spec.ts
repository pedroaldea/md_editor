import { expect, test } from "@playwright/test";

test("renders Md Editor shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Md Editor" })).toBeVisible();
  await expect(page.getByText("Untitled.md")).toBeVisible();
});
