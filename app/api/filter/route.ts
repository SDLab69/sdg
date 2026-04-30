/**
 * POST /api/filter
 *
 * Accepts a natural language query, calls Claude Haiku to parse it into a
 * structured filter, runs that filter against Supabase, and returns the
 * matching households with their pets and service clock data.
 *
 * Request body:
 *   { "query": "black labs overdue for grooming" }
 *
 * Success response:
 *   { "filters": [...], "logic": "AND" | "OR", "results": [...] }
 *
 * LLM error response (HTTP 200 — the LLM understood the request but can't
 * resolve it to a valid filter):
 *   { "error": "unsupported_field" | "ambiguous_query" | "unknown_value" | "empty_query",
 *     "message": "...", "suggestion"?: "..." }
 *
 * HTTP error responses:
 *   400 — missing or invalid request body
 *   401 — unauthenticated (see TODO below)
 *   500 — unexpected server error
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/src/lib/filters/system-prompt";
import { LLMResponse, FilterQuery } from "@/src/lib/filters/filter-schema";
import { applyFilter } from "@/src/lib/filters/apply-filter";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// The columns we return for each household in results.
// Keeping this explicit avoids accidentally leaking new columns.
const HOUSEHOLD_SELECT = `
  id,
  name,
  phone,
  email,
  address,
  is_vip,
  created_at,
  pets!inner (
    id,
    name,
    breed,
    age,
    weight,
    grooming_notes,
    fur_color,
    coat_type,
    size,
    temperament,
    medical_flags
  ),
  service_clocks (
    last_visit,
    last_full_groom,
    next_brush_due,
    next_full_groom_due
  )
`.trim();

export async function POST(req: NextRequest) {
  // ── TODO: add auth check once login is wired up ──────────────────────────
  // const supabase = createClient();
  // const { data: { user } } = await supabase.auth.getUser();
  // if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  // ─────────────────────────────────────────────────────────────────────────

  // 1. Parse and validate request body
  let query: string;
  try {
    const body = await req.json();
    if (!body || typeof body.query !== "string" || !body.query.trim()) {
      return NextResponse.json(
        { error: "Bad request", message: "Request body must include a non-empty 'query' string." },
        { status: 400 }
      );
    }
    query = body.query.trim();
  } catch {
    return NextResponse.json(
      { error: "Bad request", message: "Could not parse request body as JSON." },
      { status: 400 }
    );
  }

  // 2. Call Claude Haiku to parse the query into a structured filter
  let llmResponse: LLMResponse;
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: query }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

    llmResponse = LLMResponse.parse(JSON.parse(cleaned));
  } catch (err) {
    console.error("[filter] LLM call or parse failed:", err);
    return NextResponse.json(
      { error: "Server error", message: "Failed to process your query. Please try again." },
      { status: 500 }
    );
  }

  // 3. If the LLM returned an error shape, pass it through to the client
  //    (HTTP 200 — this is a resolved outcome, not a server failure)
  if ("error" in llmResponse) {
    return NextResponse.json(llmResponse, { status: 200 });
  }

  // 4. We have a valid filter — run it against Supabase
  const filter = llmResponse as FilterQuery;
  try {
    const supabase = createClient();

    // TODO: RLS is currently permissive (using (true)). Tighten once auth is added.
    let q = supabase.from("households").select(HOUSEHOLD_SELECT);

    for (const f of filter.filters) {
      q = applyFilter(q, f);
    }

    const { data, error } = await q;

    if (error) {
      console.error("[filter] Supabase query failed:", error);
      return NextResponse.json(
        { error: "Server error", message: "Database query failed. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      filters: filter.filters,
      logic: filter.logic,
      results: data ?? [],
    });
  } catch (err) {
    console.error("[filter] Unexpected error:", err);
    return NextResponse.json(
      { error: "Server error", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
