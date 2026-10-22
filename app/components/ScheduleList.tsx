"use client";

import { useMemo } from "react";
import { type CalEvent } from "./CalendarView";
import { SERVICE_LABELS } from "@/lib/terms";
import { REVIEW_STATE_LABEL, draftKey, type OutreachDraft } from "@/lib/engagement";
import { STATE_STYLE } from "./OutreachPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayHeading(ymd: string, todayStr: string): { label: string; relative: string; urgent: boolean } {
  const d = new Date(ymd + "T00:00:00");
  const days = Math.round((d.getTime() - new Date(todayStr + "T00:00:00").getTime()) / 86400000);
  return {
    label: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    relative: days === 0 ? "today" : days === 1 ? "tomorrow" : days < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`,
    urgent: days <= 1,
  };
}

const ROLE_TINT: Record<string, { bg: string; fg: string }> = {
  GR: { bg: "#EDE5D8", fg: "#6A4A20" },
  BA: { bg: "#E4EAF8", fg: "#2A4494" },
  FD: { bg: "#EDE8F5", fg: "#4E3880" },
};

function shortDate(ymd: string | undefined): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function typeLabel(ev: CalEvent): string {
  if (ev.kind === "full_groom_due") return "Full Groom";
  if (ev.kind === "brush_due") return "Brush & Nail";
  if (ev.kind === "adhoc_due") return `Ad Hoc · ${SERVICE_LABELS[ev.serviceType ?? ""] ?? ev.serviceType}`;
  return `Appointment · ${SERVICE_LABELS[ev.serviceType ?? ""] ?? ev.serviceType}`;
}

const TYPE_ACCENT: Record<string, string> = {
  full_groom_due: "#8B3220",
  brush_due: "#B87A28",
  adhoc_due: "#1A4FA0",
  appointment: "#2D5E32",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScheduleList({
  events,
  drafts,
  todayStr,
  horizonDays,
  needsReviewOnly,
  onHorizonChange,
  onNeedsReviewOnlyChange,
  onOpen,
}: {
  events: CalEvent[];
  drafts: Record<string, OutreachDraft>;
  todayStr: string;
  horizonDays: number;
  needsReviewOnly: boolean;
  onHorizonChange: (days: number) => void;
  onNeedsReviewOnlyChange: (v: boolean) => void;
  onOpen: (ev: CalEvent) => void;
}) {

  const rows = useMemo(() => {
    const end = new Date(todayStr + "T00:00:00");
    end.setDate(end.getDate() + horizonDays);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return events
      .filter((ev) => ev.date >= todayStr && ev.date <= endStr)
      .filter((ev) => !needsReviewOnly || ev.review === "needs_review")
      .sort((a, b) => a.date.localeCompare(b.date) || a.householdName.localeCompare(b.householdName));
  }, [events, todayStr, horizonDays, needsReviewOnly]);

  const byDay = useMemo(() => {
    const map: [string, CalEvent[]][] = [];
    for (const ev of rows) {
      const last = map[map.length - 1];
      if (last && last[0] === ev.date) last[1].push(ev);
      else map.push([ev.date, [ev]]);
    }
    return map;
  }, [rows]);

  const reviewable = useMemo(
    () => rows.filter((ev) => ev.review === "needs_review" && ev.source && ev.sourceId),
    [rows]
  );

  function detailFor(ev: CalEvent): string {
    if (ev.source && ev.sourceId) {
      const d = drafts[draftKey(ev.source, ev.sourceId)];
      if (d) return d.subject;
      return ev.review === "scheduled" ? "Draft not written yet" : "—";
    }
    if (ev.kind === "adhoc_due") return "Handled in person · no email";
    return ev.time ? `Scheduled ${ev.time}` : "—";
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* ── List controls ──────────────────────────────────────────────────── */}
      <div className="px-6 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-[11px] font-bold tracking-widest text-ink-3 uppercase">Horizon</span>
        <div className="inline-flex rounded border border-border overflow-hidden">
          {[14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => onHorizonChange(d)}
              className={`px-3 py-1 text-[11px] font-semibold transition-colors ${
                horizonDays === d ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-cream"
              }`}
            >
              {d} days
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer ml-2">
          <input
            type="checkbox"
            checked={needsReviewOnly}
            onChange={(e) => onNeedsReviewOnlyChange(e.target.checked)}
            className="accent-terra w-3.5 h-3.5"
          />
          Needs review only
        </label>

        <span className="ml-auto text-[12px] text-ink-3">
          {rows.length} item{rows.length === 1 ? "" : "s"}
          {reviewable.length > 0 && ` · ${reviewable.length} awaiting review`}
        </span>
      </div>

      {/* ── Rows ───────────────────────────────────────────────────────────── */}
      <div className="px-6 pb-6">
        {byDay.length > 0 && (
          <div className="flex items-center gap-3 px-5 pb-1.5 text-[10px] font-bold tracking-widest text-ink-3 uppercase">
            <span className="w-1 shrink-0" />
            <span className="w-44 shrink-0">Client</span>
            <span className="w-44 shrink-0">Service</span>
            <span className="w-32 shrink-0">Staff</span>
            <span className="flex-1 min-w-0">Email subject</span>
            <span className="w-24 shrink-0 text-right">Due</span>
            <span className="w-[104px] shrink-0 text-right">Status</span>
            <span className="w-4 shrink-0" />
          </div>
        )}
        {byDay.length === 0 ? (
          <div className="bg-white border border-border rounded-lg py-20 text-center">
            <p className="text-lg font-bold text-ink">Nothing scheduled</p>
            <p className="text-sm text-ink-3 mt-1">
              {needsReviewOnly ? "No drafts need review in this window" : "No engagements in this window"}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            {byDay.map(([date, dayRows]) => {
              const head = dayHeading(date, todayStr);
              return (
                <div key={date}>
                  <div className="px-5 py-2 bg-cream border-y border-border flex items-center justify-between">
                    <span className="text-[11px] font-bold tracking-widest text-ink-3 uppercase">{head.label}</span>
                    <span className={`text-[11px] font-semibold ${head.urgent ? "text-terra" : "text-ink-3"}`}>
                      {head.relative} · {dayRows.length}
                    </span>
                  </div>

                  {dayRows.map((ev) => {
                    const review = ev.review;
                    const style = review ? STATE_STYLE[review] : null;
                    return (
                      <div
                        key={ev.key}
                        className="flex items-center gap-3 px-5 py-2.5 border-b border-border/60 last:border-b-0 hover:bg-cream/60 transition-colors"
                      >
                        <span className="w-1 h-8 rounded-sm shrink-0" style={{ backgroundColor: TYPE_ACCENT[ev.kind] }} />

                        <button
                          onClick={() => onOpen(ev)}
                          className="flex-1 min-w-0 flex items-center gap-3 text-left"
                        >
                          <span className="w-44 shrink-0 flex items-center gap-1.5 min-w-0">
                            {ev.isVip && <span className="text-amber text-[10px] shrink-0">◆</span>}
                            <span className="font-bold text-[13px] text-ink truncate">{ev.householdName}</span>
                          </span>

                          <span className="w-44 shrink-0 text-[12px] text-ink-2 truncate">{typeLabel(ev)}</span>

                          <span className="w-32 shrink-0 flex items-center gap-1.5">
                            {ev.staffRole && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0"
                                style={ROLE_TINT[ev.staffRole] ? { backgroundColor: ROLE_TINT[ev.staffRole].bg, color: ROLE_TINT[ev.staffRole].fg } : undefined}
                              >
                                {ev.staffRole}
                              </span>
                            )}
                            <span className="text-[12px] text-ink-3 truncate">{ev.staffName ?? "—"}</span>
                          </span>

                          <span className="flex-1 min-w-0 text-[12px] text-ink-3 truncate italic">
                            {detailFor(ev)}
                          </span>

                          <span className="w-24 shrink-0 text-[11px] text-ink-3 tabular-nums text-right">
                            {ev.dueDate ? `Due ${shortDate(ev.dueDate)}` : ""}
                          </span>

                          {style ? (
                            <span
                              className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                              style={{ backgroundColor: style.bg, color: style.fg }}
                            >
                              {REVIEW_STATE_LABEL[review!]}
                            </span>
                          ) : (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cream-2 text-ink-3 whitespace-nowrap">
                              {ev.kind === "adhoc_due" ? "In person" : "Scheduled"}
                            </span>
                          )}

                          <span className="shrink-0 text-ink-3 text-sm w-4 text-right">›</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
