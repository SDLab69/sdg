/**
 * Test harness for the filter-parsing prompt.
 *
 * Run with: `npx tsx run-tests.ts`
 *
 * What it does:
 *   1. For each test case, calls Claude with the system prompt + user query
 *   2. Parses the JSON response and validates it with Zod
 *   3. Checks that expected fields appear (or expected error type)
 *   4. If the test has expectMinResults, translates the filter to SQL,
 *      runs it against Supabase, and checks the row count
 *   5. Prints a colorized pass/fail report
 *
 * Requires env vars:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (service role — this is a test harness, not production)
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { buildSystemPrompt } from "./system-prompt";
import { LLMResponse, FilterQuery } from "./filter-schema";
import { applyFilter } from "./apply-filter";
import { TEST_CASES, TestCase } from "./test-cases";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Call Claude, get filter JSON back
// ---------------------------------------------------------------------------

async function parseFilter(query: string): Promise<{
  raw: string;
  parsed: LLMResponse | null;
  parseError?: string;
}> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: query }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text.trim() : "";

  // Strip markdown fences if the model added them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

  try {
    const json = JSON.parse(cleaned);
    const parsed = LLMResponse.parse(json);
    return { raw, parsed };
  } catch (err) {
    return {
      raw,
      parsed: null,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Translate a filter into a Supabase query and get the row count
// ---------------------------------------------------------------------------
// This is a minimal translator for the test harness. The real production
// version will live in the API route and may differ. For now we build
// a single query on households joined with pets and service_clocks so
// most of the test cases resolve.

async function countResults(filter: FilterQuery): Promise<number> {
  // Join household + pets + service_clocks. Appointments is a separate
  // query path — we skip those for the simple count check.
  let q = supabase.from("households").select(
    `
    id,
    is_vip,
    created_at,
    pets!inner (
      breed, age, weight, grooming_notes,
      fur_color, coat_type, size, temperament, medical_flags
    ),
    service_clocks (
      last_visit, last_full_groom, next_brush_due, next_full_groom_due
    )
  `,
    { count: "exact", head: true }
  );

  for (const f of filter.filters) {
    q = applyFilter(q, f);
  }

  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Test case evaluation
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  query: string;
  passed: boolean;
  details: string[];
  raw: string;
}

async function runTest(tc: TestCase): Promise<TestResult> {
  const details: string[] = [];
  const { raw, parsed, parseError } = await parseFilter(tc.query);

  if (parseError || !parsed) {
    return {
      name: tc.name,
      query: tc.query,
      passed: false,
      details: [`JSON/Zod parse failed: ${parseError ?? "no output"}`],
      raw,
    };
  }

  // Check error type if expected
  if (tc.expectError) {
    if ("error" in parsed && parsed.error === tc.expectError) {
      return { name: tc.name, query: tc.query, passed: true, details: [`error=${parsed.error}`], raw };
    }
    return {
      name: tc.name,
      query: tc.query,
      passed: false,
      details: [`expected error '${tc.expectError}', got ${"error" in parsed ? parsed.error : "a filter"}`],
      raw,
    };
  }

  // Expected a filter but got an error
  if ("error" in parsed) {
    return {
      name: tc.name,
      query: tc.query,
      passed: false,
      details: [`expected filter, got error '${parsed.error}': ${parsed.message}`],
      raw,
    };
  }

  // Check expected fields are present
  const actualFields = parsed.filters.map((f) => f.field);
  const missing = tc.expectFields.filter((f) => !(actualFields as string[]).includes(f));
  if (missing.length > 0) {
    details.push(`missing fields: ${missing.join(", ")}`);
    details.push(`actual fields: ${actualFields.join(", ")}`);
  } else {
    details.push(`fields ✓ (${actualFields.join(", ")})`);
  }

  // Optionally check row count
  if (tc.expectMinResults !== undefined || tc.expectZeroResults) {
    try {
      const count = await countResults(parsed);
      if (tc.expectZeroResults && count !== 0) {
        details.push(`expected 0 results, got ${count}`);
      } else if (tc.expectMinResults !== undefined && count < tc.expectMinResults) {
        details.push(`expected ≥${tc.expectMinResults} results, got ${count}`);
      } else {
        details.push(`rows: ${count}`);
      }
    } catch (err) {
      details.push(`supabase query failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const passed = missing.length === 0 && !details.some((d) => d.startsWith("expected") || d.includes("failed"));
  return { name: tc.name, query: tc.query, passed, details, raw };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(c.bold(`\nRunning ${TEST_CASES.length} filter tests...\n`));

  const results: TestResult[] = [];
  for (const tc of TEST_CASES) {
    process.stdout.write(c.gray(`  ${tc.name}... `));
    const r = await runTest(tc);
    results.push(r);
    console.log(r.passed ? c.green("PASS") : c.red("FAIL"));
  }

  console.log("\n" + c.bold("Results:"));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`  ${c.green(`${passed} passed`)}, ${failed > 0 ? c.red(`${failed} failed`) : "0 failed"}`);

  // Print failures in detail
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log("\n" + c.bold(c.red("Failures:")));
    for (const f of failures) {
      console.log(`\n  ${c.bold(f.name)}`);
      console.log(`  ${c.gray("Query:")} ${f.query}`);
      for (const d of f.details) console.log(`  ${c.gray("-")} ${d}`);
      console.log(`  ${c.gray("Raw:")} ${f.raw.slice(0, 300)}${f.raw.length > 300 ? "..." : ""}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red("Fatal error:"), err);
  process.exit(1);
});
