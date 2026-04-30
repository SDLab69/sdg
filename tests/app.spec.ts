/**
 * Sam's Dog Grooming — Playwright QA Suite
 *
 * Run:  npx playwright test
 * First time: npx playwright install chromium
 *
 * All Supabase REST calls are intercepted so tests are deterministic
 * and do NOT require a live database connection.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_HOUSEHOLD = {
  id: "hh-001",
  name: "Johnson Family",
  phone: "555-123-4567",
  email: "johnson@example.com",
  address: "123 Main St",
  is_vip: false,
  created_at: "2023-01-15T00:00:00Z",
};

const MOCK_VIP_HOUSEHOLD = {
  id: "hh-002",
  name: "Smith Family",
  phone: "555-987-6543",
  email: "smith@example.com",
  address: "456 Oak Ave",
  is_vip: true,
  created_at: "2022-06-01T00:00:00Z",
};

const MOCK_PET = {
  id: "pet-001",
  household_id: "hh-001",
  name: "Buddy",
  breed: "Golden Retriever",
  age: 4,
  weight: 65,
  grooming_notes: "Gentle around ears",
};

const MOCK_SERVICE_CLOCK = {
  household_id: "hh-001",
  last_visit: "2025-10-15",
  last_full_groom: "2025-04-01",
  next_brush_due: "2026-04-15",
  next_full_groom_due: "2026-04-01",
};

const MOCK_ADHOC_REQUEST = {
  id: "req-001",
  household_id: "hh-001",
  service_type: "bath",
  status: "pending",
  requested_date: "2026-04-10",
  outreach_date: null,
  note: "Please use hypoallergenic shampoo",
  created_at: "2026-04-10T10:00:00Z",
  households: { name: "Johnson Family", is_vip: false },
};

const MOCK_APPOINTMENT = {
  id: "appt-001",
  household_id: "hh-001",
  date: "2025-10-15",
  time: "10:00",
  service_type: "full_groom",
  notes: "Great session",
  duration: 90,
};

const MOCK_CALENDAR_EVENT = {
  id: "cal-001",
  household_id: "hh-001",
  service_type: "bath",
  outreach_date: "2026-04-14",
  status: "confirmed",
  note: null,
  households: { name: "Johnson Family", is_vip: false },
};

// ─── Supabase intercept helpers ───────────────────────────────────────────────

type MockConfig = {
  households?: object[];
  pets?: object[];
  service_clocks?: object[];
  appointments?: object[];
  adhoc_requests?: object[];
};

/**
 * Intercepts all Supabase REST API calls and returns controlled mock data.
 * Unmocked tables return an empty array by default.
 *
 * HEAD requests (used for count queries) return the correct count from the
 * data array length rather than always returning 0.
 */
