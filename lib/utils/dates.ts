/**
 * Date utilities for Sam's Dog Grooming.
 *
 * All user-facing dates are displayed in Eastern Time (America/New_York).
 * Supabase stores timestamps as UTC; date-only columns (last_visit,
 * next_brush_due, etc.) are stored as plain calendar dates with no timezone.
 */

export const APP_TZ = "America/New_York";

/**
 * Today's calendar date in Eastern Time, as YYYY-MM-DD.
 * en-CA locale natively produces YYYY-MM-DD format.
 */
export function todayETString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

/**
 * A Date object at midnight on today's ET calendar date, using local time
 * constructors so that downstream getFullYear/getMonth/getDate calls are safe.
 */
export function todayET(): Date {
  return new Date(todayETString() + "T00:00:00");
}

/**
 * Extracts the calendar year from a UTC ISO timestamp (created_at / updated_at)
 * interpreted in Eastern Time.
 *
 * Example: "2024-01-01T03:00:00Z" → 2023  (still Dec 31 ET at 10pm)
 */
export function utcToETYear(iso: string): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ,
      year: "numeric",
    }).format(new Date(iso))
  );
}
