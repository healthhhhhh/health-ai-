import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

async function expectNoA11yViolations(page: Page, path: string) {
  // Axe measures colours at a single instant; freeze entrance animations so it sees final styles.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("welcome introduces HealthMate and leads to account creation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "HealthMate" })).toBeVisible();
    await page.getByRole("link", { name: "Get Started" }).click();
    await expect(page).toHaveURL(/\/sign-in\?mode=sign-up/);
    await expect(page.getByRole("button", { name: "Create Account", exact: true })).toBeVisible();
  });

  test("health pages require an account", async ({ page }) => {
    for (const path of ["/home", "/chat", "/profile", "/settings/export"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
    }
    // Help (terms, privacy) stays public.
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help & Support" })).toBeVisible();
  });

  test("sign-in validates and reports wrong passwords without detail", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await page.getByLabel("Email").fill("alex.morgan@example.com");
    // Preview mode treats this password as wrong.
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  });

  test("creates an account, confirms the email and signs out", async ({ page }) => {
    const email = `robin-${unique()}@example.com`;
    await page.goto("/sign-in?mode=sign-up");
    await page.getByLabel("First name").fill("Robin");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("a-long-password");
    await page.getByRole("button", { name: "Create Account", exact: true }).click();
    await expect(page.getByText(`We've sent a confirmation link to ${email}`)).toBeVisible();

    // Preview inbox stands in for the email.
    await page.goto(`/preview/inbox?email=${encodeURIComponent(email)}`);
    await page.getByRole("link", { name: "Confirm email address" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: /Good (Morning|Afternoon|Evening), Robin/ })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("resets a forgotten password through the emailed link", async ({ page }) => {
    const email = `reset-${unique()}@example.com`;
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("Enter a valid email address.");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(page.getByText(/we've sent a link to reset the password/)).toBeVisible();

    await page.goto(`/preview/inbox?email=${encodeURIComponent(email)}`);
    await page.getByRole("link", { name: "Choose a new password" }).click();
    await page.getByLabel("New password", { exact: true }).fill("a new passphrase");
    await page.getByLabel("Confirm new password").fill("a new passphrase");
    await page.getByRole("button", { name: "Set New Password" }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=1/);
    await expect(page.getByText("Your password was changed. Sign in with the new one.")).toBeVisible();
  });

  test("the reset page takes the one-time link from the URL fragment and removes it", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.locator("main").getByRole("alert")).toHaveText("This reset link is invalid or has expired.");
    await page.goto("about:blank"); // reset links always open as a fresh page load
    await page.goto("/reset-password#access_token=not-a-real-token-123456&type=recovery");
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByLabel("New password", { exact: true }).fill("a new passphrase");
    await page.getByLabel("Confirm new password").fill("different passphrase");
    await page.getByRole("button", { name: "Set New Password" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("The passwords don't match.");
  });

  test("welcome and sign-in have no detectable accessibility violations", async ({ page }) => {
    await expectNoA11yViolations(page, "/");
    await expectNoA11yViolations(page, "/sign-in");
    await expectNoA11yViolations(page, "/forgot-password");
    await expectNoA11yViolations(page, "/reset-password");
  });
});

test.describe("home", () => {
  test("shows the sample account and labels it as Preview", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByText(/^Preview mode — a sample account/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Good (Morning|Afternoon|Evening), Alex/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's Plan" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Morning medication/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Activity" })).toBeVisible();
    await expect(page.getByText(/not a diagnosis/i).first()).toBeVisible();
  });

  test("completing a plan item persists (shared with the iPhone app)", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    const water = page.getByRole("checkbox", { name: /Drink water/ });
    const initial = await water.isChecked();
    await water.click();
    await expect(water).toBeChecked({ checked: !initial });
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("checkbox", { name: /Drink water/ })).toBeChecked({ checked: !initial, timeout: 1000 });
    }).toPass();
  });

  test("mood check-in is saved", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByText("Good", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Good" })).toBeChecked();
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("radio", { name: "Good" })).toBeChecked({ timeout: 1000 });
    }).toPass();
  });

  test("does not scroll horizontally", async ({ page }) => {
    await page.goto("/home");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("chat", () => {
  test("emergencies get fixed guidance immediately, before any AI", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "networkidle" });
    await page.getByLabel("Message").fill("I have crushing chest pain and can't breathe");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("region", { name: "Emergency guidance" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Call emergency services/ }).first()).toHaveAttribute("href", /^tel:/);
  });

  test("sample answers are labelled, with tappable follow-ups", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "networkidle" });
    await expect(page.getByText("Preview mode: answers are sample responses, not a real AI and not medical advice.")).toBeVisible();
    await page.getByLabel("Message").fill("I get headaches after long days on my laptop");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^Sample response in Preview mode/)).toBeVisible();
    await page.getByRole("button", { name: "Under an hour" }).click();
    await expect(page.getByText(/^Sample response in Preview mode/)).toHaveCount(2);
  });
});