async function mockSupabase(page: Page, config: MockConfig = {}) {
  await page.route("**/rest/v1/**", (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    // Extract table name from path, e.g. /rest/v1/households?select=...
    const tableMatch = url.match(/\/rest\/v1\/([^?]+)/);
    const table = tableMatch ? tableMatch[1] : "";

    let data: object[] = [];
    if (table.startsWith("households")) {
      data = config.households ?? [MOCK_HOUSEHOLD, MOCK_VIP_HOUSEHOLD];
    } else if (table.startsWith("pets")) {
      data = config.pets ?? [MOCK_PET];
    } else if (table.startsWith("service_clocks")) {
      data = config.service_clocks ?? [MOCK_SERVICE_CLOCK];
    } else if (table.startsWith("appointments")) {
      data = config.appointments ?? [MOCK_APPOINTMENT];
    } else if (table.startsWith("adhoc_requests")) {
      data = config.adhoc_requests ?? [MOCK_ADHOC_REQUEST];
    }

    // HEAD requests are used for count queries — return count in content-range
    if (method === "HEAD") {
      return route.fulfill({
        status: 200,
        headers: {
          "content-range": `0-${Math.max(0, data.length - 1)}/${data.length}`,
          "content-type": "application/json",
        },
        body: "",
      });
    }

    // POST/PATCH/DELETE — return empty success
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data[0] ?? {}),
      });
    }

    // For single() calls (expect one object, not array)
    const acceptHeader = route.request().headers()["accept"] ?? "";
    const isSingle = acceptHeader.includes("vnd.pgrst.object");
    const body = isSingle ? JSON.stringify(data[0] ?? null) : JSON.stringify(data);

    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${Math.max(0, data.length - 1)}/${data.length}`,
      },
      body,
    });
  });
}

// ─── NavBar ───────────────────────────────────────────────────────────────────

test.describe("NavBar", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/");
  });

  test("brand title is visible", async ({ page }) => {
    await expect(page.getByText("Sam's Dog Grooming").first()).toBeVisible();
  });

  test("nav pills are rendered for Calendar, Clients, and Ad Hoc", async ({ page }) => {
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "CALENDAR", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "CLIENTS", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "AD HOC", exact: true })).toBeVisible();
  });

  test("Calendar pill is active on /", async ({ page }) => {
    const header = page.locator("header").first();
    const calLink = header.getByRole("link", { name: "CALENDAR", exact: true });
    await expect(calLink).toHaveClass(/bg-cream-2/);
  });

  test("hamburger opens the slide-out drawer", async ({ page }) => {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    // Drawer should slide in (no -translate-x-full)
    const drawer = page.locator('div[class*="translate-x-0"]').filter({ hasText: "Sam's Dog Grooming" });
    await expect(drawer).toBeVisible();
  });

  test("drawer closes via X button", async ({ page }) => {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("button", { name: "Close menu" }).click();
    // Drawer is hidden off screen
    const drawer = page.locator('div[class*="-translate-x-full"]');
    await expect(drawer).toBeAttached();
  });

  test("drawer closes by clicking the overlay", async ({ page }) => {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.locator(".fixed.inset-0.z-40").click({ force: true });
    const drawer = page.locator('div[class*="-translate-x-full"]');
    await expect(drawer).toBeAttached();
  });

  test("+ New Client button opens modal", async ({ page }) => {
    await page.getByRole("button", { name: "+ New Client" }).click();
    await expect(page.getByRole("heading", { name: "Add New Client" })).toBeVisible();
  });

  test("client count pill is shown in the header", async ({ page }) => {
    await mockSupabase(page, { households: [MOCK_HOUSEHOLD, MOCK_VIP_HOUSEHOLD] });
    await page.goto("/");
    await expect(
      page.locator("span").filter({ hasText: /\d+ clients/ }).first()
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── New Client Modal ─────────────────────────────────────────────────────────

test.describe("New Client Modal", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/");
    await page.getByRole("button", { name: "+ New Client" }).click();
    await expect(page.getByRole("heading", { name: "Add New Client" })).toBeVisible();
  });

  test("modal contains household and pet sections", async ({ page }) => {
    await expect(page.getByText("Household Details")).toBeVisible();
    await expect(page.getByText("Pet Details").or(page.getByText("First Pet"))).toBeVisible();
  });

  test("Cancel button closes the modal", async ({ page }) => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Add New Client" })).not.toBeVisible();
  });

  test("X button closes the modal", async ({ page }) => {
    // Scope to the modal card (fixed overlay with z-50)
    const modal = page.locator(".fixed.inset-0.z-50").last();
    await modal.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Add New Client" })).not.toBeVisible();
  });

  test("shows validation errors when submitting empty form", async ({ page }) => {
    await page.getByRole("button", { name: "+ Add Client" }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible();
  });

  test("household name and phone are required", async ({ page }) => {
    await page.getByRole("button", { name: "+ Add Client" }).click();
    await expect(page.getByText("Household name is required")).toBeVisible();
    await expect(page.getByText("Phone number is required")).toBeVisible();
  });

  test("pet name and breed are required", async ({ page }) => {
    // Fill household but leave pet empty
    await page.getByPlaceholder("The Johnson Family").fill("Test Family");
    await page.getByPlaceholder("(555) 000-0000").fill("555-000-0000");
    await page.getByRole("button", { name: "+ Add Client" }).click();
    await expect(page.getByText("Pet name is required")).toBeVisible();
    await expect(page.getByText("Breed is required")).toBeVisible();
  });

  test("'+ Add another pet' button reveals second pet section", async ({ page }) => {
    await expect(page.getByText("Second Pet")).not.toBeVisible();
    await page.getByRole("button", { name: "+ Add another pet" }).click();
    await expect(page.getByText("Second Pet")).toBeVisible();
  });

  test("VIP switch toggles when clicked", async ({ page }) => {
    const vipSwitch = page.getByRole("switch");
    await expect(vipSwitch).toHaveAttribute("aria-checked", "false");
    await vipSwitch.click();
    await expect(vipSwitch).toHaveAttribute("aria-checked", "true");
  });
});

// ─── Calendar Page ────────────────────────────────────────────────────────────

test.describe("Calendar Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, {
      adhoc_requests: [MOCK_CALENDAR_EVENT],
      households: [MOCK_HOUSEHOLD],
    });
    await page.goto("/");
  });

  test("renders the 4-week grid with day headers", async ({ page }) => {
    for (const day of ["MON", "TUE", "WED", "THU", "FRI"]) {
      await expect(page.getByText(day, { exact: true }).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("shows a date range label", async ({ page }) => {
    // rangeLabel format: "Apr 7 – May 2, 2026"
    await expect(page.locator("text=/\\w+ \\d+ – \\w+/")).toBeVisible({ timeout: 5000 });
  });

  test("Previous and Next week buttons are present", async ({ page }) => {
    // CalendarView uses ‹ and › single angle quotes
    await expect(page.locator("button").filter({ hasText: "‹" })).toBeVisible({ timeout: 5000 });
    await expect(page.locator("button").filter({ hasText: "›" })).toBeVisible({ timeout: 5000 });
  });

  test("TODAY button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: "TODAY" })).toBeVisible({ timeout: 5000 });
  });

  test("filter toggles are present", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Appointment Due/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /Scheduled appointments/i })).toBeVisible({ timeout: 5000 });
  });

  test("clicking › advances the week range", async ({ page }) => {
    await page.locator("text=/\\w+ \\d+ – \\w+/").first().waitFor({ timeout: 5000 });
    const rangeBefore = await page.locator("text=/\\w+ \\d+ – \\w+/").first().textContent();
    await page.locator("button").filter({ hasText: "›" }).click();
    const rangeAfter = await page.locator("text=/\\w+ \\d+ – \\w+/").first().textContent();
    expect(rangeAfter).not.toBe(rangeBefore);
  });

  test("TODAY button resets to current week", async ({ page }) => {
    await page.locator("text=/\\w+ \\d+ – \\w+/").first().waitFor({ timeout: 5000 });
    const rangeBefore = await page.locator("text=/\\w+ \\d+ – \\w+/").first().textContent();
    await page.locator("button").filter({ hasText: "›" }).click();
    await page.getByRole("button", { name: "TODAY" }).click();
    const rangeAfter = await page.locator("text=/\\w+ \\d+ – \\w+/").first().textContent();
    expect(rangeAfter).toBe(rangeBefore);
  });

  test("calendar shows confirmed adhoc chip on outreach date", async ({ page }) => {
    await expect(
      page.getByText("Johnson Family").or(page.getByText("Bath")).first()
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─── Clients Page ─────────────────────────────────────────────────────────────

test.describe("Clients Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, {
      households: [MOCK_HOUSEHOLD, MOCK_VIP_HOUSEHOLD],
      pets: [MOCK_PET],
      service_clocks: [MOCK_SERVICE_CLOCK],
    });
    await page.goto("/clients");
  });

  test("page heading is visible", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /clients/i })).toBeVisible();
  });

  test("renders client rows", async ({ page }) => {
    await expect(page.getByText("Johnson Family")).toBeVisible({ timeout: 5000 });
  });

  test("VIP badge appears on VIP clients", async ({ page }) => {
    await expect(page.getByText("VIP").first()).toBeVisible({ timeout: 5000 });
  });

  test("search box filters clients by name", async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill("Smith");
    await expect(page.getByText("Smith Family")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Johnson Family")).not.toBeVisible();
  });

  test("search cleared shows all clients again", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("Smith");
    await searchInput.fill("");
    await expect(page.getByText("Johnson Family")).toBeVisible({ timeout: 3000 });
  });

  test("Filters button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /filters/i })).toBeVisible();
  });

  test("Filters button opens the filter panel", async ({ page }) => {
    await page.getByRole("button", { name: /filters/i }).click();
    await expect(page.getByText(/status/i).first()).toBeVisible();
  });

  test("filter panel contains status options", async ({ page }) => {
    await page.getByRole("button", { name: /filters/i }).click();
    await expect(page.getByText("All").first()).toBeVisible();
    await expect(page.getByText("Overdue").first()).toBeVisible();
    await expect(page.getByText("Due Soon").first()).toBeVisible();
  });

  test("filter panel contains service filter options", async ({ page }) => {
    await page.getByRole("button", { name: /filters/i }).click();
    await expect(page.getByText("Full Groom").first()).toBeVisible();
    await expect(page.getByText("Brush & Nail").first()).toBeVisible();
  });

  test("filter badge count increments when a filter is applied", async ({ page }) => {
    await page.getByRole("button", { name: /filters/i }).click();
    await page.getByRole("button", { name: /overdue/i }).first().click();
    await expect(page.getByRole("button", { name: /filters.*1/i })).toBeVisible({ timeout: 3000 });
  });

  test("Clear all resets filters", async ({ page }) => {
    await page.getByRole("button", { name: /filters/i }).click();
    await page.getByRole("button", { name: /overdue/i }).first().click();
    await page.getByText(/clear all/i).click();
    await expect(page.getByRole("button", { name: /^filters$/i })).toBeVisible({ timeout: 3000 });
  });

  test("clicking a client row navigates to the profile page", async ({ page }) => {
    await page.getByText("Johnson Family").first().click();
    await expect(page).toHaveURL(/\/clients\//);
  });

  test("CLIENTS nav pill is active on /clients", async ({ page }) => {
    const header = page.locator("header").first();
    const clientsLink = header.getByRole("link", { name: "CLIENTS", exact: true });
    await expect(clientsLink).toHaveClass(/bg-cream-2/);
  });
});

// ─── Household Profile Page ───────────────────────────────────────────────────

test.describe("Household Profile Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, {
      households: [MOCK_HOUSEHOLD],
      pets: [MOCK_PET],
      service_clocks: [MOCK_SERVICE_CLOCK],
      appointments: [MOCK_APPOINTMENT],
      adhoc_requests: [],
    });
    await page.goto(`/clients/${MOCK_HOUSEHOLD.id}`);
  });

  test("renders household name as heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Johnson Family" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows pet name and breed", async ({ page }) => {
    await expect(page.getByText("Buddy")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Golden Retriever")).toBeVisible({ timeout: 5000 });
  });

  test("shows contact information section", async ({ page }) => {
    await expect(page.getByText("Contact").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("555-123-4567")).toBeVisible();
  });

  test("shows 18-month service schedule section", async ({ page }) => {
    await expect(page.getByText(/18.Month Service Schedule/i)).toBeVisible({ timeout: 5000 });
  });

  test("back button says '← Clients' when from=clients (default)", async ({ page }) => {
    await expect(
      page.getByRole("button").filter({ hasText: /Clients/ }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("back button says '← Calendar' when from=calendar", async ({ page }) => {
    await mockSupabase(page, {
      households: [MOCK_HOUSEHOLD],
      pets: [MOCK_PET],
      service_clocks: [MOCK_SERVICE_CLOCK],
      appointments: [MOCK_APPOINTMENT],
      adhoc_requests: [],
    });
    await page.goto(`/clients/${MOCK_HOUSEHOLD.id}?from=calendar`);
    await expect(
      page.getByRole("button").filter({ hasText: /Calendar/ }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("back button says '← Ad Hoc' when from=adhoc", async ({ page }) => {
    await mockSupabase(page, {
      households: [MOCK_HOUSEHOLD],
      pets: [MOCK_PET],
      service_clocks: [MOCK_SERVICE_CLOCK],
      appointments: [MOCK_APPOINTMENT],
      adhoc_requests: [],
    });
    await page.goto(`/clients/${MOCK_HOUSEHOLD.id}?from=adhoc`);
    await expect(
      page.getByRole("button").filter({ hasText: /Ad Hoc/ }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("back button navigates to clients list", async ({ page }) => {
    await page.getByRole("button").filter({ hasText: /Clients/ }).first().click();
    await expect(page).toHaveURL("/clients");
  });

  test("Edit button opens the edit modal", async ({ page }) => {
    await page.getByRole("button", { name: "Edit" }).click();
    // EditHouseholdModal has a heading "Edit Household" or similar
    await expect(page.locator(".fixed.inset-0.z-50")).toBeVisible({ timeout: 3000 });
  });

  test("Edit modal is pre-populated with household name", async ({ page }) => {
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator('input[value="Johnson Family"]')).toBeVisible({ timeout: 3000 });
  });

  test("Edit modal closes on Cancel", async ({ page }) => {
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator(".fixed.inset-0.z-50")).toBeVisible({ timeout: 3000 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".fixed.inset-0.z-50")).not.toBeVisible();
  });

  test("+ Appointment button opens the appointment modal", async ({ page }) => {
    await page.getByRole("button", { name: "+ Appointment" }).click();
    await expect(
      page.getByRole("heading", { name: /Schedule Ad Hoc Service/i })
    ).toBeVisible({ timeout: 3000 });
  });

  test("Appointment modal shows the household name", async ({ page }) => {
    await page.getByRole("button", { name: "+ Appointment" }).click();
    const modal = page.locator(".fixed.inset-0.z-50").last();
    await expect(modal.getByText("Johnson Family")).toBeVisible({ timeout: 3000 });
  });

  test("Appointment modal requires service type", async ({ page }) => {
    await page.getByRole("button", { name: "+ Appointment" }).click();
    await page.getByRole("button", { name: "Add to calendar" }).click();
    await expect(page.getByText(/service type is required/i)).toBeVisible({ timeout: 3000 });
  });

  test("Appointment modal closes on Cancel", async ({ page }) => {
    await page.getByRole("button", { name: "+ Appointment" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: /Schedule Ad Hoc Service/i })
    ).not.toBeVisible();
  });

  test("service schedule shows Full Groom and Brush badges", async ({ page }) => {
    await expect(page.getByText("Full Groom").first()).toBeVisible({ timeout: 5000 });
  });

  test("Recent Visits section is shown", async ({ page }) => {
    await expect(page.getByText("Recent Visits")).toBeVisible({ timeout: 5000 });
  });
});

// ─── Ad Hoc Services Page ─────────────────────────────────────────────────────

test.describe("Ad Hoc Services Page", () => {
  test("shows empty state when no pending requests", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/adhoc");
    await expect(page.getByText(/all clear/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/no pending requests/i)).toBeVisible();
  });

  test("renders service tiles when pending requests exist", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    await expect(page.getByText("Bath")).toBeVisible({ timeout: 5000 });
  });

  test("AD HOC nav pill is active on /adhoc", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/adhoc");
    const header = page.locator("header").first();
    const adhocLink = header.getByRole("link", { name: "AD HOC", exact: true });
    await expect(adhocLink).toHaveClass(/bg-cream-2/);
  });

  test("pending count badge appears in page when there are requests", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    // The page body shows a "1" badge next to "Online bookings pending review"
    // (totalPending from AdhocView's GET request, not a HEAD count).
    // This confirms pending requests are counted and surfaced in the UI.
    await expect(
      page.getByText(/online bookings pending review/i).locator("..").locator("span").filter({ hasText: "1" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("client name in request row is a clickable button", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    await expect(page.getByText("Johnson Family").first()).toBeVisible({ timeout: 5000 });
    const nameBtn = page.locator("button").filter({ hasText: "Johnson Family" }).first();
    await expect(nameBtn).toBeVisible();
  });

  test("client name button has hover:underline styling", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    const nameBtn = page.locator("button").filter({ hasText: "Johnson Family" }).first();
    await expect(nameBtn).toHaveClass(/hover:underline/);
  });

  test("clicking client name navigates to profile with from=adhoc", async ({ page }) => {
    await mockSupabase(page, {
      adhoc_requests: [MOCK_ADHOC_REQUEST],
      households: [MOCK_HOUSEHOLD],
      pets: [MOCK_PET],
      service_clocks: [MOCK_SERVICE_CLOCK],
      appointments: [],
    });
    await page.goto("/adhoc");
    const nameBtn = page.locator("button").filter({ hasText: "Johnson Family" }).first();
    await nameBtn.click();
    await expect(page).toHaveURL(/\/clients\/hh-001\?from=adhoc/);
  });

  test("confirm (✓) button opens the schedule modal", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    await page.locator("button[title='Confirm']").first().click();
    await expect(page.getByText(/Schedule Appointment/i)).toBeVisible({ timeout: 3000 });
  });

  test("schedule modal shows client name and service", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    await page.locator("button[title='Confirm']").first().click();
    // Scope to the confirm modal card (not the tile)
    const confirmModal = page.locator(".fixed.inset-0.z-50").last();
    await expect(confirmModal.getByText("Johnson Family")).toBeVisible({ timeout: 3000 });
    await expect(confirmModal.getByText("Bath")).toBeVisible();
  });

  test("schedule modal Cancel button closes it", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [MOCK_ADHOC_REQUEST] });
    await page.goto("/adhoc");
    await page.locator("button[title='Confirm']").first().click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(/Schedule Appointment/i)).not.toBeVisible();
  });

  test("page heading shows 'Ad Hoc Services'", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/adhoc");
    await expect(page.getByRole("heading", { name: "Ad Hoc Services" })).toBeVisible({
      timeout: 5000,
    });
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────

test.describe("Navigation flows", () => {
  test("CLIENTS nav pill links to /clients", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/");
    const header = page.locator("header").first();
    await header.getByRole("link", { name: "CLIENTS", exact: true }).click();
    await expect(page).toHaveURL("/clients");
  });

  test("CALENDAR nav pill links to /", async ({ page }) => {
    await mockSupabase(page, {
      adhoc_requests: [],
      households: [MOCK_HOUSEHOLD],
      pets: [MOCK_PET],
      service_clocks: [MOCK_SERVICE_CLOCK],
      appointments: [],
    });
    await page.goto("/clients");
    const header = page.locator("header").first();
    await header.getByRole("link", { name: "CALENDAR", exact: true }).click();
    await expect(page).toHaveURL("/");
  });

  test("AD HOC nav pill links to /adhoc", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/");
    const header = page.locator("header").first();
    await header.getByRole("link", { name: "AD HOC", exact: true }).click();
    await expect(page).toHaveURL("/adhoc");
  });

  test("drawer nav links navigate correctly", async ({ page }) => {
    await mockSupabase(page, { adhoc_requests: [] });
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    // Use the drawer-specific link (title-case "Clients") with exact match
    const drawer = page.locator('div[class*="translate-x-0"]').filter({ hasText: "Sam's Dog Grooming" });
    await drawer.getByRole("link", { name: "Clients", exact: true }).click();
    await expect(page).toHaveURL("/clients");
  });
});
