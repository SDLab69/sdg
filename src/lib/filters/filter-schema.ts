/**
 * Filter schema for natural language client list filtering.
 *
 * This is the single source of truth for what the LLM can produce and
 * what the backend will accept. It's used in three places:
 *   1. Serialized into the system prompt so the LLM knows what's allowed
 *   2. Validated against incoming JSON from the LLM (rejects unknown fields)
 *   3. Translated into a parameterized Supabase query
 *
 * To add a new filterable field: add it to FilterableField, add its type to
 * FIELD_TYPES, and (if it's an enum) add its values to the enums map.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export const FilterableField = z.enum([
  // Household
  "household.name",
  "household.is_vip",
  "household.address",
  "household.created_at",

  // Pet — existing columns
  "pet.breed",
  "pet.age",
  "pet.weight",
  "pet.grooming_notes",

  // Pet — new columns to add
  "pet.fur_color",
  "pet.coat_type",
  "pet.size",
  "pet.temperament",
  "pet.medical_flags",

  // Service timing (from service_clocks)
  "service.last_visit",
  "service.last_full_groom",
  "service.next_brush_due",
  "service.next_full_groom_due",

  // Appointments
  "appointment.date",
  "appointment.service_type",
  "appointment.is_adhoc",
]);
export type FilterableField = z.infer<typeof FilterableField>;

// ---------------------------------------------------------------------------
// Field type map — tells the validator what operators and value shapes apply
// ---------------------------------------------------------------------------

export const FIELD_TYPES: Record<
  FilterableField,
  "string" | "number" | "boolean" | "date" | "enum" | "tags"
> = {
  "household.name": "string",
  "household.is_vip": "boolean",
  "household.address": "string",
  "household.created_at": "date",

  "pet.breed": "string",
  "pet.age": "number",
  "pet.weight": "number",
  "pet.grooming_notes": "string",

  "pet.fur_color": "enum",
  "pet.coat_type": "enum",
  "pet.size": "enum",
  "pet.temperament": "enum",
  "pet.medical_flags": "tags",

  "service.last_visit": "date",
  "service.last_full_groom": "date",
  "service.next_brush_due": "date",
  "service.next_full_groom_due": "date",

  "appointment.date": "date",
  "appointment.service_type": "enum",
  "appointment.is_adhoc": "boolean",
};

// ---------------------------------------------------------------------------
// Enum values — the exact allowed values for each enum field
// Edit these lists as your vocabulary solidifies. The LLM will only pick
// from these; if it can't map the user's query to one, it returns an error.
// ---------------------------------------------------------------------------

export const FUR_COLORS = [
  "black",
  "white",
  "brown",
  "golden",
  "cream",
  "gray",
  "red",
  "brindle",
  "merle",
  "mixed",
] as const;

export const COAT_TYPES = [
  "short",
  "medium",
  "long",
  "double",
  "curly",
  "wire",
  "silky",
  "hairless",
] as const;

export const SIZES = ["toy", "small", "medium", "large", "giant"] as const;

export const TEMPERAMENTS = [
  "calm",
  "friendly",
  "anxious",
  "aggressive",
  "energetic",
  "shy",
  "reactive",
] as const;

export const MEDICAL_FLAGS = [
  "allergies",
  "senior",
  "puppy",
  "skin_condition",
  "arthritis",
  "heart_condition",
  "diabetic",
  "on_medication",
] as const;

// Matches the Postgres enum already defined in your schema
export const SERVICE_TYPES = [
  "full_groom",
  "brush_nail",
  "brush",
  "bath",
  "nail_trim",
  "ear_cleaning",
  "teeth_brushing",
  "deshed_treatment",
  "skunk_treatment",
  "paw_pad_trim",
  "sanitary_trim",
] as const;

export const ENUM_VALUES: Partial<Record<FilterableField, readonly string[]>> = {
  "pet.fur_color": FUR_COLORS,
  "pet.coat_type": COAT_TYPES,
  "pet.size": SIZES,
  "pet.temperament": TEMPERAMENTS,
  "pet.medical_flags": MEDICAL_FLAGS,
  "appointment.service_type": SERVICE_TYPES,
};

// ---------------------------------------------------------------------------
// Operator schemas — each one pairs a field with its valid operator + value
// ---------------------------------------------------------------------------

const StringFilter = z.object({
  field: z.enum([
    "household.name",
    "household.address",
    "pet.breed",
    "pet.grooming_notes",
  ]),
  op: z.enum(["equals", "contains"]),
  value: z.string().min(1),
});

const NumberFilter = z.object({
  field: z.enum(["pet.age", "pet.weight"]),
  op: z.enum(["equals", "greater_than", "less_than", "between"]),
  value: z.union([z.number(), z.tuple([z.number(), z.number()])]),
});

const BooleanFilter = z.object({
  field: z.enum(["household.is_vip", "appointment.is_adhoc"]),
  op: z.literal("equals"),
  value: z.boolean(),
});

// ISO date (YYYY-MM-DD). The LLM resolves "recently", "overdue", etc. to
// concrete dates using the current date injected into the system prompt.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DateFilter = z.object({
  field: z.enum([
    "household.created_at",
    "service.last_visit",
    "service.last_full_groom",
    "service.next_brush_due",
    "service.next_full_groom_due",
    "appointment.date",
  ]),
  op: z.enum(["equals", "before", "after", "between"]),
  value: z.union([isoDate, z.tuple([isoDate, isoDate])]),
});

const EnumFilter = z.object({
  field: z.enum([
    "pet.fur_color",
    "pet.coat_type",
    "pet.size",
    "pet.temperament",
    "appointment.service_type",
  ]),
  op: z.enum(["equals", "in_list"]),
  value: z.union([z.string(), z.array(z.string()).min(1)]),
});

// Tags work like enums but a pet can have multiple values (e.g. both
// "allergies" and "senior"), so operators are contains/contains_any.
const TagsFilter = z.object({
  field: z.literal("pet.medical_flags"),
  op: z.enum(["contains", "contains_any", "contains_all"]),
  value: z.union([z.string(), z.array(z.string()).min(1)]),
});

export const Filter = z.union([
  StringFilter,
  NumberFilter,
  BooleanFilter,
  DateFilter,
  EnumFilter,
  TagsFilter,
]);
export type Filter = z.infer<typeof Filter>;

// ---------------------------------------------------------------------------
// The top-level query object the LLM returns
// ---------------------------------------------------------------------------

export const FilterQuery = z.object({
  filters: z.array(Filter).max(10),
  logic: z.enum(["AND", "OR"]).default("AND"),
});
export type FilterQuery = z.infer<typeof FilterQuery>;

// ---------------------------------------------------------------------------
// Error shape the LLM returns when it can't resolve the query
// ---------------------------------------------------------------------------

export const FilterError = z.object({
  error: z.enum([
    "unsupported_field",
    "ambiguous_query",
    "unknown_value",
    "empty_query",
  ]),
  message: z.string(),
  suggestion: z.string().optional(),
});
export type FilterError = z.infer<typeof FilterError>;

// The LLM returns one or the other
export const LLMResponse = z.union([FilterQuery, FilterError]);
export type LLMResponse = z.infer<typeof LLMResponse>;
