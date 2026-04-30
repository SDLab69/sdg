/**
 * Test cases for the filter-parsing LLM.
 *
 * Each case defines a natural language query and what we expect the LLM to
 * produce. The harness doesn't require exact JSON matching — it checks that
 * the expected fields appear, and optionally that the final SQL returns
 * sensible results.
 */

export interface TestCase {
  name: string;
  query: string;
  // Fields we expect to see in the parsed filter. Order doesn't matter.
  expectFields: string[];
  // Whether this should be an error response instead of a filter
  expectError?:
    | "unsupported_field"
    | "ambiguous_query"
    | "unknown_value"
    | "empty_query";
  // If provided, run the filter against Supabase and expect N+ results
  expectMinResults?: number;
  // If provided, expect exactly 0 results (useful for "no matches" cases)
  expectZeroResults?: boolean;
}

export const TEST_CASES: TestCase[] = [
  // --- Basic single-field filters ---
  {
    name: "Single breed",
    query: "Show me all the Goldendoodles",
    expectFields: ["pet.breed"],
    expectMinResults: 1,
  },
  {
    name: "Single color",
    query: "Dogs with black fur",
    expectFields: ["pet.fur_color"],
    expectMinResults: 1,
  },
  {
    name: "Single size",
    query: "Giant dogs",
    expectFields: ["pet.size"],
    expectMinResults: 1,
  },

  // --- Compound filters ---
  {
    name: "Breed + color",
    query: "Black labs",
    expectFields: ["pet.breed", "pet.fur_color"],
  },
  {
    name: "Size + coat",
    query: "Large curly-coated dogs",
    expectFields: ["pet.size", "pet.coat_type"],
  },
  {
    name: "VIP + temperament",
    query: "VIP clients with anxious dogs",
    expectFields: ["household.is_vip", "pet.temperament"],
  },

  // --- Date reasoning ---
  {
    name: "Overdue for grooming",
    query: "Clients overdue for a full groom",
    expectFields: ["service.next_full_groom_due"],
  },
  {
    name: "Haven't seen in 3 months",
    query: "Clients I haven't seen in 3 months",
    expectFields: ["service.last_visit"],
  },
  {
    name: "Scheduled this week",
    query: "Appointments scheduled this week",
    expectFields: ["appointment.date"],
  },
  {
    name: "Next 2 weeks due for brush",
    query: "Dogs due for a brush in the next 2 weeks",
    expectFields: ["service.next_brush_due"],
  },

  // --- Abbreviation / fuzzy language ---
  {
    name: "Big dogs (fuzzy size)",
    query: "Show me the big dogs",
    expectFields: ["pet.size"],
  },
  {
    name: "Lab abbreviation",
    query: "All my labs",
    expectFields: ["pet.breed"],
  },

  // --- Medical flags (tag array) ---
  {
    name: "Senior dogs",
    query: "Senior dogs",
    expectFields: ["pet.medical_flags"],
    expectMinResults: 1,
  },
  {
    name: "Dogs with allergies",
    query: "Dogs with allergies",
    expectFields: ["pet.medical_flags"],
    expectMinResults: 1,
  },

  // --- OR / in_list ---
  {
    name: "Aggressive or reactive",
    query: "Aggressive or reactive dogs",
    expectFields: ["pet.temperament"],
  },

  // --- Service type ---
  {
    name: "Deshed appointments",
    query: "Everyone scheduled for a deshed treatment",
    expectFields: ["appointment.service_type"],
  },

  // --- Complex multi-field ---
  {
    name: "Senior black labs overdue",
    query: "Senior black labs overdue for grooming",
    expectFields: ["pet.medical_flags", "pet.fur_color", "pet.breed", "service.next_full_groom_due"],
  },

  {
    name: "Plain name search",
    query: "Abernathy",
    expectFields: ["household.name"],
  },

  // --- Error cases ---
  {
    name: "Unsupported field (barking)",
    query: "Dogs that bark a lot",
    expectError: "unsupported_field",
    expectFields: [],
  },
  {
    name: "Unknown enum value (purple)",
    query: "Dogs with purple fur",
    expectError: "unknown_value",
    expectFields: [],
  },
  {
    name: "Empty query",
    query: "hello",
    expectError: "empty_query",
    expectFields: [],
  },
];
