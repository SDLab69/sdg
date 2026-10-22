/**
 * POST /api/drafts/generate
 *
 * Single draft:  { "source": "full_groom" | "brush_nail", "sourceId": "<uuid>" }
 *   → { draft } or { error }
 *
 * Backfill:      { "backfill": true, "pastDays"?: number }
 *   Writes a draft for every full groom / brush & nail whose outreach date falls in
 *   [today - pastDays, today + DRAFT_LEAD_DAYS] and has no draft yet. Ad hoc
 *   requests are handled in person, so they never get drafts. This is what a
 *   nightly job would run; here it seeds the demo.
 *   → { generated, failed: [{ key, reason }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateDraft } from "@/lib/drafts/generate";
import { DRAFT_LEAD_DAYS, addDays, draftKey, type ServiceKind } from "@/lib/engagement";
import { todayETString } from "@/lib/utils/dates";

export const maxDuration = 300;

const SOURCES: ServiceKind[] = ["full_groom", "brush_nail"];
const CONCURRENCY = 4;

export async function POST(req: NextRequest) {
  let body: { source?: string; sourceId?: string; backfill?: boolean; pastDays?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Could not parse request body as JSON." }, { status: 400 });
  }

  const supabase = createClient();

  if (!body.backfill) {
    if (!SOURCES.includes(body.source as ServiceKind) || typeof body.sourceId !== "string") {
      return NextResponse.json({ error: "Expected { source, sourceId }." }, { status: 400 });
    }
    const result = await generateDraft(supabase, body.source as ServiceKind, body.sourceId);
    return result.ok
      ? NextResponse.json({ draft: result.draft })
      : NextResponse.json({ error: result.reason }, { status: 422 });
  }

  // ── Backfill ───────────────────────────────────────────────────────────────
  const today = todayETString();
  const from = addDays(today, -(body.pastDays ?? 0));
  const to = addDays(today, DRAFT_LEAD_DAYS);

  const [{ data: clocks }, { data: existing }] = await Promise.all([
    supabase.from("service_clocks").select("id, next_brush_due, next_full_groom_due, brush_outreach_trigger, full_groom_outreach_trigger"),
    supabase.from("outreach_drafts").select("source, source_id"),
  ]);

  const have = new Set((existing ?? []).map((d) => draftKey(d.source, d.source_id)));
  const inWindow = (d: string | null) => !!d && d >= from && d <= to;

  const todo: { source: ServiceKind; sourceId: string }[] = [];
  for (const c of clocks ?? []) {
    if (inWindow(c.full_groom_outreach_trigger ?? c.next_full_groom_due)) todo.push({ source: "full_groom", sourceId: c.id });
    if (inWindow(c.brush_outreach_trigger ?? c.next_brush_due)) todo.push({ source: "brush_nail", sourceId: c.id });
  }
  const pending = todo.filter((t) => !have.has(draftKey(t.source, t.sourceId)));

  let generated = 0;
  const failed: { key: string; reason: string }[] = [];
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((t) => generateDraft(supabase, t.source, t.sourceId)));
    results.forEach((r, j) => {
      if (r.ok) generated++;
      else failed.push({ key: draftKey(batch[j].source, batch[j].sourceId), reason: r.reason });
    });
  }

  return NextResponse.json({ generated, failed, window: { from, to } });
}
