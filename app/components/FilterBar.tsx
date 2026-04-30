"use client";

import { useRef, useState } from "react";
import { Filter } from "@/src/lib/filters/filter-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

// Shape of each household returned by POST /api/filter
type ApiPet = {
  breed: string | null;
  age: number | null;
  weight: number | null;
  grooming_notes: string | null;
  fur_color: string | null;
  coat_type: string | null;
  size: string | null;
  temperament: string | null;
  medical_flags: string[] | null;
};

type ApiClock = {
  last_visit: string | null;
  last_full_groom: string | null;
  next_brush_due: string | null;
  next_full_groom_due: string | null;
};

type ApiHousehold = {
  id: string;
  is_vip: boolean;
  pets: ApiPet[];
  service_clocks: ApiClock[] | null;
  [key: string]: unknown; // household-level columns (name, address, created_at, …)
};

type LLMError = {
  error: string;
  message: string;
  suggestion?: string;
};

export interface FilterBarProps {
  onFilter: (ids: Set<string> | null) => void;
}

// ─── Chip label formatting ────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  "household.name": "Name",
  "household.is_vip": "VIP",
  "household.address": "Address",
  "household.created_at": "Client since",
  "pet.breed": "Breed",
  "pet.age": "Age (yrs)",
  "pet.weight": "Weight (lbs)",
  "pet.grooming_notes": "Notes",
  "pet.fur_color": "Color",
  "pet.coat_type": "Coat",
  "pet.size": "Size",
  "pet.temperament": "Temperament",
  "pet.medical_flags": "Flag",
  "service.last_visit": "Last visit",
  "service.last_full_groom": "Last full groom",
  "service.next_brush_due": "Brush due",
  "service.next_full_groom_due": "Full groom due",
  "appointment.date": "Appointment",
  "appointment.service_type": "Service",
  "appointment.is_adhoc": "Ad hoc",
};

const OP_LABELS: Record<string, string> = {
  contains: "contains",
  before: "before",
  after: "after",
  greater_than: ">",
  less_than: "<",
  between: "between",
  contains_any: "any of",
  contains_all: "all of",
};

