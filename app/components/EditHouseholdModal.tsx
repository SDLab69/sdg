"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HouseholdFull = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_vip: boolean;
  created_at: string;
};

export type PetFull = {
  id: string;
  name: string;
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

type HouseholdForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  is_vip: boolean;
};

// id = existing pet id, null = new pet being added
type PetEditForm = {
  id: string | null;
  name: string;
  breed: string;
  age: string;
  weight: string;
  grooming_notes: string;
  fur_color: string;
  coat_type: string;
  size: string;
  temperament: string;
  medical_flags: string[];
};

type FieldErrors = Partial<Record<
  "name" | "phone" | "pet0_name" | "pet0_breed" | "pet1_name" | "pet1_breed",
  string
>>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function petToForm(pet: PetFull): PetEditForm {
  return {
    id: pet.id,
    name: pet.name,
    breed: pet.breed ?? "",
    age: pet.age != null ? String(pet.age) : "",
    weight: pet.weight != null ? String(pet.weight) : "",
    grooming_notes: pet.grooming_notes ?? "",
    fur_color: pet.fur_color ?? "",
    coat_type: pet.coat_type ?? "",
    size: pet.size ?? "",
    temperament: pet.temperament ?? "",
    medical_flags: pet.medical_flags ?? [],
  };
}

const EMPTY_PET: PetEditForm = {
  id: null, name: "", breed: "", age: "", weight: "", grooming_notes: "",
  fur_color: "", coat_type: "", size: "", temperament: "", medical_flags: [],
};

// ─── Shared field primitives ──────────────────────────────────────────────────

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

// ─── Pet section ──────────────────────────────────────────────────────────────

const FUR_COLORS = ["black", "white", "brown", "golden", "cream", "gray", "red", "brindle", "merle", "mixed"];
const COAT_TYPES = ["smooth", "double", "curly", "wavy", "wiry", "long", "hairless"];
const SIZES = ["toy", "small", "medium", "large", "giant"];
const TEMPERAMENTS = ["calm", "friendly", "anxious", "reactive", "aggressive", "playful", "shy"];
const MEDICAL_FLAGS_LIST = ["allergies", "senior", "medication", "joint issues", "skin condition", "anxiety", "epilepsy", "post-surgery"];

