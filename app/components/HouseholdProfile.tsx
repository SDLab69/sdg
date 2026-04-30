"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NavBar from "./NavBar";
import { todayET, todayETString, utcToETYear } from "@/lib/utils/dates";
import EditHouseholdModal, { type HouseholdFull, type PetFull } from "./EditHouseholdModal";
import AddAppointmentModal from "./AddAppointmentModal";

// ─── Types ────────────────────────────────────────────────────────────────────
// HouseholdFull and PetFull are imported from EditHouseholdModal

// Local alias used throughout this component
type Pet = PetFull;

type ServiceClockFull = {
  last_visit: string | null;
  last_full_groom: string | null;
  next_brush_due: string | null;
  next_full_groom_due: string | null;
};

type Appointment = {
  id: string;
  date: string;
  time: string;
  service_type: string;
  notes: string | null;
  duration: number | null;
};

type ScheduleRow = {
  date: string;
  service: "brush_nail" | "full_groom";
  daysAway: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  const targetMonth = d.getMonth() + n;
  const targetYear = d.getFullYear() + Math.floor(targetMonth / 12);
  const normalMonth = ((targetMonth % 12) + 12) % 12;
  const maxDay = new Date(targetYear, normalMonth + 1, 0).getDate();
  return toYMD(new Date(targetYear, normalMonth, Math.min(d.getDate(), maxDay)));
}

function daysBetween(ymd: string, today: Date): number {
  const d = new Date(ymd + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function formatDate(ymd: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!ymd) return "—";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", opts ?? {
    month: "short", day: "numeric", year: "numeric",
  });
}

function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `in ${days}d`;
}

function to12hr(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  return `${h % 12 || 12}:${m} ${h >= 12 ? "pm" : "am"}`;
}

const SERVICE_APPT_LABELS: Record<string, string> = {
  full_groom: "Full Groom",
  brush_nail: "Brush & Nail",
  brush: "Brush",
  bath: "Bath",
  nail_trim: "Nail Trim",
  ear_cleaning: "Ear Cleaning",
  teeth_brushing: "Teeth Brushing",
  deshed_treatment: "De-shed Treatment",
  skunk_treatment: "Skunk Treatment",
  paw_pad_trim: "Paw Trim",
  sanitary_trim: "Sanitary Trim",
};

