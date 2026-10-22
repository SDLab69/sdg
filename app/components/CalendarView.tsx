"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NavBar from "./NavBar";
import { todayET } from "@/lib/utils/dates";
import { SERVICE_LABELS } from "@/lib/terms";
import OutreachPanel, { STATE_STYLE, type PanelOutreach } from "./OutreachPanel";
import ScheduleList from "./ScheduleList";
import {
  DRAFT_COLUMNS,
  REVIEW_STATE_LABEL,
  draftKey,
  reviewState,
  type ServiceKind,
  type OutreachDraft,
  type ReviewState,
} from "@/lib/engagement";

// ─── Types ────────────────────────────────────────────────────────────────────

type Household = { id: string; name: string; is_vip: boolean; staff_name: string | null; staff_role: string | null };

type ServiceClock = {
  id: string;
  household_id: string;
  next_brush_due: string | null;
  next_full_groom_due: string | null;
  brush_outreach_trigger: string | null;
  full_groom_outreach_trigger: string | null;
};

type Appointment = {
  id: string;
  household_id: string;
  date: string;
  time: string;
  service_type: string;
  notes: string | null;
  duration: number | null;
};

type AdhocConfirmed = {
  id: string;
  household_id: string;
  service_type: string;
  outreach_date: string;
  task_owner: string | null;
  task_role: string | null;
};

type EventKind = "full_groom_due" | "brush_due" | "appointment" | "adhoc_due";

