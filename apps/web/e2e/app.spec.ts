import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const unique = () => Math.random().toString(36).slice(2, 8);

/** Signs in to a new sample account, so tests that change data don't affect each other. */
async function signInFresh(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`fresh-${unique()}@example.com`);
  await page.getByLabel("Password").fill("preview-password");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Axe on the page that's already open (no reload). */
async function expectCurrentPageAccessible(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((v) => `${new URL(page.url()).pathname} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}

async function expectNoA11yViolations(page: Page, path: string) {
  // Axe measures colours at a single instant; freeze entrance animations so it sees final styles.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Wait for the rendered page, not "network idle": Next.js link prefetches can stay open indefinitely.
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
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

  test("creates an account, confirms the email, completes onboarding and signs out", async ({ page }) => {
    const email = `robin-${unique()}@example.com`;
    await page.goto("/sign-in?mode=sign-up");
    await page.getByLabel("First name").fill("Robin");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("a-long-password");
    await page.getByRole("button", { name: "Create Account", exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email\?email=/);
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // Signing in before confirming comes back to the same screen.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("a-long-password");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email\?email=/);

    // Preview inbox stands in for the email.
    await page.getByRole("link", { name: "Open Preview inbox" }).click();
    await page.getByRole("link", { name: "Confirm email address" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1, name: "About you" })).toBeVisible();
    await expect(page.getByLabel("First name")).toHaveValue("Robin");

    // The app sends unfinished accounts back to onboarding.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/onboarding$/);

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Sleep better/ }).click();
    await expect(page.getByRole("button", { name: /Sleep better/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your health details" })).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your privacy choices" })).toBeVisible();
    await page.getByRole("switch", { name: "AI Health Assistant" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reminders" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Apple Health" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You're all set, Robin" })).toBeVisible();
    await expect(page.getByText("1 of 4 turned on")).toBeVisible();
    await page.getByRole("button", { name: "Go to Home" }).click();
    await expect(page).toHaveURL(/\/home\?welcome=1$/);
    await expect(page.getByRole("heading", { level: 1, name: /Good (Morning|Afternoon|Evening), Robin/ })).toBeVisible();

    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign out of HealthMate?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?signedOut=1/);
    await expect(page.getByText("You've signed out.")).toBeVisible();
    await page.goto("/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("continue with Apple or Google starts onboarding for a new account", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    // Every onboarding step is accessible.
    for (const heading of ["About you", "What would help most?", "Your health details", "Your privacy choices", "Reminders", "Apple Health"]) {
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.map((v) => `${heading} ${v.id}: ${v.nodes.length}`)).toEqual([]);
      if (heading === "About you") await page.getByLabel("First name").fill("Sam");
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: "You're all set, Sam" })).toBeVisible();
  });

  test("a used or expired confirmation link explains what to do", async ({ page }) => {
    await page.goto("/verify-email/confirm?token=not-a-real-token");
    await expect(page).toHaveURL(/\/verify-email\?status=invalid/);
    await expect(page.getByRole("heading", { level: 1, name: "This link has expired" })).toBeVisible();
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
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
    await expectNoA11yViolations(page, "/verify-email?email=robin%40example.com");
    await expectNoA11yViolations(page, "/verify-email?status=invalid");
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

test.describe("home destinations and notifications", () => {
  // A fresh sample account for each test, so their changes don't affect other tests.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every Home item opens its detail", async ({ page }) => {
    await signInFresh(page);
    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /^Steps:/ }).click();
    await expect(page).toHaveURL(/\/health\/steps$/);
    await expect(page.getByRole("heading", { level: 1, name: "Steps" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Last 7 days" })).toBeVisible();
    await page.getByRole("link", { name: "30 days" }).click();
    await expect(page).toHaveURL(/\/health\/steps\?days=30$/);
    await expect(page.getByRole("heading", { name: "Last 30 days" })).toBeVisible();

    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Example clinic letter uploaded/ }).click();
    await expect(page).toHaveURL(/\/reports\/[\w-]+$/);

    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Annual check-up/ }).first().click();
    await expect(page).toHaveURL(/\/care\/appointments\/[\w-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Annual check-up" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", /\/calendar$/);
    await expect(page.getByText("Bring medication list")).toBeVisible();
    await expectCurrentPageAccessible(page);

    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Morning medication details" }).click();
    await expect(page).toHaveURL(/\/plans\/[\w-]+$/);
    await expect(page.getByText("Instructions, exactly as entered")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Last 7 days" })).toBeVisible();
    await expectCurrentPageAccessible(page);
  });

  test.describe("notification centre", () => {
    test("bell, filters, open, mark all read and delete", async ({ page }) => {
      await signInFresh(page);

      await page.getByRole("link", { name: "Notifications, 3 unread" }).click();
      await expect(page).toHaveURL(/\/notifications$/);
      await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
      await page.getByRole("button", { name: /^Unread/ }).click();
      await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(3);

      // Opening one goes to what it's about and marks it read.
      await page.getByRole("link", { name: /Check-up in 3 days/ }).click();
      await expect(page).toHaveURL(/\/care\/appointments\/[\w-]+$/);
      await expect(page.getByRole("link", { name: "Notifications, 2 unread" })).toBeVisible();

      await page.goto("/notifications");
      await page.getByRole("button", { name: "Mark all as read" }).click();
      await expect(page.getByText("All caught up")).toBeVisible();
      await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Options for New sign-in on iPhone" }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.getByText("New sign-in on iPhone")).toHaveCount(0);
      await page.reload();
      await expect(page.getByText("New sign-in on iPhone")).toHaveCount(0);
      await expectNoA11yViolations(page, "/notifications");
    });
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

  test("a deleted conversation's link explains itself", async ({ page }) => {
    await page.goto("/chat?c=00000000-0000-4000-8000-00000000dead");
    await expect(page.getByText("That conversation was deleted or isn't available.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Suggested questions" })).toBeVisible();
  });

  test("attach opens the Reports upload with photo chosen", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add a report or photo" }).click();
    await page.getByRole("menuitem", { name: /Check a photo/ }).click();
    await expect(page).toHaveURL(/\/reports\?upload=photo#upload$/);
    await expect(page.getByRole("heading", { level: 1, name: "Medical Reports" })).toBeVisible();
  });

  test.describe("history and states", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("starts, renames and deletes a conversation", async ({ page }) => {
      await signInFresh(page);
      await page.goto("/chat", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Tips for sleeping better" }).click();
      await expect(page.getByText(/^Sample response in Preview mode/)).toBeVisible();
      await expect(page).toHaveURL(/\/chat\?c=/);
      const list = page.getByRole("complementary", { name: "Past conversations" });
      await expect(list.getByRole("link", { name: /Tips for sleeping better/ })).toBeVisible();

      await list.getByRole("button", { name: "Rename conversation: Tips for sleeping better" }).click();
      await list.getByLabel("Conversation name").fill("My sleep routine");
      await list.getByRole("button", { name: "Save name" }).click();
      await expect(list.getByRole("link", { name: /My sleep routine/ })).toBeVisible();

      await list.getByRole("button", { name: "Delete conversation: My sleep routine" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete this conversation?" });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(list.getByRole("link", { name: /My sleep routine/ })).toBeVisible();
      await list.getByRole("button", { name: "Delete conversation: My sleep routine" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await expect(page).toHaveURL(/\/chat$/);
      await expect(list.getByRole("link", { name: /My sleep routine/ })).toHaveCount(0);
      await expectCurrentPageAccessible(page);
    });

    test("AI unavailable still shows emergency guidance and offers to try again", async ({ page, context }) => {
      await signInFresh(page);
      await context.addCookies([{ name: "hm_preview_controls", value: encodeURIComponent(JSON.stringify({ state: "ai_unavailable" })), url: page.url() }]);
      await page.goto("/chat", { waitUntil: "networkidle" });
      await expect(page.getByText("AI answers are unavailable right now", { exact: true })).toBeVisible();
      await page.getByLabel("Message").fill("I have crushing chest pain and can't breathe");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("region", { name: "Emergency guidance" }).first()).toBeVisible();
      await expect(page.locator("main").getByRole("alert").filter({ hasText: "wasn't sent" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    });

    test("offline shows the offline state instead of a broken page", async ({ page, context }) => {
      await signInFresh(page);
      await context.addCookies([{ name: "hm_preview_controls", value: encodeURIComponent(JSON.stringify({ state: "offline" })), url: page.url() }]);
      await page.goto("/chat");
      await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    });
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
    // Detail shows the instruction word for word; removing asks first and says it doesn't change a prescription.
    await page.getByRole("link", { name: `${name} details` }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Instructions, exactly as entered")).toBeVisible();
    await expect(page.getByText(instruction)).toBeVisible();
    await page.getByRole("button", { name: "Remove from plan" }).click();
    const dialog = page.getByRole("dialog", { name: `Remove “${name}”?` });
    await expect(dialog).toContainText("doesn't change your prescription");
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(page).toHaveURL(/\/plans$/);
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

  test("health dashboard: today, connection, trends, ranges and daily history", async ({ page }) => {
    await page.goto("/health", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Health" })).toBeVisible();
    await expect(page.getByText("Sample health data in Preview mode — not real readings.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Apple Health connected/ })).toBeVisible();
    const today = page.getByRole("region", { name: "Today" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Today", exact: true }) }));
    await expect(today.getByRole("link", { name: /^Sleep last night:/ })).toBeVisible();
    await expect(today.getByRole("link", { name: /^Resting heart rate:/ })).toBeVisible();

    await page.getByRole("link", { name: "90 days" }).click();
    await expect(page).toHaveURL(/\/health\?days=90$/);
    await expect(page.getByRole("heading", { name: "Last 90 days" })).toBeVisible();

    await page.getByRole("link", { name: "See all days" }).click();
    await expect(page).toHaveURL(/\/health\/history$/);
    await expect(page.getByRole("heading", { level: 1, name: "Daily health history" })).toBeVisible();
    await page.getByRole("link", { name: /^Yesterday/ }).click();
    await expect(page).toHaveURL(/\/health\/history\/\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByText("Resting heart rate", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Your usual /).first()).toBeVisible();
    await page.getByRole("link", { name: "Previous day" }).click();
    await expect(page.getByRole("link", { name: "Next day" })).toBeVisible();
    await expectCurrentPageAccessible(page);
  });

  test("metric detail offers 90 days and a day-by-day list", async ({ page }) => {
    await page.goto("/health/resting_heart_rate?days=90", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Resting heart rate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Last 90 days" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Day by day" })).toBeVisible();
    await page.getByRole("link", { name: /^Yesterday/ }).click();
    await expect(page).toHaveURL(/\/health\/history\/\d{4}-\d{2}-\d{2}$/);
  });

  test.describe("health states and readings", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("a reading you add is saved to that day's history", async ({ page }) => {
      await signInFresh(page);
      await page.goto("/health/add", { waitUntil: "networkidle" });
      await page.getByText("Weight", { exact: true }).click();
      await page.getByLabel("Weight (kg)").fill("500");
      await page.getByRole("button", { name: "Save reading" }).click();
      await expect(page.getByText(/Enter a value between/)).toBeVisible();
      await page.getByLabel("Weight (kg)").fill("71.9");
      await page.getByRole("button", { name: "Save reading" }).click();
      await expect(page).toHaveURL(/\/health\/history\/\d{4}-\d{2}-\d{2}\?added=weight$/);
      await expect(page.getByRole("link", { name: /Weight\s*71\.9\s*kg/ })).toBeVisible();
    });

    for (const [state, text] of [
      ["empty", "No health data in the last 7 days"],
      ["error", "Your health data couldn't load"],
      ["permission", "Health data sync is off"],
    ] as const) {
      test(`shows the ${state} state`, async ({ page, context }) => {
        await signInFresh(page);
        await context.addCookies([{ name: "hm_preview_controls", value: encodeURIComponent(JSON.stringify({ state })), url: page.url() }]);
        await page.goto("/health");
        await expect(page.getByRole("heading", { name: text })).toBeVisible();
      });
    }
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
    for (const path of ["/home", "/chat", "/timeline", "/plans", "/profile", "/reports", "/health", "/health/sleep", "/health/history", "/health/add", "/settings", "/care", "/design"]) {
      await expectNoA11yViolations(page, path);
    }
  });
});

test.describe("account", () => {
  test("shows sign-in details and changes the password", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "Account & password" }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByText("alex.morgan@example.com")).toBeVisible();
    await page.getByLabel("Current password").fill("wrong-password");
    await page.getByLabel("New password", { exact: true }).fill("a brand new passphrase");
    await page.getByLabel("Confirm new password").fill("a brand new passphrase");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("Your current password is incorrect.");
    // The form clears after each attempt, so passwords are never left on screen.
    await page.getByLabel("Current password").fill("preview-password");
    await page.getByLabel("New password", { exact: true }).fill("a brand new passphrase");
    await page.getByLabel("Confirm new password").fill("a brand new passphrase");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed")).toBeVisible();
    await expectCurrentPageAccessible(page);
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
