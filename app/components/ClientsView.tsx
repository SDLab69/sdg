"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NavBar from "./NavBar";
import FilterBar from "./FilterBar";
import { todayET } from "@/lib/utils/dates";

// ─── Types ────────────────────────────────────────────────────────────────────

type Household = { id: string; name: string; is_vip: boolean };
type PetStub = {
  household_id: string;
  breed: string | null;
  age: number | null;
  weight: number | null;
};
type ServiceClock = {
  household_id: string;
  next_brush_due: string | null;
  next_full_groom_due: string | null;
  last_visit: string | null;
};

type ServiceKind = "full_groom" | "brush_nail";
type RowStatus = "overdue" | "due_soon" | "current" | "unknown";
type StatusFilter = "all" | "overdue" | "due_soon" | "current";
type ServiceFilter = "either" | "brush_nail" | "full_groom";

type ClientRow = {
  id: string;
  name: string;
  isVip: boolean;
  petCount: number;
  petBreeds: string[];
  petAges: number[];
  petWeights: number[];
  nextDueDate: string | null;
  nextDueService: ServiceKind | null;
  daysUntilDue: number | null;
  lastVisit: string | null;
  status: RowStatus;
};

type SortKey = "name" | "next_due" | "last_visit";
type SortDir = "asc" | "desc";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const DUE_SOON_DAYS = 42; // 6-week outreach window
const AGE_MIN = 2;
const AGE_MAX = 9;
const WEIGHT_MIN = 5;
const WEIGHT_MAX = 142;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ymd: string | null): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatShortDate(ymd: string | null): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

function computeDaysUntil(ymd: string | null): number | null {
  if (!ymd) return null;
  const today = todayET();
  const due = new Date(ymd + "T00:00:00");
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function daysLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `in ${days}d`;
}

function daysColor(days: number | null): string {
  if (days === null) return "text-ink-3";
  if (days <= 0) return "text-terra font-semibold";
  if (days <= 14) return "text-amber font-semibold";
  return "text-ink-3";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SegmentedGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-border overflow-hidden w-full">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "flex-1 px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap",
            i > 0 ? "border-l border-border" : "",
            opt.value === value
              ? "bg-ink text-white border-ink"
              : "bg-white text-ink-2 hover:bg-cream",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [lo, hi] = value;
  const range = max - min;
  const loPercent = ((lo - min) / range) * 100;
  const hiPercent = ((hi - min) / range) * 100;

  return (
    <div className="relative" style={{ height: 20 }}>
      {/* Track background */}
      <div
        className="absolute rounded-full"
        style={{
          left: 0, right: 0, top: "50%", transform: "translateY(-50%)",
          height: 6, backgroundColor: "#DDD0BC",
        }}
      >
        {/* Active fill */}
        <div
          className="absolute h-full rounded-full"
          style={{
            backgroundColor: "#8B3220",
            left: `${loPercent}%`,
            right: `${100 - hiPercent}%`,
          }}
        />
      </div>
      {/* Low thumb */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), hi);
          onChange([v, hi]);
        }}
        className="range-thumb"
        style={{ zIndex: lo >= hi ? 5 : 3 }}
      />
      {/* High thumb */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), lo);
          onChange([lo, v]);
        }}
        className="range-thumb"
        style={{ zIndex: lo >= hi ? 3 : 5 }}
      />
    </div>
  );
}

