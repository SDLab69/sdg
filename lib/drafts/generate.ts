/**
 * Writes the reminder email for one upcoming service and saves it to
 * outreach_drafts with status "needs_review".
 *
 * Server-only: uses the Anthropic API key.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_LABELS } from "@/lib/terms";
import { todayETString } from "@/lib/utils/dates";
import {
  GROOMER_NAME,
  DRAFT_COLUMNS,
  type OutreachDraft,
  type ServiceKind,
} from "@/lib/engagement";

const anthropic = new Anthropic();
const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You write reminder emails for ${GROOMER_NAME}, who runs a small dog grooming shop, to the clients whose dogs are due for a service. Each email invites them to book an appointment. ${GROOMER_NAME} reads every draft before it is sent.

Write in ${GROOMER_NAME}'s voice: warm, familiar, and brief (70–120 words in the body). Use the dogs' names — that is how ${GROOMER_NAME} talks about clients. Mention one or two specific things about the dogs, such as the breed's coat, their age, or a handling note, so the email doesn't read like a form letter. End with a clear invitation to reply or call to book, then sign off as ${GROOMER_NAME}.

Keep it honest and easy:
- Don't promise a specific appointment time or price.
- Don't give veterinary or medical advice. If a handling note hints at a health issue, mention it gently as something to keep an eye on.
- Don't exaggerate how overdue the dog is, and don't guilt the owner.
- Don't mention anything the client didn't share with the shop.
- Don't mention that the email was drafted with AI.

Return the subject line and the plain-text body. The body uses blank lines between paragraphs and includes the greeting and sign-off. Use only plain ASCII punctuation: commas, periods, question marks, apostrophes. Don't use dashes of any kind.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
} as const;

export type GenerateResult =
  | { ok: true; draft: OutreachDraft }
  | { ok: false; reason: string };

/** The model occasionally double-escapes non-ASCII (a literal backslash-u sequence). */
function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function fmt(ymd: string | null | undefined): string {
  if (!ymd) return "unknown";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

/** Collects the client's details the email should draw on. */
async function buildContext(
  supabase: SupabaseClient,
  source: ServiceKind,
  sourceId: string
): Promise<{ householdId: string; prompt: string } | null> {
  const { data: c } = await supabase
    .from("service_clocks")
    .select("household_id, last_visit, last_full_groom, next_brush_due, next_full_groom_due")
    .eq("id", sourceId)
    .single();
  if (!c) return null;
  const householdId = c.household_id;
  const purpose = source === "full_groom"
    ? `Book a full groom, due ${fmt(c.next_full_groom_due)}. The last full groom was ${fmt(c.last_full_groom)}.`
    : `Book a brush and nail trim, due ${fmt(c.next_brush_due)}. The last visit was ${fmt(c.last_visit)}.`;

  const [{ data: hh }, { data: pets }, { data: recent }] = await Promise.all([
    supabase.from("households").select("name, is_vip").eq("id", householdId).single(),
    supabase.from("pets").select("name, breed, age, grooming_notes").eq("household_id", householdId).order("created_at"),
    supabase.from("appointments").select("date, service_type, notes")
      .eq("household_id", householdId).lte("date", todayETString())
      .order("date", { ascending: false }).limit(3),
  ]);
  if (!hh) return null;

  const petLines = (pets ?? []).map((p) =>
    `- ${p.name} (${p.breed ?? "mixed breed"}${p.age != null ? `, age ${p.age}` : ""})` +
    (p.grooming_notes ? ` — note: ${p.grooming_notes}` : "")
  );
  const recentLines = (recent ?? []).map((a) =>
    `- ${fmt(a.date)}: ${SERVICE_LABELS[a.service_type] ?? a.service_type}${a.notes ? ` — ${a.notes}` : ""}`
  );

  const prompt = [
    `Client: the ${hh.name} household${hh.is_vip ? " (VIP client)" : ""}`,
    "",
    "Dogs:",
    ...(petLines.length ? petLines : ["- (none on file)"]),
    "",
    "Recent visits:",
    ...(recentLines.length ? recentLines : ["- (none on file)"]),
    "",
    `Purpose of this email: ${purpose}`,
    `Today's date: ${fmt(todayETString())}`,
  ].join("\n");

  return { householdId, prompt };
}

export async function generateDraft(
  supabase: SupabaseClient,
  source: ServiceKind,
  sourceId: string
): Promise<GenerateResult> {
  const ctx = await buildContext(supabase, source, sourceId);
  if (!ctx) return { ok: false, reason: "Service not found" };

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: ctx.prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "Rate limited — try again shortly" };
    if (err instanceof Anthropic.APIError) return { ok: false, reason: `Claude API error ${err.status}` };
    throw err;
  }

  // A declined or truncated draft is simply not created — the outreach falls
  // back to the standard template, which is the designed behavior.
  if (response.stop_reason === "refusal") return { ok: false, reason: "Draft declined — standard template will send" };
  if (response.stop_reason === "max_tokens") return { ok: false, reason: "Draft was cut off — try regenerating" };

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return { ok: false, reason: "Empty draft" };

  let parsed: { subject: string; body: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Draft was not valid JSON" };
  }

  const { data, error } = await supabase
    .from("outreach_drafts")
    .upsert(
      {
        household_id: ctx.householdId,
        source,
        source_id: sourceId,
        subject: unescapeUnicode(parsed.subject.trim()),
        body: unescapeUnicode(parsed.body.trim()),
        status: "needs_review",
        edited: false,
        reviewed_at: null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "source,source_id" }
    )
    .select(DRAFT_COLUMNS)
    .single();

  if (error || !data) return { ok: false, reason: error?.message ?? "Failed to save draft" };
  return { ok: true, draft: data as OutreachDraft };
}