function PetSection({
  index,
  pet,
  errors,
  onChange,
  onFlagsChange,
}: {
  index: number;
  pet: PetEditForm;
  errors: FieldErrors;
  onChange: (k: keyof PetEditForm, v: string) => void;
  onFlagsChange: (flags: string[]) => void;
}) {
  const nameKey = index === 0 ? "pet0_name" : "pet1_name" as const;
  const breedKey = index === 0 ? "pet0_breed" : "pet1_breed" as const;
  const nameError = errors[nameKey];
  const breedError = errors[breedKey];

  function toggleFlag(flag: string) {
    const current = pet.medical_flags ?? [];
    onFlagsChange(
      current.includes(flag) ? current.filter((f) => f !== flag) : [...current, flag]
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pet Name" required error={nameError}>
          <input
            type="text"
            value={pet.name}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="Buddy"
            className={`${INPUT} ${nameError ? "border-terra/60" : "border-border"}`}
          />
        </Field>
        <Field label="Breed" required error={breedError}>
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

      {/* ── Appearance ── */}
      <div className="pt-1">
        <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-2">Appearance</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fur Color">
            <select
              value={pet.fur_color}
              onChange={(e) => onChange("fur_color", e.target.value)}
              className={`${INPUT} border-border`}
            >
              <option value="">—</option>
              {FUR_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Coat Type">
            <select
              value={pet.coat_type}
              onChange={(e) => onChange("coat_type", e.target.value)}
              className={`${INPUT} border-border`}
            >
              <option value="">—</option>
              {COAT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Size">
            <select
              value={pet.size}
              onChange={(e) => onChange("size", e.target.value)}
              className={`${INPUT} border-border`}
            >
              <option value="">—</option>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* ── Behavior & Health ── */}
      <div className="pt-1">
        <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-2">Behavior &amp; Health</p>
        <Field label="Temperament">
          <select
            value={pet.temperament}
            onChange={(e) => onChange("temperament", e.target.value)}
            className={`${INPUT} border-border`}
          >
            <option value="">—</option>
            {TEMPERAMENTS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <div className="mt-3">
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase mb-1.5">Medical Flags</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {MEDICAL_FLAGS_LIST.map((flag) => (
              <label key={flag} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(pet.medical_flags ?? []).includes(flag)}
                  onChange={() => toggleFlag(flag)}
                  className="accent-terra w-3.5 h-3.5 shrink-0"
                />
                <span className="text-xs text-ink">{flag}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EditHouseholdModal({
  household,
  pets: initialPets,
  onClose,
  onSuccess,
}: {
  household: HouseholdFull;
  pets: PetFull[];
  onClose: () => void;
  onSuccess: (updated: { household: HouseholdFull; pets: PetFull[] }) => void;
}) {
  const supabase = useRef(createClient()).current;

  // ── Form state — pre-populated from props ──────────────────────────────────
  const [hForm, setHForm] = useState<HouseholdForm>({
    name: household.name,
    phone: household.phone ?? "",
    email: household.email ?? "",
    address: household.address ?? "",
    is_vip: household.is_vip,
  });

  // Build initial pet forms from existing pets; always keep at least one slot
  const [petForms, setPetForms] = useState<PetEditForm[]>(() => {
    const forms = initialPets.slice(0, 2).map(petToForm);
    return forms.length > 0 ? forms : [{ ...EMPTY_PET }];
  });

  // Second pet slot visibility: start open if household already has 2 pets
  const [showSecondPet, setShowSecondPet] = useState(initialPets.length >= 2);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Setters ───────────────────────────────────────────────────────────────

  function setH<K extends keyof HouseholdForm>(k: K, v: HouseholdForm[K]) {
    setHForm((h) => ({ ...h, [k]: v }));
    if (k === "name" && errors.name) setErrors((e) => ({ ...e, name: undefined }));
    if (k === "phone" && errors.phone) setErrors((e) => ({ ...e, phone: undefined }));
  }

  function setPetField(i: number, k: keyof PetEditForm, v: string) {
    setPetForms((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
    const nameKey = i === 0 ? "pet0_name" : "pet1_name";
    const breedKey = i === 0 ? "pet0_breed" : "pet1_breed";
    if (k === "name" && errors[nameKey as keyof FieldErrors])
      setErrors((e) => ({ ...e, [nameKey]: undefined }));
    if (k === "breed" && errors[breedKey as keyof FieldErrors])
      setErrors((e) => ({ ...e, [breedKey]: undefined }));
  }

  function setPetFlags(i: number, flags: string[]) {
    setPetForms((ps) => ps.map((p, idx) => (idx === i ? { ...p, medical_flags: flags } : p)));
  }

  function handleAddSecondPet() {
    // Only add a form slot if we don't already have one for the second pet
    if (petForms.length < 2) {
      setPetForms((ps) => [...ps, { ...EMPTY_PET }]);
    }
    setShowSecondPet(true);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: FieldErrors = {};
    if (!hForm.name.trim()) errs.name = "Household name is required";
    if (!hForm.phone.trim()) errs.phone = "Phone number is required";
    if (!petForms[0]?.name.trim()) errs.pet0_name = "Pet name is required";
    if (!petForms[0]?.breed.trim()) errs.pet0_breed = "Breed is required";
    if (showSecondPet && petForms[1]) {
      if (!petForms[1].name.trim()) errs.pet1_name = "Pet name is required";
      if (!petForms[1].breed.trim()) errs.pet1_breed = "Breed is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setServerError(null);

    try {
      // 1. Update household
      const { data: updatedHH, error: hhErr } = await supabase
        .from("households")
        .update({
          name: hForm.name.trim(),
          phone: hForm.phone.trim() || null,
          email: hForm.email.trim() || null,
          address: hForm.address.trim() || null,
          is_vip: hForm.is_vip,
        })
        .eq("id", household.id)
        .select("id, name, phone, email, address, is_vip, created_at")
        .single();

      if (hhErr || !updatedHH) throw new Error(hhErr?.message ?? "Failed to update household");

      // 2. Update existing pets
      const existingForms = petForms.filter((p) => p.id !== null);
      for (const pf of existingForms) {
        const { error: petErr } = await supabase
          .from("pets")
          .update({
            name: pf.name.trim(),
            breed: pf.breed.trim() || null,
            age: pf.age !== "" ? parseFloat(pf.age) : null,
            weight: pf.weight !== "" ? parseFloat(pf.weight) : null,
            grooming_notes: pf.grooming_notes.trim() || null,
            fur_color: pf.fur_color || null,
            coat_type: pf.coat_type || null,
            size: pf.size || null,
            temperament: pf.temperament || null,
            medical_flags: pf.medical_flags.length > 0 ? pf.medical_flags : null,
          })
          .eq("id", pf.id!);
        if (petErr) throw new Error(petErr.message);
      }

      // 3. Insert new pet (if second slot was added and has a name)
      const newPetForms = petForms.filter(
        (p, i) => p.id === null && p.name.trim() && (i === 0 || showSecondPet)
      );
      let insertedPets: PetFull[] = [];
      if (newPetForms.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("pets")
          .insert(
            newPetForms.map((pf) => ({
              household_id: household.id,
              name: pf.name.trim(),
              breed: pf.breed.trim() || null,
              age: pf.age !== "" ? parseFloat(pf.age) : null,
              weight: pf.weight !== "" ? parseFloat(pf.weight) : null,
              grooming_notes: pf.grooming_notes.trim() || null,
              fur_color: pf.fur_color || null,
              coat_type: pf.coat_type || null,
              size: pf.size || null,
              temperament: pf.temperament || null,
              medical_flags: pf.medical_flags.length > 0 ? pf.medical_flags : null,
            }))
          )
          .select("id, name, breed, age, weight, grooming_notes, fur_color, coat_type, size, temperament, medical_flags");
        if (insErr) throw new Error(insErr.message);
        insertedPets = (inserted as PetFull[]) ?? [];
      }

      // 4. Build updated pets list to return
      const updatedPets: PetFull[] = [
        // Re-shaped existing pets from form state
        ...existingForms.map((pf) => ({
          id: pf.id!,
          name: pf.name.trim(),
          breed: pf.breed.trim() || null,
          age: pf.age !== "" ? parseFloat(pf.age) : null,
          weight: pf.weight !== "" ? parseFloat(pf.weight) : null,
          grooming_notes: pf.grooming_notes.trim() || null,
          fur_color: pf.fur_color || null,
          coat_type: pf.coat_type || null,
          size: pf.size || null,
          temperament: pf.temperament || null,
          medical_flags: pf.medical_flags.length > 0 ? pf.medical_flags : null,
        })),
        ...insertedPets,
      ];

      onSuccess({ household: updatedHH as HouseholdFull, pets: updatedPets });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2
            className="text-ink tracking-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "18px" }}
          >
            Edit {household.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
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

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

            {/* ── Household section ── */}
            <div>
              <SectionHeader>Household Details</SectionHeader>
              <div className="space-y-3">
                <Field label="Household Name" required error={errors.name}>
                  <input
                    type="text"
                    value={hForm.name}
                    onChange={(e) => setH("name", e.target.value)}
                    placeholder="The Johnson Family"
                    className={`${INPUT} ${errors.name ? "border-terra/60" : "border-border"}`}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone" required error={errors.phone}>
                    <input
                      type="tel"
                      value={hForm.phone}
                      onChange={(e) => setH("phone", e.target.value)}
                      placeholder="(555) 000-0000"
                      className={`${INPUT} ${errors.phone ? "border-terra/60" : "border-border"}`}
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={hForm.email}
                      onChange={(e) => setH("email", e.target.value)}
                      placeholder="name@example.com"
                      className={`${INPUT} border-border`}
                    />
                  </Field>
                </div>
                <Field label="Street Address">
                  <input
                    type="text"
                    value={hForm.address}
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
                    aria-checked={hForm.is_vip}
                    onClick={() => setH("is_vip", !hForm.is_vip)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus:outline-none ${
                      hForm.is_vip
                        ? "bg-amber border-amber"
                        : "bg-cream-2 border-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        hForm.is_vip ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-ink-2">
                    VIP client
                    {hForm.is_vip && (
                      <span className="ml-2 text-[10px] font-bold tracking-wide text-amber uppercase">
                        ★ Active
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Pet sections ── */}
            <div>
              <SectionHeader>
                {showSecondPet ? "First Pet" : "Pet Details"}
              </SectionHeader>
              {petForms[0] && (
                <PetSection
                  index={0}
                  pet={petForms[0]}
                  errors={errors}
                  onChange={(k, v) => setPetField(0, k, v)}
                  onFlagsChange={(flags) => setPetFlags(0, flags)}
                />
              )}
            </div>

            {/* Second pet — only shown if household had 2 pets or Sam adds one */}
            {showSecondPet && petForms[1] ? (
              <div>
                <SectionHeader>Second Pet</SectionHeader>
                <PetSection
                  index={1}
                  pet={petForms[1]}
                  errors={errors}
                  onChange={(k, v) => setPetField(1, k, v)}
                  onFlagsChange={(flags) => setPetFlags(1, flags)}
                />
              </div>
            ) : (
              // Show "add" link only if household currently has just 1 pet
              initialPets.length < 2 && !showSecondPet && (
                <button
                  type="button"
                  onClick={handleAddSecondPet}
                  className="text-[12px] font-semibold text-terra hover:text-terra/80 transition-colors"
                >
                  + Add another pet
                </button>
              )
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
              {submitting ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
