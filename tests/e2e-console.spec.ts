import { test, expect } from "@playwright/test";

test.describe("MugshotAI Console E2E Flow", () => {
  test("renders all 4 stations and masthead without errors", async ({ page }) => {
    await page.goto("/?gate=0");

    // Verify Title & Header
    await expect(page).toHaveTitle(/MugshotAI/i);
    const heading = page.locator("h1");
    await expect(heading).toContainText("MugshotAI");

    // Verify 4 station headings are present
    await expect(page.getByRole("heading", { name: "Specimen" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Trace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Adjudication" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Seal" })).toBeVisible();

    // Verify Specimen buttons exist
    await expect(page.getByRole("button", { name: /start camera/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /upload photo/i })).toBeVisible();
  });
});