function buildSchedule(
  clock: ServiceClockFull,
  today: Date,
  horizon: Date
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];

  if (clock.next_brush_due) {
    let d = clock.next_brush_due;
    while (new Date(d + "T00:00:00") <= horizon) {
      rows.push({ date: d, service: "brush_nail", daysAway: daysBetween(d, today) });
      d = addMonths(d, 6);
    }
  }

  if (clock.next_full_groom_due) {
    let d = clock.next_full_groom_due;
    while (new Date(d + "T00:00:00") <= horizon) {
      rows.push({ date: d, service: "full_groom", daysAway: daysBetween(d, today) });
      d = addMonths(d, 12);
    }
  }

  // A full groom absorbs brush & nail when they fall on the same date.
  const fullGroomDates = new Set(
    rows.filter((r) => r.service === "full_groom").map((r) => r.date)
  );
  const deduped = rows.filter(
    (r) => !(r.service === "brush_nail" && fullGroomDates.has(r.date))
  );

  deduped.sort((a, b) => a.date.localeCompare(b.date));
  return deduped;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function HouseholdProfile({
  id,
  from,
}: {
  id: string;
  from: "calendar" | "clients" | "adhoc";
}) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();

  const [household, setHousehold] = useState<HouseholdFull | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [clock, setClock] = useState<ServiceClockFull | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [showApptModal, setShowApptModal] = useState(false);
  const [editingClock, setEditingClock] = useState<"brush_nail" | "full_groom" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }

  async function handleClockSave(kind: "brush_nail" | "full_groom", newYmd: string) {
    const field = kind === "brush_nail" ? "next_brush_due" : "next_full_groom_due";
    const { error } = await supabase
      .from("service_clocks")
      .update({ [field]: newYmd })
      .eq("household_id", id);
    if (error) throw new Error(error.message);
    setClock((prev) => (prev ? { ...prev, [field]: newYmd } : prev));
    setEditingClock(null);
    showToast(
      kind === "brush_nail"
        ? "Brush & nail due date updated"
        : "Full groom due date updated"
    );
  }

  function handleEditSuccess(updated: { household: HouseholdFull; pets: Pet[] }) {
    setHousehold(updated.household);
    setPets(updated.pets);
    setShowEditModal(false);
    showToast(`${updated.household.name} has been updated.`);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: hh }, { data: pp }, { data: sc }, { data: ap }] =
        await Promise.all([
          supabase
            .from("households")
            .select("id, name, phone, email, address, is_vip, created_at")
            .eq("id", id)
            .single(),
          supabase
            .from("pets")
            .select("id, name, breed, age, weight, grooming_notes, fur_color, coat_type, size, temperament, medical_flags")
            .eq("household_id", id),
          supabase
            .from("service_clocks")
            .select("last_visit, last_full_groom, next_brush_due, next_full_groom_due")
            .eq("household_id", id)
            .single(),
          supabase
            .from("appointments")
            .select("id, date, time, service_type, notes, duration")
            .eq("household_id", id)
            .order("date", { ascending: false }),
        ]);

      if (!hh) { setNotFound(true); setLoading(false); return; }
      setHousehold(hh);
      setPets(pp ?? []);
      setClock(sc ?? null);
      setAppointments(ap ?? []);
      setLoading(false);
    })();
  }, [supabase, id]);

  const today = useMemo(() => todayET(), []);

  const todayStr = toYMD(today);

  const horizon = useMemo(() => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 18);
    return d;
  }, [today]);

  const pastAppointments = useMemo(
    () => appointments.filter((a) => a.date <= todayStr),
    [appointments, todayStr]
  );

  const pastVisitCount = pastAppointments.length;

  const recentAppointments = pastAppointments.slice(0, 2);

  const schedule = useMemo(
    () => (clock ? buildSchedule(clock, today, horizon) : []),
    [clock, today, horizon]
  );

  const apptDateSet = useMemo(
    () => new Set(appointments.map((a) => a.date)),
    [appointments]
  );

  const scheduleByMonth = useMemo(() => {
    const map: [string, ScheduleRow[]][] = [];
    let lastKey = "";
    for (const row of schedule) {
      const key = row.date.slice(0, 7);
      if (key !== lastKey) {
        map.push([key, []]);
        lastKey = key;
      }
      map[map.length - 1][1].push(row);
    }
    return map;
  }, [schedule]);

  // ── Loading / not found ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <NavBar />
        <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">Loading…</div>
      </div>
    );
  }

  if (notFound || !household) {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <NavBar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-ink-3 mb-3">Household not found.</p>
            <button onClick={() => router.push("/clients")} className="text-sm text-terra underline">
              ← Back to Clients
            </button>
          </div>
        </div>
      </div>
    );
  }

  const clientSinceYear = utcToETYear(household.created_at);

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <NavBar />

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-border px-6 py-2.5 flex items-center justify-between shrink-0">
        <button
          onClick={() =>
            router.push(
              from === "calendar" ? "/" : from === "adhoc" ? "/adhoc" : "/clients"
            )
          }
          className="text-sm text-ink-3 hover:text-ink transition-colors flex items-center gap-1"
        >
          ←&nbsp;{from === "calendar" ? "Calendar" : from === "adhoc" ? "Ad Hoc" : "Clients"}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditModal(true)}
            className="px-3 py-1.5 text-[11px] font-bold border border-border rounded text-ink-2 hover:bg-cream transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => setShowApptModal(true)}
            className="px-3 py-1.5 text-[11px] font-bold bg-terra text-white rounded hover:opacity-90 transition-opacity"
          >
            + Appointment
          </button>
        </div>
      </div>

      {/* ── Page ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-5">

          {/* ── Hero ──────────────────────────────────────────────────────────── */}
          <div className="mb-5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-ink leading-tight">
                {household.name}
              </h1>
              {household.is_vip && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-pale text-amber border border-amber/30">
                  ◆ VIP
                </span>
              )}
            </div>
            <p className="text-xs text-ink-3 mt-1">
              <span className="font-medium text-ink-2">{pets.length}</span> {pets.length === 1 ? "pet" : "pets"}
              {" · "}
              <span className="font-medium text-ink-2">{pastVisitCount}</span> {pastVisitCount === 1 ? "visit" : "visits"}
              {" · "}
              Client since <span className="font-medium text-ink-2">{clientSinceYear}</span>
            </p>
          </div>

          {/* ── Main card ─────────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">

            {/* ── Two-column body ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-border">

              {/* Left: contact + service clocks */}
              <div className="divide-y divide-border">

                {/* Contact */}
                <div className="px-5 py-4">
                  <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-3">
                    Contact
                  </p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <ContactCell label="Phone" value={household.phone} />
                    <ContactCell label="Email" value={household.email} />
                    <ContactCell
                      label="Address"
                      value={household.address}
                      wide
                    />
                  </div>
                </div>

                {/* Service clocks */}
                <div className="px-5 py-4">
                  <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-3">
                    Service Clocks
                  </p>

                  {!clock ? (
                    <p className="text-xs text-ink-3">No service history recorded.</p>
                  ) : (
                    <>
                      {/* Stat cards */}
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <ClockStatCard
                          kind="brush_nail"
                          label="Next Brush & Nail"
                          ymd={clock.next_brush_due}
                          today={today}
                          isEditing={editingClock === "brush_nail"}
                          onEditStart={() => setEditingClock("brush_nail")}
                          onSave={(ymd) => handleClockSave("brush_nail", ymd)}
                          onCancel={() => setEditingClock(null)}
                          otherYmd={clock.next_full_groom_due}
                        />
                        <ClockStatCard
                          kind="full_groom"
                          label="Next Full Groom"
                          ymd={clock.next_full_groom_due}
                          today={today}
                          isEditing={editingClock === "full_groom"}
                          onEditStart={() => setEditingClock("full_groom")}
                          onSave={(ymd) => handleClockSave("full_groom", ymd)}
                          onCancel={() => setEditingClock(null)}
                          otherYmd={clock.next_brush_due}
                        />
                      </div>

                      {/* History rows */}
                      <div className="space-y-0 divide-y divide-border/60">
                        <HistoryRow
                          label="Last visit"
                          ymd={clock.last_visit}
                          today={today}
                        />
                        <HistoryRow
                          label="Last full groom"
                          ymd={clock.last_full_groom}
                          today={today}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Right: 18-month schedule */}
              <div>
                <div className="px-5 py-3 border-b border-border">
                  <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                    18-Month Service Schedule
                  </p>
                </div>

                {schedule.length === 0 ? (
                  <p className="text-xs text-ink-3 px-5 py-4">No service schedule available.</p>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-cream border-b border-border">
                        <th className="text-left px-5 py-2 text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                          Date
                        </th>
                        <th className="text-left px-3 py-2 text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                          Service
                        </th>
                        <th className="text-left px-3 py-2 text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                          Status
                        </th>
                        <th className="text-right px-4 py-2 text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                          Days Away
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleByMonth.map(([monthKey, rows]) => {
                        const [y, m] = monthKey.split("-").map(Number);
                        const monthLabel = `${MONTH_NAMES[m - 1]} ${y}`;
                        return (
                          <>
                            <tr key={`hdr-${monthKey}`} className="bg-cream-2/70">
                              <td
                                colSpan={4}
                                className="px-5 py-1.5 text-[10px] font-bold tracking-widest text-ink-3 uppercase border-b border-t border-border"
                              >
                                {monthLabel}
                              </td>
                            </tr>

                            {rows.map((row) => {
                              const isPast = row.daysAway < 0;
                              const isUrgent = !isPast && row.daysAway <= 14;
                              const isScheduled = apptDateSet.has(row.date);

                              return (
                                <tr
                                  key={`${row.date}-${row.service}`}
                                  className={[
                                    "border-b border-border last:border-b-0 transition-colors",
                                    isPast
                                      ? "opacity-40"
                                      : isUrgent
                                      ? "bg-terra-pale/20 hover:bg-terra-pale/35"
                                      : "hover:bg-cream/60",
                                  ].join(" ")}
                                >
                                  <td className="px-5 py-2 font-medium text-ink">
                                    {formatDate(row.date, {
                                      weekday: "short",
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </td>
                                  <td className="px-3 py-2 text-ink-2">
                                    {row.service === "full_groom" ? "Full Groom" : "Brush & Nail"}
                                  </td>
                                  <td className="px-3 py-2">
                                    {isScheduled ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-sage-pale text-sage">
                                        Scheduled
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-terra-pale text-terra">
                                        Pending
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className={`px-4 py-2 text-right tabular-nums ${
                                      isUrgent ? "text-terra font-bold" : "text-ink-3"
                                    }`}
                                  >
                                    {daysLabel(row.daysAway)}
                                  </td>
                                </tr>
                              );
                            })}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── Recent visits ────────────────────────────────────────────────── */}
            <div className="border-t border-border px-5 py-4">
              <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-3">
                Recent Visits
              </p>
              {recentAppointments.length === 0 ? (
                <p className="text-xs text-ink-3 italic">No previous visits on record</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recentAppointments.map((appt) => (
                    <div
                      key={appt.id}
                      style={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid #DDD0BC",
                        borderRadius: 10,
                        padding: 14,
                      }}
                    >
                      {/* Date · time · badge */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-sm font-semibold text-ink">
                          {formatDate(appt.date, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        {appt.time && (
                          <span className="text-xs text-ink-3">{to12hr(appt.time)}</span>
                        )}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            appt.service_type === "full_groom"
                              ? "bg-terra text-white"
                              : "bg-amber-pale text-amber"
                          }`}
                        >
                          {SERVICE_APPT_LABELS[appt.service_type] ?? appt.service_type}
                        </span>
                      </div>
                      {/* Notes */}
                      {appt.notes ? (
                        <p
                          className="italic leading-snug"
                          style={{ color: "#6B5D52", fontSize: 13 }}
                        >
                          {appt.notes}
                        </p>
                      ) : (
                        <p className="text-xs italic text-ink-3/50">No notes recorded</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Pets ──────────────────────────────────────────────────────────── */}
            <div className="border-t border-border px-5 py-4">
              <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-3">
                Pets
              </p>
              {pets.length === 0 ? (
                <p className="text-xs text-ink-3">No pets on file.</p>
              ) : (
                <div className="space-y-3">
                  {pets.map((pet) => {
                    const appearanceParts = [
                      pet.size ?? null,
                      pet.coat_type ? `${pet.coat_type} coat` : null,
                      pet.fur_color ?? null,
                    ].filter(Boolean);
                    const hasAppearance = appearanceParts.length > 0;
                    const hasBadgeRow = !!pet.temperament || (pet.medical_flags && pet.medical_flags.length > 0);

                    return (
                      <div
                        key={pet.id}
                        className="border-l-2 border-amber pl-3"
                      >
                        {/* Row 1: name · breed · age/weight */}
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-bold text-sm text-ink">{pet.name}</span>
                          {pet.breed && (
                            <span className="text-xs text-ink-3">{pet.breed}</span>
                          )}
                          {(pet.age != null || pet.weight != null) && (
                            <span className="text-xs text-ink-3 ml-auto">
                              {[
                                pet.age != null ? `${pet.age}y` : null,
                                pet.weight != null ? `${pet.weight} lbs` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>

                        {/* Row 2: size · coat · color */}
                        {hasAppearance && (
                          <p className="text-[11px] text-ink-3 mt-0.5">
                            {appearanceParts.join(" · ")}
                          </p>
                        )}

                        {/* Row 3: temperament badge + medical flag pills */}
                        {hasBadgeRow && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {pet.temperament && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cream-2 text-ink-3 border border-border">
                                {pet.temperament}
                              </span>
                            )}
                            {pet.medical_flags && pet.medical_flags.map((flag) => (
                              <span
                                key={flag}
                                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-pale text-amber border border-amber/40"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Row 4: grooming notes */}
                        {pet.grooming_notes && (
                          <p className="text-xs text-ink-3 mt-0.5 leading-snug">
                            {pet.grooming_notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
      {showEditModal && household && (
        <EditHouseholdModal
          household={household}
          pets={pets}
          onClose={() => setShowEditModal(false)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* ── Add appointment modal ────────────────────────────────────────────── */}
      {showApptModal && household && (
        <AddAppointmentModal
          householdId={household.id}
          householdName={household.name}
          onClose={() => setShowApptModal(false)}
          onSuccess={(message) => {
            setShowApptModal(false);
            showToast(message);
          }}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg bg-sage text-white text-sm font-medium whitespace-nowrap pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContactCell({
  label,
  value,
  wide,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <p className="text-[10px] font-bold tracking-wider text-ink-3 uppercase mb-0.5">
        {label}
      </p>
      <p className="text-sm text-ink leading-snug">{value ?? "—"}</p>
    </div>
  );
}

function ClockStatCard({
  kind,
  label,
  ymd,
  today,
  isEditing,
  onEditStart,
  onSave,
  onCancel,
  otherYmd,
}: {
  kind: "brush_nail" | "full_groom";
  label: string;
  ymd: string | null;
  today: Date;
  isEditing: boolean;
  onEditStart: () => void;
  onSave: (newYmd: string) => Promise<void>;
  onCancel: () => void;
  otherYmd: string | null;
}) {
  const [inputVal, setInputVal] = useState(ymd ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const todayYmd = todayETString();

  // Reset input value whenever edit mode opens
  useEffect(() => {
    if (isEditing) {
      setInputVal(ymd ?? "");
      setError("");
      setSaving(false);
    }
  }, [isEditing, ymd]);

  const days = ymd ? daysBetween(ymd, today) : null;
  const isUrgent = days !== null && days <= 14;

  function validate(val: string): string {
    if (!val) return "Date is required";
    if (val < todayYmd) return "Date cannot be in the past";
    const dow = new Date(val + "T00:00:00").getDay();
    if (dow === 0 || dow === 6) return "Please choose a weekday (Mon–Fri)";
    return "";
  }

  async function handleSave() {
    const err = validate(inputVal);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await onSave(inputVal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  // Proximity warning — advisory, does not block save
  const proximityWarning: string | null = (() => {
    if (!inputVal || !otherYmd) return null;
    const diff = Math.abs(
      new Date(inputVal + "T00:00:00").getTime() -
      new Date(otherYmd + "T00:00:00").getTime()
    ) / 86_400_000;
    if (diff >= 90) return null;
    const otherFormatted = new Date(otherYmd + "T00:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    return kind === "brush_nail"
      ? `This date is within 90 days of the scheduled full groom on ${otherFormatted}. Consider spacing them further apart.`
      : `This date is within 90 days of the scheduled brush & nail on ${otherFormatted}. Consider spacing them further apart.`;
  })();

  const INPUT = "w-full px-2 py-1 text-xs border rounded bg-white text-ink focus:outline-none focus:ring-1 focus:ring-terra/40 focus:border-terra/60 transition-colors";

  return (
    <div
      className={`group rounded-lg border px-3 py-2.5 ${
        isUrgent && !isEditing ? "border-terra/30 bg-terra-pale/20" : "border-border bg-cream/50"
      }`}
    >
      {/* Badge row + pencil */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5">
        <ServiceBadge kind={kind} />
        {!isEditing && (
          <button
            type="button"
            onClick={onEditStart}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-ink-3 hover:text-ink"
            aria-label="Edit date"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path
                d="M9 1.5l2.5 2.5L4 11.5H1.5V9L9 1.5z"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      <p className="text-xs text-ink-3 mb-1">{label}</p>

      {isEditing ? (
        <div className="space-y-1.5">
          <input
            type="date"
            value={inputVal}
            min={todayYmd}
            onChange={(e) => {
              setInputVal(e.target.value);
              if (error) setError("");
            }}
            className={`${INPUT} ${error ? "border-terra/60" : "border-border"}`}
          />
          {error && <p className="text-[11px] text-terra">{error}</p>}
          {proximityWarning && !error && (
            <p
              className="text-[11px] leading-snug px-2 py-1.5 rounded"
              style={{ color: "#B87A28", backgroundColor: "#FAE8C8" }}
            >
              {proximityWarning}
            </p>
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-2.5 py-1 text-[11px] font-bold bg-terra text-white rounded hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="text-[11px] text-ink-3 hover:text-ink transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm font-bold text-ink leading-tight">
            {ymd
              ? new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"}
          </p>
          {days !== null && (
            <p
              className={`text-[11px] mt-0.5 font-medium ${
                isUrgent ? "text-terra" : "text-ink-3"
              }`}
            >
              {daysLabel(days)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function HistoryRow({
  label,
  ymd,
  today,
}: {
  label: string;
  ymd: string | null;
  today: Date;
}) {
  const ago =
    ymd ? `${Math.abs(daysBetween(ymd, today))}d ago` : null;

  return (
    <div className="flex items-baseline justify-between py-2 gap-4">
      <span className="text-xs text-ink-3 shrink-0">{label}</span>
      <span className="text-xs text-ink-2 text-right">
        {ymd
          ? new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—"}
        {ago && (
          <span className="text-ink-3 ml-1.5">· {ago}</span>
        )}
      </span>
    </div>
  );
}

function ServiceBadge({ kind }: { kind: "brush_nail" | "full_groom" }) {
  if (kind === "full_groom")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-terra text-white">
        Full
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber text-white">
      Brush
    </span>
  );
}