function formatDateVal(iso: string, todayISO: string): string {
  if (iso === todayISO) return "today";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatVal(v: unknown, todayISO: string): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map((x) => formatVal(x, todayISO)).join(", ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return formatDateVal(v, todayISO);
  return String(v);
}

function chipLabel(f: Filter, todayISO: string): string {
  const label = FIELD_LABELS[f.field] ?? f.field;

  if (f.op === "between" && Array.isArray(f.value)) {
    return `${label}: ${formatVal(f.value[0], todayISO)} – ${formatVal(f.value[1], todayISO)}`;
  }
  // equals / in_list — op is implicit
  if (f.op === "equals" || f.op === "in_list") {
    return `${label}: ${formatVal(f.value, todayISO)}`;
  }
  const opLabel = OP_LABELS[f.op] ?? f.op;
  return `${label}: ${opLabel} ${formatVal(f.value, todayISO)}`;
}

// ─── Client-side re-filter (used when chips are removed) ─────────────────────
// Mirrors applyFilter logic but runs in-memory against the API result objects
// so we don't need an extra network call when the user removes a chip.

function applyOp(
  val: unknown,
  op: string,
  filterVal: unknown,
  isTags = false
): boolean {
  if (val === null || val === undefined) return false;
  switch (op) {
    case "equals":
      return val === filterVal;
    case "contains":
      if (isTags && Array.isArray(val))
        return val.includes(filterVal as string);
      return String(val).toLowerCase().includes(String(filterVal).toLowerCase());
    case "contains_any":
      return (
        Array.isArray(val) &&
        (filterVal as string[]).some((v) => val.includes(v))
      );
    case "contains_all":
      return (
        Array.isArray(val) &&
        (filterVal as string[]).every((v) => val.includes(v))
      );
    case "in_list":
      return (filterVal as string[]).includes(val as string);
    case "greater_than":
      return Number(val) > Number(filterVal);
    case "less_than":
      return Number(val) < Number(filterVal);
    case "before":
      return String(val) < String(filterVal);
    case "after":
      return String(val) > String(filterVal);
    case "between": {
      const [a, b] = filterVal as [unknown, unknown];
      return String(val) >= String(a) && String(val) <= String(b);
    }
    default:
      return true;
  }
}

function matchesFilter(hh: ApiHousehold, f: Filter): boolean {
  const [table, col] = f.field.split(".");

  if (table === "household") {
    return applyOp(hh[col], f.op, f.value);
  }

  if (table === "pet") {
    return (hh.pets ?? []).some((pet) =>
      applyOp(
        (pet as Record<string, unknown>)[col],
        f.op,
        f.value,
        f.field === "pet.medical_flags"
      )
    );
  }

  if (table === "service") {
    // service field names match service_clocks columns 1-to-1
    const clock = hh.service_clocks?.[0];
    if (!clock) return false;
    return applyOp(
      (clock as Record<string, unknown>)[col],
      f.op,
      f.value
    );
  }

  // appointment filters aren't embedded in the API result — treat as passing
  return true;
}

function matchesAll(
  hh: ApiHousehold,
  filters: Filter[],
  logic: "AND" | "OR"
): boolean {
  if (filters.length === 0) return true;
  const hits = filters.map((f) => matchesFilter(hh, f));
  return logic === "AND" ? hits.every(Boolean) : hits.some(Boolean);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FilterBar({ onFilter }: FilterBarProps) {
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [llmError, setLlmError] = useState<LLMError | null>(null);
  const [activeFilters, setActiveFilters] = useState<Filter[]>([]);
  const [logic, setLogic] = useState<"AND" | "OR">("AND");
  const [baseResults, setBaseResults] = useState<ApiHousehold[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable today string for chip labels — recalculated per render is fine
  // (this component rarely re-renders without user action).
  const todayISO = new Date().toISOString().slice(0, 10);

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submit(override?: string) {
    const query = (override ?? inputValue).trim();
    if (!query) return;

    // Cancel any in-flight request before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setLlmError(null);

    try {
      const res = await fetch("/api/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      const data = await res.json();

      // LLM returned a structured error (not our server's fault — HTTP 200)
      if ("error" in data) {
        setLlmError(data as LLMError);
        setStatus("idle");
        return;
      }

      // Success — store results and surface filtered IDs to parent
      const results: ApiHousehold[] = data.results ?? [];
      setActiveFilters(data.filters ?? []);
      setLogic(data.logic ?? "AND");
      setBaseResults(results);
      onFilter(new Set(results.map((r) => r.id)));
      setStatus("idle");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
    }
  }

  // ── Chip removal ──────────────────────────────────────────────────────────
  function removeChip(index: number) {
    const remaining = activeFilters.filter((_, i) => i !== index);
    setActiveFilters(remaining);

    if (remaining.length === 0 || !baseResults) {
      setBaseResults(null);
      onFilter(null);
      return;
    }

    // Re-filter the stored API results client-side — no extra network call
    const reFiltered = baseResults.filter((hh) =>
      matchesAll(hh, remaining, logic)
    );
    onFilter(new Set(reFiltered.map((r) => r.id)));
  }

  // ── Clear all ─────────────────────────────────────────────────────────────
  function clearAll() {
    abortRef.current?.abort();
    setActiveFilters([]);
    setBaseResults(null);
    setLlmError(null);
    setInputValue("");
    setStatus("idle");
    onFilter(null);
  }

  // ── Suggestion click — populate input and re-run ──────────────────────────
  function handleSuggestionClick(suggestion: string) {
    setInputValue(suggestion);
    submit(suggestion);
  }

  const hasChips = activeFilters.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mb-5">
      {/* Search row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Try: black labs overdue for grooming"
          disabled={status === "loading"}
          className="flex-1 px-3 py-2 text-sm border border-border rounded bg-cream placeholder-ink-3 focus:outline-none focus:ring-1 focus:ring-terra disabled:opacity-60 transition-opacity"
        />
        <button
          onClick={() => submit()}
          disabled={status === "loading" || !inputValue.trim()}
          className={[
            "flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold tracking-wide rounded transition-all disabled:opacity-40",
            inputValue.trim()
              ? "bg-terra text-white hover:opacity-90"
              : "bg-white border border-border text-ink-3",
          ].join(" ")}
        >
          {status === "loading" ? (
            <>
              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Thinking…
            </>
          ) : (
            "Filter"
          )}
        </button>
      </div>

      {/* Network / server error */}
      {status === "error" && (
        <p className="mt-2 px-3 py-2 text-sm text-terra bg-terra-pale border border-terra/20 rounded">
          Something went wrong — please try again.
        </p>
      )}

      {/* LLM error banner */}
      {llmError && (
        <div className="mt-2 px-3 py-2.5 text-sm bg-amber-pale border border-amber/30 rounded flex items-start gap-2">
          <span className="text-amber shrink-0 mt-px">⚠</span>
          <p className="text-ink-2 leading-snug">
            {llmError.message}
            {llmError.suggestion && (
              <>
                {" "}
                <button
                  onClick={() => handleSuggestionClick(llmError.suggestion!)}
                  className="underline underline-offset-2 text-ink-2 hover:text-terra transition-colors"
                >
                  {llmError.suggestion}
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {/* Example query suggestions — shown when no active filters */}
      {!hasChips && !llmError && status !== "error" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Senior dogs", "VIPs overdue for grooming", "Clients I haven't seen in 3 months"].map((s) => (
            <button
              key={s}
              onClick={() => handleSuggestionClick(s)}
              className="px-2.5 py-0.5 rounded-full border border-border text-[11px] text-ink-3 hover:text-ink hover:border-ink-3 transition-colors bg-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Active filter chips */}
      {hasChips && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-cream-2 text-[12px] text-ink"
            >
              {chipLabel(f, todayISO)}
              <button
                onClick={() => removeChip(i)}
                aria-label="Remove filter"
                className="ml-0.5 text-ink-3 hover:text-terra transition-colors leading-none"
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={clearAll}
            className="text-[12px] text-ink-3 hover:text-ink underline underline-offset-2 transition-colors ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
