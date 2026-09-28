import { expect, test as setup } from "@playwright/test";

/** Signs in to the demo account once and saves the session for the other projects. */
setup("sign in to the demo account", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@healthmate.example");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.context().storageState({ path: "e2e/.auth/demo.json" });
});
