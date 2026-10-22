/**
 * Outreach review rules.
 *
 * Applies to the two recurring services — the full groom and the brush & nail
 * trim — which both start with a reminder email. Ad hoc requests are handled in
 * person and never produce an email.
 *
 * Scheduling happens on its own: every due service gets an outreach date about
 * six weeks ahead, and the email goes out that day unless it's rescheduled or
 * skipped. The content still gets read first — an AI draft is ready
 * DRAFT_LEAD_DAYS before the outreach date, and if it hasn't been approved by
 * then, the standard template is sent instead.
 */

export const DRAFT_LEAD_DAYS = 7;
export const GROOMER_NAME = "Sam";

export type ServiceKind = "full_groom" | "brush_nail";
export type DraftStatus = "needs_review" | "approved" | "skipped";

export type OutreachDraft = {
  id: string;
  household_id: string;
  source: ServiceKind;
  source_id: string;
  subject: string;
  body: string;
  status: DraftStatus;
  edited: boolean;
  reviewed_at: string | null;
  generated_at: string;
};

export const DRAFT_COLUMNS =
  "id, household_id, source, source_id, subject, body, status, edited, reviewed_at, generated_at";

export type ReviewState =
  | "scheduled"      // more than DRAFT_LEAD_DAYS out — no draft yet
  | "drafting"       // inside the window but the draft hasn't been generated
  | "needs_review"
  | "approved"
  | "skipped"
  | "sent_ai"
  | "sent_template"
  | "skipped_past";

export function draftKey(source: ServiceKind, sourceId: string): string {
  return `${source}:${sourceId}`;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd + "T00:00:00").getTime();
  const b = new Date(toYmd + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The date the AI draft becomes available for review. */
export function draftReadyDate(outreachYmd: string): string {
  return addDays(outreachYmd, -DRAFT_LEAD_DAYS);
}

export function reviewState(args: {
  outreachDate: string;
  today: string;
  draft: OutreachDraft | null | undefined;
}): ReviewState {
  const { outreachDate, today, draft } = args;
  if (outreachDate < today) {
    if (draft?.status === "skipped") return "skipped_past";
    return draft?.status === "approved" ? "sent_ai" : "sent_template";
  }
  if (draft?.status === "skipped") return "skipped";
  if (daysBetween(today, outreachDate) > DRAFT_LEAD_DAYS) return "scheduled";
  if (!draft) return "drafting";
  return draft.status;
}

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  scheduled: "Scheduled",
  drafting: "Drafting",
  needs_review: "Needs review",
  approved: "Approved",
  skipped: "Skipped",
  sent_ai: "Sent · AI draft",
  sent_template: "Sent · Standard template",
  skipped_past: "Skipped",
};

// ─── Service labels ───────────────────────────────────────────────────────────

export function serviceKindLabel(source: ServiceKind): string {
  return source === "full_groom" ? "Full Groom" : "Brush & Nail Trim";
}

// ─── Standard (pre-approved) templates ────────────────────────────────────────

export type RenderedTemplate = { subject: string; body: string };

function greeting(ownerFirstName: string | null, petNames: string[]): string {
  const hi = ownerFirstName ? `Hi ${ownerFirstName}` : "Hello";
  if (petNames.length === 0) return hi;
  if (petNames.length === 1) return `${hi} — and hello to ${petNames[0]}`;
  return `${hi} — and hello to ${petNames.slice(0, -1).join(", ")} and ${petNames[petNames.length - 1]}`;
}

export function standardEmail(
  source: ServiceKind,
  petNames: string[],
  ownerFirstName: string | null = null
): RenderedTemplate {
  const hi = greeting(ownerFirstName, petNames);
  if (source === "full_groom") {
    return {
      subject: "Time to book a full groom",
      body: `${hi},\n\nIt's been about a year since the last full groom, so we're due for another one. A full groom covers the bath, haircut, nails, ears and a good brush-out.\n\nJust reply to this email or give the shop a call and we'll find a time that works.\n\nSee you soon,\n${GROOMER_NAME}`,
    };
  }
  return {
    subject: "Time for a brush & nail trim",
    body: `${hi},\n\nIt's been about six months since the last visit, which makes this a good time for a brush-out and a nail trim. It keeps the coat in good shape between full grooms.\n\nReply to this email or call the shop and we'll get something on the calendar.\n\nSee you soon,\n${GROOMER_NAME}`,
  };
}
