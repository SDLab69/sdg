"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayET } from "@/lib/utils/dates";

// ─── Types ────────────────────────────────────────────────────────────────────

type HouseholdForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  is_vip: boolean;
};

type PetForm = {
  name: string;
  breed: string;
  age: string;
  weight: string;
  grooming_notes: string;
};

type FieldErrors = Partial<Record<
  "name" | "phone" | "pet0_name" | "pet0_breed",
  string
>>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonthsWeekday(months: number): string {
  const d = todayET(); // today's calendar date in Eastern Time
  d.setMonth(d.getMonth() + months);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);      // Saturday → Monday
  else if (dow === 0) d.setDate(d.getDate() + 1); // Sunday → Monday
  return toYMD(d);
}

const EMPTY_PET: PetForm = {
  name: "", breed: "", age: "", weight: "", grooming_notes: "",
};

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        {label}
        {required && <span className="text-terra ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-terra mt-0.5">{error}</p>}
    </div>
  );
}

const INPUT =
  "w-full px-3 py-2 text-sm border rounded bg-white text-ink placeholder-ink-3/50 focus:outline-none focus:ring-1 focus:ring-terra/40 focus:border-terra/60 transition-colors";

// ─── Pet section ──────────────────────────────────────────────────────────────

function PetSection({
  index,
  pet,
  errors,
  onChange,
}: {
  index: number;
  pet: PetForm;
  errors: FieldErrors;
  onChange: (k: keyof PetForm, v: string) => void;
}) {
  const nameError = index === 0 ? errors.pet0_name : undefined;
  const breedError = index === 0 ? errors.pet0_breed : undefined;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pet Name" required={index === 0} error={nameError}>
          <input
            type="text"
            value={pet.name}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="Buddy"
            className={`${INPUT} ${nameError ? "border-terra/60" : "border-border"}`}
          />
        </Field>
        <Field label="Breed" required={index === 0} error={breedError}>
          <input
            type="text"
            value={pet.breed}
            onChange={(e) => onChange("breed", e.target.value)}
            placeholder="Golden Retriever"
            className={`${INPUT} ${breedError ? "border-terra/60" : "border-border"}`}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Age (years)">
          <input
            type="number"
            min="0"
            step="0.5"
            value={pet.age}
            onChange={(e) => onChange("age", e.target.value)}
            placeholder="3"
            className={`${INPUT} border-border`}
          />
        </Field>
        <Field label="Weight (lbs)">
          <input
            type="number"
            min="0"
            step="0.1"
            value={pet.weight}
            onChange={(e) => onChange("weight", e.target.value)}
            placeholder="65"
            className={`${INPUT} border-border`}
          />
        </Field>
      </div>
      <Field label="Grooming Notes">
        <textarea
          value={pet.grooming_notes}
          onChange={(e) => onChange("grooming_notes", e.target.value)}
          placeholder="Sensitive skin, dislikes nail trimming…"
          rows={2}
          className={`${INPUT} border-border resize-none`}
        />
      </Field>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[11px] font-bold tracking-widest text-ink-3 uppercase whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewClientModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const supabase = useRef(createClient()).current;

  const [household, setHousehold] = useState<HouseholdForm>({
    name: "", phone: "", email: "", address: "", is_vip: false,
  });
  const [pets, setPets] = useState<PetForm[]>([{ ...EMPTY_PET }]);
  const [showSecondPet, setShowSecondPet] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setH<K extends keyof HouseholdForm>(k: K, v: HouseholdForm[K]) {
    setHousehold((h) => ({ ...h, [k]: v }));
    if (k === "name" && errors.name) setErrors((e) => ({ ...e, name: undefined }));
    if (k === "phone" && errors.phone) setErrors((e) => ({ ...e, phone: undefined }));
  }

  function setPetField(i: number, k: keyof PetForm, v: string) {
    setPets((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
    if (i === 0 && k === "name" && errors.pet0_name)
      setErrors((e) => ({ ...e, pet0_name: undefined }));
    if (i === 0 && k === "breed" && errors.pet0_breed)
      setErrors((e) => ({ ...e, pet0_breed: undefined }));
  }

  function handleAddSecondPet() {
    if (pets.length < 2) setPets((ps) => [...ps, { ...EMPTY_PET }]);
    setShowSecondPet(true);
  }

  function validate(): boolean {
    const errs: FieldErrors = {};
    if (!household.name.trim()) errs.name = "Household name is required";
    if (!household.phone.trim()) errs.phone = "Phone number is required";
    if (!pets[0].name.trim()) errs.pet0_name = "Pet name is required";
    if (!pets[0].breed.trim()) errs.pet0_breed = "Breed is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError(null);

    try {
      // 1. Insert household
      const { data: hhData, error: hhError } = await supabase
        .from("households")
        .insert({
          name: household.name.trim(),
          phone: household.phone.trim() || null,
          email: household.email.trim() || null,
          address: household.address.trim() || null,
          is_vip: household.is_vip,
        })
        .select("id")
        .single();

      if (hhError || !hhData) throw new Error(hhError?.message ?? "Failed to create household");
      const householdId = hhData.id;

      // 2. Insert pets (only rows with a name)
      const petRows = pets
        .filter((p) => p.name.trim())
        .map((p) => ({
          household_id: householdId,
          name: p.name.trim(),
          breed: p.breed.trim() || null,
          age: p.age !== "" ? parseFloat(p.age) : null,
          weight: p.weight !== "" ? parseFloat(p.weight) : null,
          grooming_notes: p.grooming_notes.trim() || null,
        }));

      const { error: petError } = await supabase.from("pets").insert(petRows);
      if (petError) throw new Error(petError.message);

      // 3. Insert service_clocks
      const { error: clockError } = await supabase.from("service_clocks").insert({
        household_id: householdId,
        last_visit: null,
        last_full_groom: null,
        next_brush_due: addMonthsWeekday(6),
        next_full_groom_due: addMonthsWeekday(12),
      });
      if (clockError) throw new Error(clockError.message);

      // Show success state, then close
      setSuccessName(household.name.trim());
      onSuccess();
      closeTimerRef.current = setTimeout(() => onClose(), 1800);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  // Clean up timer if modal is unmounted early
  function handleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={successName ? undefined : handleClose}
      />

      {/* Card */}
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2
            className="text-ink tracking-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "18px" }}
          >
            Add New Client
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-cream transition-colors"
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

        {/* ── Success state ── */}
        {successName ? (
          <div className="flex-1 flex flex-col items-center justify-center px-5 py-12 gap-3">
            <div className="w-10 h-10 rounded-full bg-sage-pale flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M4 10l4.5 4.5 7.5-8"
                  stroke="#2D5E32"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-ink text-center">
              <span className="font-semibold">{successName}</span> has been added.
            </p>
            <p className="text-xs text-ink-3">Closing…</p>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

              {/* ── Household section ── */}
              <div>
                <SectionHeader>Household Details</SectionHeader>
                <div className="space-y-3">
                  <Field label="Household Name" required error={errors.name}>
                    <input
                      type="text"
                      value={household.name}
                      onChange={(e) => setH("name", e.target.value)}
                      placeholder="The Johnson Family"
                      className={`${INPUT} ${errors.name ? "border-terra/60" : "border-border"}`}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Phone" required error={errors.phone}>
                      <input
                        type="tel"
                        value={household.phone}
                        onChange={(e) => setH("phone", e.target.value)}
                        placeholder="(555) 000-0000"
                        className={`${INPUT} ${errors.phone ? "border-terra/60" : "border-border"}`}
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        type="email"
                        value={household.email}
                        onChange={(e) => setH("email", e.target.value)}
                        placeholder="name@example.com"
                        className={`${INPUT} border-border`}
                      />
                    </Field>
                  </div>
                  <Field label="Street Address">
                    <input
                      type="text"
                      value={household.address}
                      onChange={(e) => setH("address", e.target.value)}
                      placeholder="123 Main St, Springfield"
                      className={`${INPUT} border-border`}
                    />
                  </Field>

                  {/* VIP toggle */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={household.is_vip}
                      onClick={() => setH("is_vip", !household.is_vip)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus:outline-none ${
                        household.is_vip
                          ? "bg-amber border-amber"
                          : "bg-cream-2 border-border"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                          household.is_vip ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="text-sm text-ink-2">
                      VIP client
                      {household.is_vip && (
                        <span className="ml-2 text-[10px] font-bold tracking-wide text-amber uppercase">
                          ★ Active
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Pet 1 section ── */}
              <div>
                <SectionHeader>
                  {showSecondPet ? "First Pet" : "Pet Details"}
                </SectionHeader>
                <PetSection
                  index={0}
                  pet={pets[0]}
                  errors={errors}
                  onChange={(k, v) => setPetField(0, k, v)}
                />
              </div>

              {/* ── Pet 2 section ── */}
              {showSecondPet && pets[1] ? (
                <div>
                  <SectionHeader>Second Pet</SectionHeader>
                  <PetSection
                    index={1}
                    pet={pets[1]}
                    errors={errors}
                    onChange={(k, v) => setPetField(1, k, v)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddSecondPet}
                  className="text-[12px] font-semibold text-terra hover:text-terra/80 transition-colors"
                >
                  + Add another pet
                </button>
              )}

              {/* ── Server error ── */}
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
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-ink-2 border border-border rounded hover:bg-cream transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-bold tracking-wide bg-terra text-white rounded hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {submitting ? "Saving…" : "+ Add Client"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
