import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("welcome / onboarding", () => {
  test("introduces HealthMate and enters the app", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "HealthMate" })).toBeVisible();
    for (const f of ["AI Health Assistant", "Track Your Health", "Understand Your Reports", "Stay on Track"]) {
      await expect(page.getByText(f, { exact: true }).first()).toBeVisible();
    }
    await page.getByRole("link", { name: "Get Started" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: /Good (Morning|Afternoon|Evening), Alex/ })).toBeVisible();
  });

  test("sign-in validates and is honest that auth is not live", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await page.getByLabel("Email").fill("alex@example.com");
    await page.getByLabel("Password").fill("a-long-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByRole("status")).toContainText("isn't available in this preview");
  });
});

test.describe("home", () => {
  test("shows the dashboard sections and labels sample data", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByText(/Demo mode/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /I'm your AI Health Assistant/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's Health" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Heart Rate: 72 bpm/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's Plan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming Appointments" })).toBeVisible();
    await expect(page.getByText(/Not a diagnosis/).first()).toBeVisible();
  });

  test("completing a task persists across reloads", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" }); // wait for hydration before interacting
    const walk = page.getByRole("checkbox", { name: /Evening walk/ });
    const initial = await walk.isChecked();
    await walk.click();
    await expect(walk).toBeChecked({ checked: !initial });
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Evening walk/ })).toBeChecked({ checked: !initial });
    // Restore the shared demo state, and confirm the server has it before the next test.
    await page.getByRole("checkbox", { name: /Evening walk/ }).click();
    await expect(page.getByRole("checkbox", { name: /Evening walk/ })).toBeChecked({ checked: initial });
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("checkbox", { name: /Evening walk/ })).toBeChecked({ checked: initial, timeout: 1000 });
    }).toPass();
  });

  test("finishing the whole plan celebrates", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" }); // wait for hydration before interacting
    const boxes = page.getByRole("checkbox"); // only Today's Plan has checkboxes on Home
    const toggled: number[] = [];
    for (let i = 0; i < (await boxes.count()); i++) {
      if (!(await boxes.nth(i).isChecked())) {
        await boxes.nth(i).click();
        await expect(boxes.nth(i)).toBeChecked();
        toggled.push(i);
      }
    }
    await expect(page.getByText("All done!")).toBeVisible();
    for (const i of toggled) {
      await boxes.nth(i).click(); // restore shared demo state
      await expect(boxes.nth(i)).not.toBeChecked();
    }
    await expect(async () => {
      await page.reload();
      for (const i of toggled) await expect(boxes.nth(i)).not.toBeChecked({ timeout: 1000 });
    }).toPass();
  });

  test("mood check-in gives feedback", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" }); // wait for hydration before interacting
    await page.getByText("Good", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Good" })).toBeChecked();
    await expect(page.getByText("Nice. Your check-in has been saved.")).toBeVisible();
  });

  test("has no detectable accessibility violations", async ({ page }) => {
    // Axe measures colours at a single instant; freeze entrance animations so it sees final styles.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/home");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("welcome has no detectable accessibility violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("does not scroll horizontally", async ({ page }) => {
    await page.goto("/home");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
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
      ["Doctor Consultation", "/care"],
      ["Health Timeline", "/timeline"],
      ["Settings", "/settings"],
      ["Help & Support", "/help"],
      ["Home", "/home"],
    ] as const;
    const viewport = page.viewportSize();
    const hasSidebar = !isMobile && (viewport?.width ?? 0) >= 1024;
    for (const [label, href] of destinations) {
      if (!hasSidebar) await page.getByRole("button", { name: "Open menu" }).click();
      const nav = hasSidebar ? page.getByRole("complementary").getByRole("navigation", { name: "Main" }) : page.getByRole("dialog", { name: "Main menu" });
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("marks the current page for assistive tech", async ({ page, isMobile }) => {
    await page.goto("/home");
    const nav = isMobile ? page.getByRole("navigation", { name: "Primary" }) : page.locator("nav[aria-label='Main']").first();
    if (!isMobile && (page.viewportSize()?.width ?? 0) < 1024) test.skip();
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
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