export type CalEvent = {
  key: string;
  dbId: string;
  householdId: string;
  householdName: string;
  isVip: boolean;
  kind: EventKind;
  date: string;       // chip placement date (trigger date if set, else due date)
  dueDate?: string;   // actual due date — shown in detail modal
  time?: string;
  serviceType?: string;
  clockField?: "full_groom_outreach_trigger" | "brush_outreach_trigger";
  taskOwner?: string | null;   // ad hoc requests: who picked up the task
  taskRole?: string | null;
  staffName?: string | null;   // the client's assigned staff member
  staffRole?: string | null;
  source?: ServiceKind;   // recurring services only
  sourceId?: string;
  review?: ReviewState;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const SERVICE_ABBREV = SERVICE_LABELS;
const ADHOC_SERVICE_LABEL = SERVICE_LABELS;

const KIND_ORDER: Record<EventKind, number> = {
  // Full grooms, brush & nails and ad hoc requests interleave by client name
  full_groom_due: 0, adhoc_due: 0, brush_due: 0, appointment: 1,
};

const MAX_VISIBLE = 3;
const DRAG_THRESHOLD = 5;

const CHIP_ACCENT: Record<EventKind, string> = {
  full_groom_due: "#8B3220",
  brush_due: "#B87A28",
  appointment: "#2D5E32",
  adhoc_due: "#1A4FA0",
};

const CHIP_BG: Record<EventKind, string> = {
  full_groom_due: "bg-terra-pale",
  brush_due: "bg-amber-pale",
  appointment: "bg-sage-pale",
  adhoc_due: "",
};

const BADGE_STYLE: Record<"full_groom_due" | "brush_due", string> = {
  full_groom_due: "bg-terra text-white",
  brush_due: "bg-amber text-white",
};

// Ad hoc chip — fully inline to avoid Tailwind JIT misses
const ADHOC_STYLE = {
  bg: "#C8D8F0", border: "#1A4FA0", text: "#0F2D6B", weight: 600,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function to12hr(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  return `${h % 12 || 12}:${m} ${h >= 12 ? "pm" : "am"}`;
}

/** Returns the Monday of the week containing `d`. */
function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const dow = copy.getDay(); // 0=Sun
  copy.setDate(copy.getDate() + (dow === 0 ? -6 : 1 - dow));
  return copy;
}

/** Returns 4 rows × 5 days (Mon–Fri) starting from `anchor` (a Monday). */
function get4WeekGrid(anchor: Date): Date[][] {
  const weeks: Date[][] = [];
  for (let w = 0; w < 4; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 5; d++) {
      const day = new Date(anchor);
      day.setDate(anchor.getDate() + w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Returns the 3-letter month label for the month with the most days in the week. */
function weekDominantMonth(week: Date[]): string {
  const counts = new Map<number, number>();
  for (const d of week) counts.set(d.getMonth(), (counts.get(d.getMonth()) ?? 0) + 1);
  let dominant = week[0].getMonth();
  let max = 0;
  Array.from(counts.entries()).forEach(([m, c]) => { if (c > max) { max = c; dominant = m; } });
  return MONTHS_SHORT[dominant];
}

/** Formats the 4-week window as "Apr 13 – May 8, 2026". */
function rangeLabel(anchor: Date): string {
  const last = new Date(anchor);
  last.setDate(anchor.getDate() + 25); // Mon + 3*7 + 4 = last Friday
  const sy = anchor.getFullYear();
  const ey = last.getFullYear();
  const startStr = anchor.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = last.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (sy === ey) return `${startStr} – ${endStr}, ${ey}`;
  return `${anchor.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalendarView() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [households, setHouseholds] = useState<Household[]>([]);
  const [clocks, setClocks] = useState<ServiceClock[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [adhocConfirmed, setAdhocConfirmed] = useState<AdhocConfirmed[]>([]);
  const [drafts, setDrafts] = useState<Record<string, OutreachDraft>>({});
  const [loading, setLoading] = useState(true);

  // ── View ─────────────────────────────────────────────────────────────────────
  const today = useMemo(() => todayET(), []);
  const todayStr = toYMD(today);

  // Anchor = Monday of current week; navigation shifts by ±1 week
  const [anchorMonday, setAnchorMonday] = useState<Date>(() => getMondayOfWeek(todayET()));

  // ── Toggles ──────────────────────────────────────────────────────────────────
  const [showDue, setShowDue] = useState(true);
  const [showAppts, setShowAppts] = useState(true);

  // ── Search ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // ── Overflow ─────────────────────────────────────────────────────────────────
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // ── Modal ────────────────────────────────────────────────────────────────────
  const [modalEvent, setModalEvent] = useState<CalEvent | null>(null);
  const [panelEvent, setPanelEvent] = useState<CalEvent | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [horizonDays, setHorizonDays] = useState(30);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  function openEvent(ev: CalEvent) {
    if (ev.source) setPanelEvent(ev);
    else setModalEvent(ev);
  }

  // ── Optimize calendar ────────────────────────────────────────────────────────
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [optimizeMode, setOptimizeMode] = useState<"balance" | "fill">("balance");
  const [optimizing, setOptimizing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }

  async function runOptimization() {
    setShowOptimizeModal(false);
    setOptimizing(true);
    if (optimizeMode === "balance") {
      const { data, error } = await supabase.rpc("balance_outreach_calendar", {
        p_weeks_ahead: 26,
        p_max_per_week: 5,
        p_max_nudge_days: 21,
        p_min_outreach_window: 14,
      });
      setOptimizing(false);
      if (error) { showToast("Something went wrong — calendar not changed"); return; }
      const rows = (data as unknown[]) ?? [];
      showToast(rows.length === 0
        ? "Calendar is already balanced — no changes needed"
        : `${rows.length} outreach date${rows.length === 1 ? "" : "s"} adjusted to balance the schedule`);
    } else {
      const { data, error } = await supabase.rpc("fill_calendar_gaps", {
        p_weeks_ahead: 8,
        p_min_appointments: 3,
        p_max_pull_forward_days: 21,
        p_min_days_from_today: 2,
      });
      setOptimizing(false);
      if (error) { showToast("Something went wrong — calendar not changed"); return; }
      const rows = (data as unknown[]) ?? [];
      showToast(rows.length === 0
        ? "Calendar gaps are already filled — no changes needed"
        : `${rows.length} household${rows.length === 1 ? "" : "s"} pulled forward to fill light weeks`);
    }
    await loadData();
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const mouseDownRef = useRef<{ x: number; y: number; ev: CalEvent; el: HTMLDivElement } | null>(null);
  const isDraggingRef = useRef(false);
  const dragOverDayRef = useRef<string | null>(null);

  const openEventRef = useRef<(ev: CalEvent) => void>(() => {});
  openEventRef.current = openEvent;
  const dropHandlerRef = useRef<(date: string, ev: CalEvent) => void>(() => {});
  dropHandlerRef.current = (targetDate: string, ev: CalEvent) => {
    if (ev.kind === "adhoc_due") {
      setAdhocConfirmed((prev) =>
        prev.map((r) => r.id === ev.dbId ? { ...r, outreach_date: targetDate } : r)
      );
      supabase.from("adhoc_requests").update({ outreach_date: targetDate }).eq("id", ev.dbId);
    } else {
      if (!ev.clockField) return;
      setClocks((prev) =>
        prev.map((c) => c.id === ev.dbId ? { ...c, [ev.clockField!]: targetDate } : c)
      );
      supabase.from("service_clocks").update({ [ev.clockField]: targetDate }).eq("id", ev.dbId);
    }
  };

  // ── Fetch ────────────────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true);
    const [{ data: hh }, { data: sc }, { data: ap }, { data: ac }, { data: dr }] = await Promise.all([
      supabase.from("households").select("id, name, is_vip, staff_name, staff_role"),
      supabase.from("service_clocks").select("id, household_id, next_brush_due, next_full_groom_due, brush_outreach_trigger, full_groom_outreach_trigger"),
      supabase.from("appointments").select("id, household_id, date, time, service_type, notes, duration"),
      supabase.from("adhoc_requests")
        .select("id, household_id, service_type, outreach_date, task_owner, task_role")
        .eq("status", "confirmed")
        .not("outreach_date", "is", null),
      supabase.from("outreach_drafts").select(DRAFT_COLUMNS),
    ]);
    setHouseholds(hh ?? []);
    setClocks(sc ?? []);
    setAppointments(ap ?? []);
    setAdhocConfirmed((ac as AdhocConfirmed[]) ?? []);
    setDrafts(Object.fromEntries(((dr as OutreachDraft[]) ?? []).map((d) => [draftKey(d.source, d.source_id), d])));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Click-outside: close search ──────────────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node))
        setSearchOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Drag: document-level mouse handlers ──────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!mouseDownRef.current) return;
      const { x, y, el } = mouseDownRef.current;
      const dist = Math.sqrt((e.clientX - x) ** 2 + (e.clientY - y) ** 2);
      if (!isDraggingRef.current && dist >= DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        const clone = el.cloneNode(true) as HTMLElement;
        clone.style.cssText = [
          "position:fixed",
          `width:${el.offsetWidth}px`,
          `left:${e.clientX - el.offsetWidth / 2}px`,
          `top:${e.clientY - el.offsetHeight / 2}px`,
          "pointer-events:none", "opacity:0.85", "z-index:9999", "transition:none",
        ].join(";");
        document.body.appendChild(clone);
        ghostRef.current = clone;
      }
      if (isDraggingRef.current && ghostRef.current) {
        const { el: origEl } = mouseDownRef.current;
        ghostRef.current.style.left = `${e.clientX - origEl.offsetWidth / 2}px`;
        ghostRef.current.style.top = `${e.clientY - origEl.offsetHeight / 2}px`;
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (!mouseDownRef.current) return;
      const { x, y, ev } = mouseDownRef.current;
      const dist = Math.sqrt((e.clientX - x) ** 2 + (e.clientY - y) ** 2);
      if (isDraggingRef.current) {
        const target = dragOverDayRef.current;
        if (target) dropHandlerRef.current(target, ev);
      } else if (dist < DRAG_THRESHOLD) {
        openEventRef.current(ev);
      }
      if (ghostRef.current) { document.body.removeChild(ghostRef.current); ghostRef.current = null; }
      isDraggingRef.current = false;
      mouseDownRef.current = null;
      setDragOverDay(null);
      dragOverDayRef.current = null;
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const hhMap = useMemo(
    () => Object.fromEntries(households.map((h) => [h.id, h])),
    [households]
  );

  const events = useMemo(() => {
    const result: CalEvent[] = [];
    if (showDue) {
      for (const clock of clocks) {
        const hh = hhMap[clock.household_id];
        if (!hh) continue;
        if (clock.next_full_groom_due)
          result.push({ key: `fg-${clock.id}`, dbId: clock.id, householdId: hh.id,
            householdName: hh.name, isVip: hh.is_vip, kind: "full_groom_due",
            date: clock.full_groom_outreach_trigger ?? clock.next_full_groom_due,
            dueDate: clock.next_full_groom_due, clockField: "full_groom_outreach_trigger",
            source: "full_groom", sourceId: clock.id });
        if (clock.next_brush_due)
          result.push({ key: `br-${clock.id}`, dbId: clock.id, householdId: hh.id,
            householdName: hh.name, isVip: hh.is_vip, kind: "brush_due",
            date: clock.brush_outreach_trigger ?? clock.next_brush_due,
            dueDate: clock.next_brush_due, clockField: "brush_outreach_trigger",
            source: "brush_nail", sourceId: clock.id });
      }
      for (const ar of adhocConfirmed) {
        const hh = hhMap[ar.household_id];
        if (!hh) continue;
        result.push({ key: `adhoc-${ar.id}`, dbId: ar.id, householdId: hh.id,
          householdName: hh.name, isVip: hh.is_vip, kind: "adhoc_due",
          date: ar.outreach_date, serviceType: ar.service_type,
          taskOwner: ar.task_owner, taskRole: ar.task_role });
      }
    }
    if (showAppts) {
      for (const appt of appointments) {
        const hh = hhMap[appt.household_id];
        if (!hh) continue;
        result.push({ key: `ap-${appt.id}`, dbId: appt.id, householdId: hh.id,
          householdName: hh.name, isVip: hh.is_vip, kind: "appointment",
          date: appt.date, time: appt.time.slice(0, 5), serviceType: appt.service_type });
      }
    }
    for (const ev of result) {
      const hh = hhMap[ev.householdId];
      ev.staffName = hh?.staff_name ?? null;
      ev.staffRole = hh?.staff_role ?? null;
      if (!ev.source || !ev.sourceId) continue;
      ev.review = reviewState({
        outreachDate: ev.date, today: todayStr,
        draft: drafts[draftKey(ev.source, ev.sourceId)],
      });
    }
    return result;
  }, [clocks, appointments, adhocConfirmed, drafts, hhMap, showDue, showAppts, todayStr]);

  const reviewQueue = useMemo(
    () => events
      .filter((ev) => ev.review === "needs_review")
      .sort((a, b) => a.date.localeCompare(b.date) || a.householdName.localeCompare(b.householdName)),
    [events]
  );

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const ev of events) (map[ev.date] ??= []).push(ev);
    for (const day of Object.keys(map)) {
      map[day].sort((a, b) => {
        const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        if (ko !== 0) return ko;
        if (a.kind === "appointment" && b.kind === "appointment")
          return (a.time ?? "").localeCompare(b.time ?? "");
        return a.householdName.localeCompare(b.householdName);
      });
    }
    return map;
  }, [events]);

  const weeks = useMemo(() => get4WeekGrid(anchorMonday), [anchorMonday]);

  // Month labels per row — only emit when the dominant month changes
  const weekMonthLabels = useMemo(() => {
    return weeks.map((week, i) => {
      const label = weekDominantMonth(week);
      return i === 0 || label !== weekDominantMonth(weeks[i - 1]) ? label : "";
    });
  }, [weeks]);

  const headerLabel = useMemo(() => rangeLabel(anchorMonday), [anchorMonday]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return households.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 8);
  }, [search, households]);

  // ── Navigation ───────────────────────────────────────────────────────────────
  function prevWeek() {
    setAnchorMonday((d) => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; });
    setExpandedDay(null);
  }
  function nextWeek() {
    setAnchorMonday((d) => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; });
    setExpandedDay(null);
  }
  function goToday() {
    setAnchorMonday(getMondayOfWeek(todayET()));
    setExpandedDay(null);
  }

  function jumpToClient(hh: Household) {
    const clock = clocks.find((c) => c.household_id === hh.id);
    const dates = [clock?.next_brush_due, clock?.next_full_groom_due].filter(Boolean) as string[];
    if (dates.length) {
      const d = new Date(dates.sort()[0] + "T00:00:00");
      setAnchorMonday(getMondayOfWeek(d));
    }
    setHighlightId(hh.id);
    setSearch(""); setSearchOpen(false); setExpandedDay(null);
    setTimeout(() => setHighlightId(null), 3000);
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <NavBar />

      {/* ── Controls bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-border px-6 h-12 flex items-center gap-4 shrink-0">
        {/* Date range label */}
        <h1 className="text-base font-bold text-ink w-52 shrink-0 tabular-nums">
          {view === "list" ? `Next ${horizonDays} days` : headerLabel}
        </h1>

        {/* Client search */}
        <div className="relative w-56" ref={searchContainerRef}>
          <input
            type="text"
            placeholder="Find a client..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            className="w-full px-3 py-1 text-sm border border-border rounded bg-cream placeholder-ink-3 focus:outline-none focus:ring-1 focus:ring-terra"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded shadow-lg z-50 overflow-hidden">
              {searchResults.map((hh) => (
                <button key={hh.id}
                  onMouseDown={(e) => { e.preventDefault(); jumpToClient(hh); }}
                  className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-cream flex items-center gap-2"
                >
                  {hh.is_vip && <span className="text-amber text-[10px] shrink-0">◆</span>}
                  <span>{hh.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="inline-flex rounded border border-border overflow-hidden ml-auto">
          {(["calendar", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-[11px] font-bold tracking-wide transition-colors ${
                view === v ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-cream"
              }`}
            >
              {v === "calendar" ? "CALENDAR" : "LIST"}
            </button>
          ))}
        </div>

        {/* Week navigation — grid only */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOptimizeModal(true)}
            disabled={optimizing}
            className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold tracking-wide border border-border rounded text-ink bg-white hover:bg-cream-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <line x1="6.5" y1="1" x2="6.5" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="1" y1="4.5" x2="12" y2="4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="1" y1="4.5" x2="3.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="12" y1="4.5" x2="9.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {optimizing ? "OPTIMIZING…" : "OPTIMIZE CALENDAR"}
          </button>
          {view === "calendar" && (
            <>
              <button onClick={goToday}
                className="px-3 py-1 text-[11px] font-bold tracking-wide border border-border rounded text-ink hover:bg-cream-2 transition-colors">
                TODAY
              </button>
              <button onClick={prevWeek}
                className="w-7 h-7 flex items-center justify-center border border-border rounded text-ink hover:bg-cream-2 transition-colors text-base leading-none">
                ‹
              </button>
              <button onClick={nextWeek}
                className="w-7 h-7 flex items-center justify-center border border-border rounded text-ink hover:bg-cream-2 transition-colors text-base leading-none">
                ›
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Toggles ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-border px-6 h-10 flex items-center gap-3 shrink-0">
        <button onClick={() => setShowDue((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1 rounded text-[11px] font-semibold border transition-colors ${showDue ? "bg-cream-2 border-border text-ink" : "bg-white border-border/50 text-ink-3"}`}>
          <span className="flex gap-0.5 items-center">
            <span className="w-3 h-3 rounded-sm bg-terra-pale border border-terra/40 inline-block" />
            <span className="w-3 h-3 rounded-sm bg-amber-pale border border-amber/40 inline-block" />
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: ADHOC_STYLE.bg, border: "1px solid #1A4FA040" }} />
          </span>
          Appointment Due
        </button>
        <button onClick={() => setShowAppts((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1 rounded text-[11px] font-semibold border transition-colors ${showAppts ? "bg-cream-2 border-border text-ink" : "bg-white border-border/50 text-ink-3"}`}>
          <span className="w-3 h-3 rounded-sm bg-sage-pale border border-sage/40 inline-block" />
          Scheduled appointments
        </button>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            {(["needs_review", "approved", "skipped"] as ReviewState[]).map((st) => (
              <span key={st} className="flex items-center gap-1.5">
                <ReviewMarker state={st} />
                {REVIEW_STATE_LABEL[st]}
              </span>
            ))}
          </div>
          <button onClick={() => { setView("list"); setNeedsReviewOnly(true); }}
            className="flex items-center gap-2 px-3 py-1 rounded text-[11px] font-bold tracking-wide border transition-colors"
            style={{ backgroundColor: STATE_STYLE.needs_review.bg, color: STATE_STYLE.needs_review.fg, borderColor: "#B87A2840" }}>
            REVIEW QUEUE
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-amber text-white text-[10px]">
              {reviewQueue.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── List view ────────────────────────────────────────────────────────── */}
      {!loading && view === "list" && (
        <ScheduleList
          events={events}
          drafts={drafts}
          todayStr={todayStr}
          horizonDays={horizonDays}
          needsReviewOnly={needsReviewOnly}
          onHorizonChange={setHorizonDays}
          onNeedsReviewOnlyChange={setNeedsReviewOnly}
          onOpen={openEvent}
        />
      )}

      {/* ── Calendar grid ────────────────────────────────────────────────────── */}
      {view === "calendar" && (
      <div className="flex-1 p-4 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-ink-3 text-sm">Loading…</div>
        ) : (
          <div className="bg-white border border-border rounded-lg overflow-hidden">

            {/* Day headers — extra left gutter for month labels */}
            <div className="flex border-b border-border bg-cream">
              <div className="w-8 shrink-0 border-r border-border" />
              <div className="flex-1 grid grid-cols-5">
                {["MON", "TUE", "WED", "THU", "FRI"].map((d) => (
                  <div key={d}
                    className="py-2 text-center text-[10px] font-bold tracking-widest text-ink-3 border-r border-border last:border-r-0">
                    {d}
                  </div>
                ))}
              </div>
            </div>

            {/* 4 week rows */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex border-b border-border last:border-b-0">

                {/* Month label */}
                <div className="w-8 shrink-0 border-r border-border flex items-center justify-center">
                  {weekMonthLabels[wi] && (
                    <span className="text-[10px] font-bold tracking-wider text-ink-3 uppercase"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                      {weekMonthLabels[wi]}
                    </span>
                  )}
                </div>

                {/* 5 day cells */}
                <div className="flex-1 grid grid-cols-5">
                  {week.map((day) => {
                    const ymd = toYMD(day);
                    const isPast = ymd < todayStr;
                    const isToday = ymd === todayStr;
                    const dayEvents = eventsByDay[ymd] ?? [];
                    const isExpanded = expandedDay === ymd;
                    const visible = isExpanded ? dayEvents : dayEvents.slice(0, MAX_VISIBLE);
                    const overflowCount = dayEvents.length - MAX_VISIBLE;
                    const isDropTarget = !isPast && dragOverDay === ymd;

                    return (
                      <div
                        key={ymd}
                        data-date={ymd}
                        className={[
                          "min-h-32 p-1.5 border-r border-border last:border-r-0 transition-colors",
                          isDropTarget ? "bg-cream-2" : isPast ? "bg-cream/60" : "bg-white",
                        ].join(" ")}
                        onMouseEnter={() => {
                          // Past days are not drop targets
                          if (isDraggingRef.current && !isPast) {
                            dragOverDayRef.current = ymd;
                            setDragOverDay(ymd);
                          }
                        }}
                        onMouseLeave={() => {
                          if (isDraggingRef.current) {
                            dragOverDayRef.current = null;
                            setDragOverDay(null);
                          }
                        }}
                      >
                        {/* Day number */}
                        <div className="flex justify-end mb-1">
                          {isToday ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-terra text-white text-[11px] font-bold">
                              {day.getDate()}
                            </span>
                          ) : (
                            <span className={`text-[11px] font-semibold ${isPast ? "text-ink-3/40" : "text-ink-2"}`}>
                              {day.getDate()}
                            </span>
                          )}
                        </div>

                        {/* Chips */}
                        <div className={`flex flex-col gap-1 ${isPast ? "opacity-40" : ""}`}>
                          {visible.map((ev) => {
                            const isHighlighted = ev.householdId === highlightId;
                            // No drag on past days or appointment chips
                            const isDraggable = ev.kind !== "appointment" && !isPast;

                            return (
                              <div
                                key={ev.key}
                                onMouseDown={isDraggable
                                  ? (e) => {
                                      e.preventDefault();
                                      mouseDownRef.current = {
                                        x: e.clientX, y: e.clientY,
                                        ev, el: e.currentTarget as HTMLDivElement,
                                      };
                                      isDraggingRef.current = false;
                                    }
                                  : undefined}
                                onClick={!isDraggable ? () => openEvent(ev) : undefined}
                                style={ev.kind === "adhoc_due" ? {
                                  backgroundColor: ADHOC_STYLE.bg,
                                  borderLeftColor: ADHOC_STYLE.border,
                                } : {
                                  borderLeftColor: CHIP_ACCENT[ev.kind],
                                }}
                                className={[
                                  "border-l-[3px] rounded-md flex items-center gap-2 px-2.5 py-2 w-full min-w-0 select-none",
                                  ev.kind !== "adhoc_due" ? CHIP_BG[ev.kind] : "",
                                  isDraggable ? "cursor-grab" : "cursor-pointer",
                                  isHighlighted ? "ring-2 ring-ink" : "",
                                ].join(" ")}
                                title={
                                  ev.kind === "appointment"
                                    ? `${ev.householdName} — ${SERVICE_ABBREV[ev.serviceType ?? ""] ?? ev.serviceType} @ ${to12hr(ev.time ?? "00:00")}`
                                    : ev.kind === "adhoc_due"
                                    ? `${ev.householdName} — Ad Hoc: ${ADHOC_SERVICE_LABEL[ev.serviceType ?? ""] ?? ev.serviceType}`
                                    : `${ev.householdName} — ${ev.kind === "full_groom_due" ? "Full Groom Due" : "Brush & Nail Due"}`
                                }
                              >
                                {ev.kind === "adhoc_due" ? (
                                  <span className="shrink-0 text-[9px]" style={{ color: ADHOC_STYLE.border }}>◆</span>
                                ) : ev.isVip ? (
                                  <span className="shrink-0 text-[9px] text-amber opacity-80">◆</span>
                                ) : null}

                                <span
                                  className={ev.kind === "adhoc_due"
                                    ? "text-[12px] truncate flex-1 min-w-0 leading-tight"
                                    : "font-bold text-[12px] text-ink-2 truncate flex-1 min-w-0 leading-tight"}
                                  style={ev.kind === "adhoc_due" ? { color: ADHOC_STYLE.text, fontWeight: ADHOC_STYLE.weight } : undefined}
                                >
                                  {ev.householdName}
                                </span>

                                {ev.review && <ReviewMarker state={ev.review} />}

                                {ev.kind === "appointment" ? (
                                  <>
                                    {ev.serviceType && (
                                      <span style={{ backgroundColor: "#2D5E32", color: "#FFFFFF", fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                                        {SERVICE_ABBREV[ev.serviceType] ?? ev.serviceType}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-ink-3 shrink-0 font-medium tabular-nums">
                                      {to12hr(ev.time ?? "00:00")}
                                    </span>
                                  </>
                                ) : ev.kind === "adhoc_due" ? (
                                  <span style={{ backgroundColor: "#1A4FA0", color: "#FFFFFF", fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                                    {ADHOC_SERVICE_LABEL[ev.serviceType ?? ""] ?? ev.serviceType}
                                  </span>
                                ) : (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${BADGE_STYLE[ev.kind]}`}>
                                    {ev.kind === "full_groom_due" ? "Full" : "Brush"}
                                  </span>
                                )}
                              </div>
                            );
                          })}

                          {!isExpanded && overflowCount > 0 && (
                            <button onClick={() => setExpandedDay(ymd)}
                              className="text-[10px] text-ink-3 hover:text-ink font-semibold text-left pl-1.5 py-0.5 rounded hover:bg-cream transition-colors">
                              +{overflowCount} more
                            </button>
                          )}
                          {isExpanded && dayEvents.length > MAX_VISIBLE && (
                            <button onClick={() => setExpandedDay(null)}
                              className="text-[10px] text-ink-3 hover:text-ink font-semibold text-left pl-1.5 py-0.5 rounded hover:bg-cream transition-colors">
                              show less
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Chip detail modal ────────────────────────────────────────────────── */}
      {modalEvent && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50"
          onClick={() => setModalEvent(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="h-1.5 w-full" style={{ backgroundColor: CHIP_ACCENT[modalEvent.kind] }} />
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  {modalEvent.isVip && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-pale text-amber border border-amber/30 mb-1.5 block w-fit">
                      ◆ VIP
                    </span>
                  )}
                  <h3 className="font-bold text-ink text-base leading-tight">{modalEvent.householdName}</h3>
                </div>
                <button onClick={() => setModalEvent(null)} className="text-ink-3 hover:text-ink text-xl leading-none mt-0.5">×</button>
              </div>

              <div className="space-y-2 mb-4">
                <span className="inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor:
                      modalEvent.kind === "full_groom_due" ? "#F5DDD8"
                      : modalEvent.kind === "brush_due" ? "#FAE8C8"
                      : modalEvent.kind === "adhoc_due" ? "#E8EDF5"
                      : "#D6EAD8",
                    color: CHIP_ACCENT[modalEvent.kind],
                  }}>
                  {modalEvent.kind === "full_groom_due" ? "Full Groom Due"
                    : modalEvent.kind === "brush_due" ? "Brush & Nail Due"
                    : modalEvent.kind === "adhoc_due"
                    ? `Ad Hoc · ${ADHOC_SERVICE_LABEL[modalEvent.serviceType ?? ""] ?? modalEvent.serviceType}`
                    : SERVICE_ABBREV[modalEvent.serviceType ?? ""] ?? modalEvent.serviceType}
                </span>
                {modalEvent.dueDate ? (
                  <div className="space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide w-24 shrink-0">Outreach date</span>
                      <span className="text-sm text-ink-2">
                        {new Date(modalEvent.date + "T00:00:00").toLocaleDateString("en-US",
                          { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide w-24 shrink-0">Due date</span>
                      <span className="text-sm text-ink-2">
                        {new Date(modalEvent.dueDate + "T00:00:00").toLocaleDateString("en-US",
                          { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                ) : modalEvent.kind === "adhoc_due" ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide w-24 shrink-0">Follow-up date</span>
                      <span className="text-sm text-ink-2">
                        {new Date(modalEvent.date + "T00:00:00").toLocaleDateString("en-US",
                          { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    {modalEvent.taskOwner && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide w-24 shrink-0">Handled by</span>
                        <span className="text-sm text-ink-2">
                          {modalEvent.taskOwner}{modalEvent.taskRole ? ` (${modalEvent.taskRole})` : ""}
                        </span>
                      </div>
                    )}
                    <p className="text-[12px] text-ink-3 leading-snug bg-cream rounded px-3 py-2">
                      Walk-in request. Ad hoc services are handled in person, so there&apos;s no email to review.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-ink-2">
                    {new Date(modalEvent.date + "T00:00:00").toLocaleDateString("en-US",
                      { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    {modalEvent.time && (
                      <span className="text-ink-3"> · {to12hr(modalEvent.time)}</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-3 border-t border-border">
                <button onClick={() => setModalEvent(null)}
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg text-ink-2 hover:bg-cream transition-colors">
                  Dismiss
                </button>
                <button
                  onClick={() => { router.push(`/clients/${modalEvent.householdId}?from=calendar`); setModalEvent(null); }}
                  className="flex-1 px-3 py-2 text-sm bg-terra text-white rounded-lg hover:opacity-90 transition-opacity font-semibold">
                  View Profile →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Outreach review panel ──────────────────────────────────────────── */}
      {panelEvent && panelEvent.source && panelEvent.sourceId && panelEvent.dueDate && (
        <OutreachPanel
          outreach={{
            householdId: panelEvent.householdId,
            householdName: panelEvent.householdName,
            isVip: panelEvent.isVip,
            source: panelEvent.source,
            sourceId: panelEvent.sourceId,
            outreachDate: panelEvent.date,
            dueDate: panelEvent.dueDate,
            staffName: panelEvent.staffName,
            staffRole: panelEvent.staffRole,
          } satisfies PanelOutreach}
          draft={drafts[draftKey(panelEvent.source, panelEvent.sourceId)] ?? null}
          today={todayStr}
          onDraftChange={(d) => setDrafts((prev) => ({ ...prev, [draftKey(d.source, d.source_id)]: d }))}
          onOutreachDateChange={(sourceId, source, ymd) => {
            const field = source === "full_groom" ? "full_groom_outreach_trigger" : "brush_outreach_trigger";
            setClocks((prev) => prev.map((c) => (c.id === sourceId ? { ...c, [field]: ymd } : c)));
            setPanelEvent((prev) => (prev ? { ...prev, date: ymd } : prev));
            showToast(`Outreach moved to ${new Date(ymd + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`);
          }}
          onClose={() => setPanelEvent(null)}
          onViewProfile={() => { router.push(`/clients/${panelEvent.householdId}?from=calendar`); setPanelEvent(null); }}
        />
      )}

      {/* ── Optimize calendar modal ──────────────────────────────────────────── */}
      {showOptimizeModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50"
          onClick={() => setShowOptimizeModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[440px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-start justify-between mb-5">
                <h2 className="font-bold text-ink text-base">Calendar optimization</h2>
                <button onClick={() => setShowOptimizeModal(false)}
                  className="text-ink-3 hover:text-ink text-xl leading-none">×</button>
              </div>

              {/* Mode cards */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                {/* Balance card */}
                <button
                  onClick={() => setOptimizeMode("balance")}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    optimizeMode === "balance"
                      ? "border-terra bg-terra-pale"
                      : "border-border hover:border-border bg-cream"
                  }`}
                >
                  <div className="mb-3">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden
                      className={optimizeMode === "balance" ? "text-terra" : "text-ink-3"}>
                      <line x1="10" y1="2" x2="10" y2="18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      <line x1="2" y1="7" x2="18" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      <line x1="2" y1="7" x2="6" y2="13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      <line x1="18" y1="7" x2="14" y2="13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <p className={`text-[11px] font-bold tracking-wide uppercase mb-1 ${
                    optimizeMode === "balance" ? "text-terra" : "text-ink"
                  }`}>Spread the load</p>
                  <p className="text-[12px] text-ink-3 leading-snug">
                    Nudge overloaded weeks to spread outreach evenly. Dates stay within 21 days of their original schedule.
                  </p>
                </button>

                {/* Fill gaps card */}
                <button
                  onClick={() => setOptimizeMode("fill")}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    optimizeMode === "fill"
                      ? "border-terra bg-terra-pale"
                      : "border-border hover:border-border bg-cream"
                  }`}
                >
                  <div className="mb-3">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden
                      className={optimizeMode === "fill" ? "text-terra" : "text-ink-3"}>
                      <rect x="2" y="13" width="16" height="5" rx="1" stroke="currentColor" strokeWidth="1.6"/>
                      <line x1="10" y1="2" x2="10" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      <polyline points="6,7 10,11 14,7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                  </div>
                  <p className={`text-[11px] font-bold tracking-wide uppercase mb-1 ${
                    optimizeMode === "fill" ? "text-terra" : "text-ink"
                  }`}>Fill light weeks</p>
                  <p className="text-[12px] text-ink-3 leading-snug">
                    Pull outreach forward for clients in light weeks, starting outreach earlier to fill gaps in the schedule.
                  </p>
                </button>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <button onClick={() => setShowOptimizeModal(false)}
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg text-ink-2 hover:bg-cream transition-colors">
                  Cancel
                </button>
                <button onClick={runOptimization}
                  className="flex-1 px-3 py-2 text-sm bg-terra text-white rounded-lg hover:opacity-90 transition-opacity font-semibold">
                  Run optimization
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg bg-ink text-white text-sm font-medium whitespace-nowrap pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Review marker ────────────────────────────────────────────────────────────

function ReviewMarker({ state }: { state: ReviewState }) {
  const common = "w-4 h-4 rounded flex items-center justify-center shrink-0";
  switch (state) {
    case "needs_review":
      return (
        <span className={common} style={{ backgroundColor: "#B87A28" }} title="Reminder email needs review">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M6.8 1.2l2 2L3.5 8.5H1.5v-2z" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case "approved":
    case "sent_ai":
      return (
        <span className={common} style={{ backgroundColor: "#2D5E32" }} title={state === "approved" ? "AI email approved" : "Sent — approved AI draft"}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M1.8 5.2l2.1 2.1 4.3-4.6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case "skipped":
    case "skipped_past":
      return (
        <span className={common} style={{ backgroundColor: "#fff", border: "1px solid #9A8B7E" }} title="Skipped this cycle">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M2 8L8 2" stroke="#9A8B7E" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      );
    case "sent_template":
      return (
        <span className={common} style={{ backgroundColor: "#fff", border: "1px solid #6B5D52" }} title="Sent — standard template">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
            <rect x="1.3" y="2.3" width="7.4" height="5.4" rx="0.8" stroke="#6B5D52" strokeWidth="1.1" />
            <path d="M1.6 2.8L5 5.3l3.4-2.5" stroke="#6B5D52" strokeWidth="1.1" />
          </svg>
        </span>
      );
    default:
      return null;
  }
}
