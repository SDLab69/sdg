"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayET, todayETString } from "@/lib/utils/dates";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType =
  | "brush"
  | "bath"
  | "nail_trim"
  | "ear_cleaning"
  | "teeth_brushing"
  | "deshed_treatment"
  | "skunk_treatment"
  | "paw_pad_trim"
  | "sanitary_trim";

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: "brush",             label: "Brush" },
  { value: "bath",              label: "Bath" },
  { value: "nail_trim",         label: "Nail Trim" },
  { value: "ear_cleaning",      label: "Ear Cleaning" },
  { value: "teeth_brushing",    label: "Teeth Brushing" },
  { value: "deshed_treatment",  label: "De-shed Treatment" },
  { value: "skunk_treatment",   label: "Skunk Treatment" },
  { value: "paw_pad_trim",      label: "Paw & Pad Trim" },
  { value: "sanitary_trim",     label: "Sanitary Trim" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Next Mon–Fri from today (tomorrow or later) in ET. */
function nextWeekdayET(): string {
  const d = todayET();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return toYMD(d);
}

function isWeekend(ymd: string): boolean {
  const dow = new Date(ymd + "T00:00:00").getDay();
  return dow === 0 || dow === 6;
}

function formatDisplayDate(ymd: string): string {
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AddAppointmentModal({
  householdId,
  householdName,
  onClose,
  onSuccess,
}: {
  householdId: string;
  householdName: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const supabase = useRef(createClient()).current;

  const [serviceType, setServiceType] = useState<ServiceType | "">("");
  const [notes, setNotes] = useState("");
  const [outreachDate, setOutreachDate] = useState(nextWeekdayET());

  const [serviceError, setServiceError] = useState("");
  const [dateError, setDateError] = useState("");
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    let valid = true;
    if (!serviceType) {
      setServiceError("Service type is required");
      valid = false;
    } else {
      setServiceError("");
    }
    if (!outreachDate) {
      setDateError("Outreach date is required");
      valid = false;
    } else if (isWeekend(outreachDate)) {
      setDateError("Please choose a weekday (Mon–Fri)");
      valid = false;
    } else {
      setDateError("");
    }
    return valid;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError("");

    const { error } = await supabase.from("adhoc_requests").insert({
      household_id: householdId,
      service_type: serviceType as ServiceType,
      requested_date: todayETString(),
      note: notes.trim() || null,
      status: "confirmed",
      outreach_date: outreachDate,
    });

    if (error) {
      setServerError(error.message);
      setSubmitting(false);
      return;
    }

    const serviceLabel =
      SERVICE_OPTIONS.find((o) => o.value === serviceType)?.label ?? serviceType;
    onSuccess(
      `${householdName} · ${serviceLabel} added to calendar for ${formatDisplayDate(outreachDate)}`
    );
  }

  const INPUT =
    "w-full px-3 py-2 text-sm border rounded bg-white text-ink placeholder-ink-3/50 focus:outline-none focus:ring-1 focus:ring-terra/40 focus:border-terra/60 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-md flex flex-col">

        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                className="text-ink tracking-tight leading-tight"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "18px" }}
              >
                Schedule Ad Hoc Service
              </h2>
              <p className="text-xs text-ink-3 mt-0.5">{householdName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-cream transition-colors shrink-0 mt-0.5"
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  d="M1 1l10 10M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-5 py-5 space-y-4">

            {/* Service type */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Service Type<span className="text-terra ml-0.5">*</span>
              </label>
              <select
                value={serviceType}
                onChange={(e) => {
                  setServiceType(e.target.value as ServiceType | "");
                  if (e.target.value) setServiceError("");
                }}
                className={`${INPUT} ${serviceError ? "border-terra/60" : "border-border"}`}
              >
                <option value="">Select a service…</option>
                {SERVICE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {serviceError && (
                <p className="text-[11px] text-terra">{serviceError}</p>
              )}
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special instructions…"
                rows={3}
                className={`${INPUT} border-border resize-none`}
              />
            </div>

            {/* Outreach date */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Schedule outreach for<span className="text-terra ml-0.5">*</span>
              </label>
              <input
                type="date"
                value={outreachDate}
                min={todayETString()}
                onChange={(e) => {
                  setOutreachDate(e.target.value);
                  setDateError("");
                }}
                className={`${INPUT} ${dateError ? "border-terra/60" : "border-border"}`}
              />
              {dateError && (
                <p className="text-[11px] text-terra">{dateError}</p>
              )}
              <p className="text-[11px] text-ink-3">Weekdays only (Mon–Fri)</p>
            </div>

            {/* Server error */}
            {serverError && (
              <div className="px-3 py-2.5 rounded bg-terra-pale border border-terra/30 text-sm text-terra">
                {serverError}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-ink-2 border border-border rounded hover:bg-cream transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-bold tracking-wide bg-terra text-white rounded hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Add to calendar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