test.describe("timeline, plan and profile", () => {
  test("shows the sample timeline with sources", async ({ page }) => {
    await page.goto("/timeline");
    await expect(page.getByText("Started a morning walking habit")).toBeVisible();
    await expect(page.getByText("Added by you").first()).toBeVisible();
  });

  test("adds a note to the timeline and deletes it", async ({ page }) => {
    const title = `Tried a new stretching routine ${unique()}`;
    await page.goto("/timeline", { waitUntil: "networkidle" });
    await page.getByText("Note", { exact: true }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Add to timeline" }).click();
    await expect(page.getByText(title)).toBeVisible();
    await page.getByRole("button", { name: `Delete entry: ${title}` }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("flags emergencies while a symptom is typed", async ({ page }) => {
    await page.goto("/timeline", { waitUntil: "networkidle" });
    await page.getByLabel("Title").fill("Face drooping and slurred speech");
    await expect(page.getByRole("region", { name: "Emergency guidance" })).toBeVisible();
  });

  test("adds a medication with the instruction kept word for word", async ({ page }) => {
    const name = `Test med ${unique()}`;
    const instruction = "1 tablet after breakfast — per the label";
    await page.goto("/plans", { waitUntil: "networkidle" });
    await page.getByText("Medication", { exact: true }).click();
    await page.getByLabel("Medication name").fill(name);
    await page.getByLabel("Instructions, exactly as written").fill(instruction);
    await page.getByRole("button", { name: "Add to plan" }).click();
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText(instruction)).toBeVisible();
    await page.getByRole("button", { name: `Remove ${name} from your plan` }).click();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("a medication can't be added without its instruction", async ({ page }) => {
    await page.goto("/plans", { waitUntil: "networkidle" });
    await page.getByText("Medication", { exact: true }).click();
    await page.getByLabel("Medication name").fill("No instruction");
    await page.getByRole("button", { name: "Add to plan" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("exactly as written");
  });

  test("profile shows memory with its source and lets the person forget it", async ({ page }) => {
    const fact = `Prefers evening reminders ${unique()}`;
    await page.goto("/profile", { waitUntil: "networkidle" });
    await expect(page.getByText("Prefers walking in the morning before work")).toBeVisible();
    await page.getByLabel("Something the assistant should keep in mind").fill(fact);
    await page.getByRole("button", { name: "Add", exact: true }).last().click();
    await expect(page.getByText(fact)).toBeVisible();
    await page.getByRole("button", { name: `Forget: ${fact}` }).click();
    await expect(page.getByText(fact)).toHaveCount(0);
  });
});

test.describe("reports, health and settings", () => {
  test("uploads a photo; Preview mode shows a clearly labelled sample result", async ({ page }) => {
    await page.goto("/reports", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Photo check" }).click();
    // A tiny valid PNG (1×1 pixel).
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator("input[type=file]").setInputFiles({ name: "arm.png", mimeType: "image/png", buffer: png });
    await expect(page).toHaveURL(/\/reports\/[0-9a-f-]+$/, { timeout: 20_000 });
    await expect(page.getByText(/^Sample result in Preview mode/)).toBeVisible({ timeout: 20_000 });
  });

  test("health dashboard shows the sample trends", async ({ page }) => {
    await page.goto("/health");
    await expect(page.getByRole("heading", { level: 1, name: "Health Dashboard" })).toBeVisible();
    await expect(page.getByText("No synced health data yet")).toHaveCount(0);
  });

  test("privacy switches, data download and care", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "networkidle" });
    const sync = page.getByRole("switch", { name: "Health data sync" });
    const before = await sync.getAttribute("aria-checked");
    await sync.click();
    await expect(sync).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    await sync.click();
    await expect(sync).toHaveAttribute("aria-checked", before ?? "false");

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download my data" }).click();
    expect((await download).suggestedFilename()).toMatch(/^healthmate-export-.*\.json$/);

    await page.goto("/care");
    await expect(page.getByRole("link", { name: /In an emergency, call/ })).toHaveAttribute("href", /^tel:/);
  });

  test("signed-in pages have no detectable accessibility violations", async ({ page }) => {
    for (const path of ["/home", "/chat", "/timeline", "/plans", "/profile", "/reports", "/health", "/settings", "/care", "/design"]) {
      await expectNoA11yViolations(page, path);
    }
  });
});

test.describe("design system", () => {
  test("gallery components work: toast, confirmation and sheet", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "Design system" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    await page.getByRole("button", { name: "Show success toast" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your reminder settings were updated." })).toBeVisible();
    await page.getByRole("button", { name: "Confirmation dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this report?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Sheet" }).click();
    await expect(page.getByRole("dialog", { name: "Add appointment" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Add appointment" })).toBeHidden();
  });
});

test.describe("navigation", () => {
  test("every destination is reachable", async ({ page, isMobile }) => {
    await page.goto("/home");
    const destinations = [
      ["AI Chat", "/chat"],
      ["Health Dashboard", "/health"],
      ["Medical Reports", "/reports"],
      ["Medications & Tasks", "/plans"],
      ["Find Care", "/care"],
      ["Health Timeline", "/timeline"],
      ["Settings", "/settings"],
      ["Home", "/home"],
    ] as const;
    const hasSidebar = !isMobile && (page.viewportSize()?.width ?? 0) >= 1024;
    for (const [label, href] of destinations) {
      if (!hasSidebar) await page.getByRole("button", { name: "Open menu" }).click();
      const nav = hasSidebar ? page.getByRole("complementary").getByRole("navigation", { name: "Main" }) : page.getByRole("dialog", { name: "Main menu" });
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("mobile bottom bar mirrors the iOS tabs", async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone-only");
    await page.goto("/home");
    const bar = page.getByRole("navigation", { name: "Primary" });
    await expect(bar.getByRole("link")).toHaveText(["Home", "Chat", "Health", "Plans", "Profile"]);
    await bar.getByRole("link", { name: "Plans" }).click();
    await expect(page).toHaveURL(/\/plans$/);
  });
});
