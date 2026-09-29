import { expect, test as setup } from "@playwright/test";

/** Signs in to the Preview sample account once and saves the session for the other projects. */
setup("sign in to the sample account", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("alex.morgan@example.com");
  await page.getByLabel("Password").fill("preview-password");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.context().storageState({ path: "e2e/.auth/demo.json" });
});
