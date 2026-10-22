// Captures the workflow screenshots against a running dev server.
// Usage: npm run dev (in another terminal), then `node scripts/capture-screenshots.mjs`
// Read-only: opens panels and modals for the screenshots but never submits them.

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "screenshots";
const PROFILE_ID = process.env.PROFILE_ID ?? "be47f90e-9867-417d-8169-26485be99551";

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

async function shot(name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}`);
}

async function settle(url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.getByText("Loading…").first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
}

async function closePanel() {
  await page.getByRole("button", { name: "Close" }).last().click();
}

// ── Engagement calendar & review ────────────────────────────────────────────

await settle("/");
await shot("01-calendar");

// List view — the working queue
await page.getByRole("button", { name: "LIST", exact: true }).click();
await page.getByText("Horizon").waitFor();
await shot("02-list-view");

// Needs-review filter — the day's working queue
await page.getByRole("button", { name: /REVIEW QUEUE/ }).click();
await page.getByText("Needs review only").waitFor();
await shot("03-list-needs-review");

// Open one draft for review from the list
await page.locator("button", { hasText: "Needs review" }).first().click();
await page.getByRole("button", { name: "Approve", exact: true }).waitFor();
await shot("04-review-ai-draft");

// Reschedule the engagement without leaving the review panel
await page.getByRole("button", { name: "Change" }).click();
await page.locator('aside input[type="date"]').waitFor();
await shot("05-reschedule-outreach");
await page.getByRole("button", { name: "Cancel" }).first().click();

await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.getByRole("button", { name: "Save & approve" }).waitFor();
await shot("06-edit-ai-draft");
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByRole("button", { name: /Fallback: standard template/ }).click();
await page.locator("aside .overflow-y-auto").last().evaluate((el) => { el.scrollTop = el.scrollHeight; });
await shot("07-fallback-template");
await closePanel();

// Back to the grid for the calendar-specific shots
await page.getByRole("button", { name: "CALENDAR", exact: true }).click();
await page.locator("[data-date]").first().waitFor();
await page.locator('[data-date] [title="AI email approved"]').first().click();
await page.getByRole("button", { name: "Undo approval" }).waitFor();
await shot("08-approved-outreach");
await closePanel();

// Ad hoc requests are handled in person — no email, no draft
await page.locator('[data-date] div[title*="Ad Hoc:"]').first().click();
await page.getByText("Ad hoc services are handled in person", { exact: false }).waitFor();
await shot("09-adhoc-followup");
await page.getByRole("button", { name: "Dismiss" }).click();

// A chip in week 3 — beyond the 7-day draft window
await page.locator("[data-date]").nth(12).locator('div[title*="Due"]').first().click();
await page.getByRole("button", { name: "Draft now" }).waitFor();
await shot("10-scheduled-service");
await closePanel();

// ── Households ──────────────────────────────────────────────────────────────

await settle("/clients");
await shot("11-clients");

await page.getByPlaceholder("Try: black labs overdue for grooming").fill("VIPs overdue for grooming");
await page.keyboard.press("Enter");
await page.waitForResponse((r) => r.url().includes("/api/filter"), { timeout: 60000 });
await shot("12-clients-filtered");

await settle(`/clients/${PROFILE_ID}?from=clients`);
await shot("13-client-profile");

await page.getByRole("button", { name: "+ Ad Hoc Service" }).click();
await page.locator("select").first().selectOption("ear_cleaning");
await page.getByPlaceholder("Any special instructions…").fill("Matting behind the ears — wants it sorted before the holidays");
await shot("14-log-adhoc-service");

// ── Ad hoc services ──────────────────────────────────────────────────────────

await settle("/adhoc");
await shot("15-adhoc-services");

await page.getByTitle("Take it").first().click();
await page.getByText("Which dog").waitFor();
await page.getByPlaceholder("Anything the team should know", { exact: false }).fill(
  "Owner says the coat is matting faster than usual — worth a look while he is in."
);
await shot("16-take-adhoc-request");

await browser.close();