function BreedDropdown({
  breeds,
  selected,
  onChange,
}: {
  breeds: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const visible = useMemo(
    () =>
      query.trim()
        ? breeds.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
        : breeds,
    [breeds, query]
  );

  function toggle(breed: string) {
    onChange(
      selected.includes(breed)
        ? selected.filter((b) => b !== breed)
        : [...selected, breed]
    );
  }

  const buttonLabel =
    selected.length === 0
      ? "Any breed"
      : selected.length === 1
      ? selected[0]
      : `${selected.length} breeds`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm border rounded transition-colors",
          selected.length > 0
            ? "bg-ink border-ink text-white"
            : "bg-white border-border text-ink-2 hover:bg-cream",
        ].join(" ")}
      >
        <span className="truncate text-left text-[12px]">{buttonLabel}</span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-xl z-30 overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search breeds…"
              className="w-full px-2 py-1 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-terra/40"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-3 italic">No breeds match</p>
            ) : (
              visible.map((breed) => (
                <label
                  key={breed}
                  className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-cream cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(breed)}
                    onChange={() => toggle(breed)}
                    className="accent-terra w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-xs text-ink leading-tight">{breed}</span>
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] text-terra hover:underline"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ClientsView() {
  // NL filter state — set by FilterBar, consumed by the filtered useMemo
  const [filteredHouseholdIds, setFilteredHouseholdIds] = useState<Set<string> | null>(null);
  const supabase = useRef(createClient()).current;
  const router = useRouter();

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [households, setHouseholds] = useState<Household[]>([]);
  const [pets, setPets] = useState<PetStub[]>([]);
  const [clocks, setClocks] = useState<ServiceClock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: hh }, { data: pp }, { data: sc }] = await Promise.all([
        supabase.from("households").select("id, name, is_vip"),
        supabase.from("pets").select("household_id, breed, age, weight"),
        supabase
          .from("service_clocks")
          .select("household_id, next_brush_due, next_full_groom_due, last_visit"),
      ]);
      setHouseholds(hh ?? []);
      setPets((pp ?? []) as PetStub[]);
      setClocks(sc ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  // Filter panel
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("either");
  const [breedFilter, setBreedFilter] = useState<string[]>([]);
  const [ageRange, setAgeRange] = useState<[number, number]>([AGE_MIN, AGE_MAX]);
  const [weightRange, setWeightRange] = useState<[number, number]>([WEIGHT_MIN, WEIGHT_MAX]);
  const [vipFilter, setVipFilter] = useState(false);

  // Reset page when any filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, serviceFilter, breedFilter, vipFilter, ageRange, weightRange]);

  // ── Derived: distinct breeds ──────────────────────────────────────────────────
  const distinctBreeds = useMemo(() => {
    const seen = new Set<string>();
    for (const p of pets) {
      if (p.breed?.trim()) seen.add(p.breed.trim());
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [pets]);

  // ── Derived: active filter count ──────────────────────────────────────────────
  const activeFilterCount = useMemo(
    () =>
      [
        statusFilter !== "all",
        serviceFilter !== "either",
        breedFilter.length > 0,
        vipFilter,
        ageRange[0] !== AGE_MIN || ageRange[1] !== AGE_MAX,
        weightRange[0] !== WEIGHT_MIN || weightRange[1] !== WEIGHT_MAX,
      ].filter(Boolean).length,
    [statusFilter, serviceFilter, breedFilter, vipFilter, ageRange, weightRange]
  );

  function clearAllFilters() {
    setStatusFilter("all");
    setServiceFilter("either");
    setBreedFilter([]);
    setAgeRange([AGE_MIN, AGE_MAX]);
    setWeightRange([WEIGHT_MIN, WEIGHT_MAX]);
    setVipFilter(false);
  }

  // ── Derived: build ClientRow[] ────────────────────────────────────────────────
  const allRows = useMemo((): ClientRow[] => {
    const petMap: Record<string, PetStub[]> = {};
    for (const p of pets) {
      if (!petMap[p.household_id]) petMap[p.household_id] = [];
      petMap[p.household_id].push(p);
    }
    const clockMap = Object.fromEntries(clocks.map((c) => [c.household_id, c]));

    return households.map((hh) => {
      const housePets = petMap[hh.id] ?? [];
      const petCount = housePets.length;
      const petBreeds = housePets.map((p) => p.breed).filter((b): b is string => !!b?.trim());
      const petAges = housePets.map((p) => p.age).filter((a): a is number => a != null);
      const petWeights = housePets.map((p) => p.weight).filter((w): w is number => w != null);

      const clock = clockMap[hh.id];
      if (!clock) {
        return {
          id: hh.id, name: hh.name, isVip: hh.is_vip,
          petCount, petBreeds, petAges, petWeights,
          nextDueDate: null, nextDueService: null, daysUntilDue: null,
          lastVisit: null, status: "unknown",
        };
      }

      let nextDueDate: string | null = null;
      let nextDueService: ServiceKind | null = null;
      const bd = clock.next_brush_due;
      const fg = clock.next_full_groom_due;
      if (bd && fg) {
        if (bd <= fg) { nextDueDate = bd; nextDueService = "brush_nail"; }
        else          { nextDueDate = fg; nextDueService = "full_groom"; }
      } else if (bd) { nextDueDate = bd; nextDueService = "brush_nail"; }
      else if (fg)   { nextDueDate = fg; nextDueService = "full_groom"; }

      const daysUntilDue = computeDaysUntil(nextDueDate);
      const status: RowStatus =
        daysUntilDue === null      ? "unknown"
        : daysUntilDue < 0        ? "overdue"
        : daysUntilDue <= DUE_SOON_DAYS ? "due_soon"
        : "current";

      return {
        id: hh.id, name: hh.name, isVip: hh.is_vip,
        petCount, petBreeds, petAges, petWeights,
        nextDueDate, nextDueService, daysUntilDue,
        lastVisit: clock.last_visit,
        status,
      };
    });
  }, [households, pets, clocks]);

  // ── Derived: filtered ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = allRows;

    // NL filter gate — when active, only show households returned by the API
    if (filteredHouseholdIds !== null) {
      rows = rows.filter((r) => filteredHouseholdIds.has(r.id));
    }

    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.status === statusFilter);
    }

    if (serviceFilter !== "either") {
      rows = rows.filter((r) => r.nextDueService === serviceFilter);
    }

    if (vipFilter) {
      rows = rows.filter((r) => r.isVip);
    }

    if (breedFilter.length > 0) {
      const breedSet = new Set(breedFilter);
      rows = rows.filter((r) => r.petBreeds.some((b) => breedSet.has(b)));
    }

    const ageActive = ageRange[0] !== AGE_MIN || ageRange[1] !== AGE_MAX;
    if (ageActive) {
      rows = rows.filter((r) =>
        r.petAges.some((a) => a >= ageRange[0] && a <= ageRange[1])
      );
    }

    const weightActive = weightRange[0] !== WEIGHT_MIN || weightRange[1] !== WEIGHT_MAX;
    if (weightActive) {
      rows = rows.filter((r) =>
        r.petWeights.some((w) => w >= weightRange[0] && w <= weightRange[1])
      );
    }

    return rows;
  }, [allRows, filteredHouseholdIds, statusFilter, serviceFilter, vipFilter, breedFilter, ageRange, weightRange]);

  // ── Derived: sorted ───────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "next_due") {
        if (!a.nextDueDate && !b.nextDueDate) cmp = 0;
        else if (!a.nextDueDate) cmp = 1;
        else if (!b.nextDueDate) cmp = -1;
        else cmp = a.nextDueDate.localeCompare(b.nextDueDate);
      } else {
        if (!a.lastVisit && !b.lastVisit) cmp = 0;
        else if (!a.lastVisit) cmp = 1;
        else if (!b.lastVisit) cmp = -1;
        else cmp = b.lastVisit.localeCompare(a.lastVisit);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  // ── Derived: paginated ────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  // ── Sub-components (inline, use outer scope) ──────────────────────────────────
  function SortIndicator({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="ml-1 text-border">↕</span>;
    return <span className="ml-1 text-ink">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function StatusBadge({ status }: { status: RowStatus }) {
    if (status === "overdue")
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-terra text-white">Overdue</span>;
    if (status === "due_soon")
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-terra-pale text-terra">Due soon</span>;
    if (status === "current")
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-sage-pale text-sage">Current</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-cream-2 text-ink-3">No data</span>;
  }

  // ── Filter label helpers ──────────────────────────────────────────────────────
  const filterLabel = (
    <span className="flex items-center gap-1.5">
      <svg width="13" height="11" viewBox="0 0 13 11" fill="none" aria-hidden>
        <path d="M1 1h11M3 5.5h7M5 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Filters
      {activeFilterCount > 0 && (
        <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-terra text-white leading-none">
          {activeFilterCount}
        </span>
      )}
    </span>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <NavBar />

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-border px-6 h-12 flex items-center gap-4 shrink-0">
        <h1 className="text-lg font-bold text-ink">Clients</h1>
        <span className="text-sm text-ink-3">
          {loading ? "—" : `${filtered.length} households`}
        </span>
      </div>

      {/* ── NL Filter bar ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-4 pb-1 bg-white border-b border-border shrink-0">
        <FilterBar onFilter={setFilteredHouseholdIds} />
      </div>

      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div className="px-6 py-3 flex items-center gap-3 bg-white border-b border-border shrink-0">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className={[
            "flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-bold border transition-colors",
            filtersOpen || activeFilterCount > 0
              ? "bg-cream-2 border-border text-ink"
              : "bg-white border-border text-ink-3 hover:text-ink hover:bg-cream",
          ].join(" ")}
        >
          {filterLabel}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="text-[11px] text-terra hover:underline shrink-0"
          >
            Clear all
          </button>
        )}

        {!loading && sorted.length > 0 && (
          <span className="ml-auto text-xs text-ink-3">
            {(safePage - 1) * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
        )}
      </div>

      {/* ── Filter panel ──────────────────────────────────────────────────── */}
      {filtersOpen && (
        <div className="bg-cream-2 border-b border-border shrink-0">
          <div className="px-6 py-4">
            {/* Row 1: Status · Service · VIP */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {/* Status */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-1.5">
                  Status
                </p>
                <SegmentedGroup<StatusFilter>
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "overdue", label: "Overdue" },
                    { value: "due_soon", label: "Due soon" },
                    { value: "current", label: "Current" },
                  ]}
                />
              </div>

              {/* Service type */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-1.5">
                  Service Type Due
                </p>
                <SegmentedGroup<ServiceFilter>
                  value={serviceFilter}
                  onChange={setServiceFilter}
                  options={[
                    { value: "either", label: "Either" },
                    { value: "brush_nail", label: "Brush & Nail" },
                    { value: "full_groom", label: "Full Groom" },
                  ]}
                />
              </div>

              {/* VIP */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-1.5">
                  VIP
                </p>
                <button
                  type="button"
                  onClick={() => setVipFilter((v) => !v)}
                  className={[
                    "flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold border transition-colors",
                    vipFilter
                      ? "bg-ink text-white border-ink"
                      : "bg-white border-border text-ink-2 hover:bg-cream",
                  ].join(" ")}
                >
                  <span className="text-[10px]">◆</span>
                  VIP clients only
                </button>
              </div>
            </div>

            {/* Row 2: Breed · Age · Weight */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Breed */}
              <div>
                <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-1.5">
                  Breed
                </p>
                <BreedDropdown
                  breeds={distinctBreeds}
                  selected={breedFilter}
                  onChange={setBreedFilter}
                />
              </div>

              {/* Age range */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                    Age
                  </p>
                  <span className="text-[11px] font-medium text-ink tabular-nums">
                    {ageRange[0] === AGE_MIN && ageRange[1] === AGE_MAX
                      ? `${AGE_MIN}y – ${AGE_MAX}y`
                      : `${ageRange[0]}y – ${ageRange[1]}y`}
                  </span>
                </div>
                <RangeSlider
                  min={AGE_MIN}
                  max={AGE_MAX}
                  value={ageRange}
                  onChange={setAgeRange}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-ink-3">{AGE_MIN}y</span>
                  <span className="text-[10px] text-ink-3">{AGE_MAX}y</span>
                </div>
              </div>

              {/* Weight range */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                    Weight
                  </p>
                  <span className="text-[11px] font-medium text-ink tabular-nums">
                    {weightRange[0] === WEIGHT_MIN && weightRange[1] === WEIGHT_MAX
                      ? `${WEIGHT_MIN} – ${WEIGHT_MAX} lbs`
                      : `${weightRange[0]} – ${weightRange[1]} lbs`}
                  </span>
                </div>
                <RangeSlider
                  min={WEIGHT_MIN}
                  max={WEIGHT_MAX}
                  value={weightRange}
                  onChange={setWeightRange}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-ink-3">{WEIGHT_MIN} lbs</span>
                  <span className="text-[10px] text-ink-3">{WEIGHT_MAX} lbs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-4 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-ink-3 text-sm">
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-ink-3 text-sm">
              {activeFilterCount > 0 || filteredHouseholdIds !== null
                ? "No clients match your current filters."
                : "No households on file."}
            </p>
            {(activeFilterCount > 0 || filteredHouseholdIds !== null) && (
              <button
                onClick={clearAllFilters}
                className="text-sm text-terra hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-cream border-b border-border">
                  <th className="text-left px-4 py-2.5 font-bold text-[11px] tracking-widest text-ink-3 uppercase w-48">
                    <button onClick={() => handleSort("name")} className="flex items-center hover:text-ink transition-colors">
                      Name <SortIndicator k="name" />
                    </button>
                  </th>
                  <th className="text-center px-4 py-2.5 font-bold text-[11px] tracking-widest text-ink-3 uppercase w-20">
                    Pets
                  </th>
                  <th className="text-left px-4 py-2.5 font-bold text-[11px] tracking-widest text-ink-3 uppercase">
                    <button onClick={() => handleSort("next_due")} className="flex items-center hover:text-ink transition-colors">
                      Next Due <SortIndicator k="next_due" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 font-bold text-[11px] tracking-widest text-ink-3 uppercase w-36">
                    <button onClick={() => handleSort("last_visit")} className="flex items-center hover:text-ink transition-colors">
                      Last Visit <SortIndicator k="last_visit" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-2.5 font-bold text-[11px] tracking-widest text-ink-3 uppercase w-32">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => {
                  const isAlerted = row.status === "overdue" || (row.daysUntilDue !== null && row.daysUntilDue <= 14);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/clients/${row.id}`)}
                      className={[
                        "border-b border-border last:border-b-0 cursor-pointer transition-colors",
                        isAlerted
                          ? "bg-terra-pale/30 hover:bg-terra-pale/50"
                          : i % 2 === 0
                          ? "bg-white hover:bg-cream"
                          : "bg-cream/40 hover:bg-cream",
                      ].join(" ")}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {row.isVip && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-pale text-amber border border-amber/30 shrink-0" title="VIP client">
                              ◆ VIP
                            </span>
                          )}
                          <span className="font-semibold text-ink">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-ink-2 font-medium">{row.petCount}</span>
                      </td>
                      <td className="px-4 py-3">
                        {row.nextDueDate ? (
                          <div className="flex items-center gap-2">
                            <span className="text-ink font-medium">{formatShortDate(row.nextDueDate)}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              row.nextDueService === "full_groom"
                                ? "bg-terra-pale text-terra"
                                : "bg-amber-pale text-amber"
                            }`}>
                              {row.nextDueService === "full_groom" ? "Full" : "Brush"}
                            </span>
                            <span className={`text-[11px] ${daysColor(row.daysUntilDue)}`}>
                              {daysLabel(row.daysUntilDue)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-2 text-[13px]">
                        {formatDate(row.lastVisit)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="w-8 h-8 flex items-center justify-center rounded border border-border text-ink-3 hover:bg-cream disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-8 h-8 flex items-center justify-center rounded border text-sm font-medium transition-colors ${
                  p === safePage
                    ? "bg-terra text-white border-terra"
                    : "border-border text-ink-2 hover:bg-cream"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded border border-border text-ink-3 hover:bg-cream disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
