/**
 * Four campaign revisions. Each defeats a different assumption that a purely
 * structural diff makes, which is the point: the diff tells you *what* moved,
 * Jev tells you what it *means*.
 */

import { BEFORE, clone } from "./campaign.ts";
import type { Campaign, Scenario } from "./types.ts";

// --- 1: budget -------------------------------------------------------------

function budgetRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";
  c.budget.total = 310000;
  c.budget.daily_cap = 6200;
  c.budget.pacing = "accelerated";
  c.budget.allocations = [
    { channel: "paid_search", amount: 140000 },
    { channel: "paid_social", amount: 105000 },
    { channel: "display", amount: 35000 },
    { channel: "video", amount: 30000 },
  ];
  c.goals.targets = { mqls: 1500, sqls: 300, pipeline_usd: 4500000 };
  return c;
}

// --- 2: creative -----------------------------------------------------------

function creativeRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  const email = c.channels[0];

  // Structurally identical edit #1: a plain reword, same meaning.
  email.creatives[0].subject = "Transform your pipeline this quarter";

  // Structurally identical edit #2: adds an unsubstantiated performance claim.
  email.creatives[1].subject = "Your Q4 pipeline, rebuilt — guaranteed 3x ROI";

  // Noise: casing and whitespace only.
  email.creatives[0].preheader = "See How Enterprise Teams Close Faster";
  email.creatives[1].preheader = "A practical guide for enterprise teams ";
  c.landing.utm.content = "Variant_A";

  return c;
}

// --- 3: schedule -----------------------------------------------------------

function scheduleRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // Two edits in plain English: drop the morning window, and pull Thursday
  // in by an hour. Because send_windows has no ids, an index-matched differ
  // reports this as almost every field on almost every element changing.
  c.schedule.send_windows = [
    { days: ["mon", "tue", "wed"], start: "13:00", end: "17:00" },
    { days: ["thu"], start: "09:00", end: "16:00" },
    { days: ["fri"], start: "09:00", end: "12:00" },
  ];

  return c;
}

// --- 4: audience / compliance ---------------------------------------------

function audienceRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // Expands into two regions that compliance.restricted_regions still blocks.
  c.audience.filters.geo.include = ["US", "CA", "DE", "FR"];
  c.audience.consent_basis = "consent";
  c.audience.segments.push({
    segment_id: "seg_ent_eu",
    name: "Enterprise EU",
    size_estimate: 27800,
    source: "crm",
  });
  c.landing.utm.campaign = "q4_ent_na_eu";

  // compliance.* is deliberately untouched: restricted_regions still lists
  // DE and FR, and gdpr_reviewed stays true from a review dated 9 Sept,
  // which now predates the targeting change. Neither appears in the diff.

  return c;
}

// ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  {
    id: "budget",
    title: "Budget reallocation & pacing",
    blurb:
      "Total up 24%, daily cap raised, pacing switched to accelerated, spend redistributed and a new video line added. Finance approval is still pending.",
    proves:
      "Materiality grading. Every change here is real, but they don't carry equal operational weight — and one of them (pacing, while scheduled) behaves differently from the rest.",
    after: budgetRevision(),
  },
  {
    id: "creative",
    title: "Creative copy edits",
    blurb:
      "Two subject lines edited. Structurally the two changes are identical — same path shape, same op, both string replacements. One is a reword; the other adds a performance guarantee.",
    proves:
      "Semantic judgement. A byte diff cannot separate these two. Only one should trigger legal re-review, and nothing about the JSON says which.",
    after: creativeRevision(),
  },
  {
    id: "schedule",
    title: "Send window removed & shifted",
    blurb:
      "One send window dropped and Thursday pulled in by an hour. send_windows has no stable ids, so the index-matched differ reports nearly every field as changed.",
    proves:
      "Array element identity. 'Is the window now at index 1 the same one that used to be at index 2?' is the one question that genuinely needs both before and after in the state.",
    after: scheduleRevision(),
  },
  {
    id: "audience",
    title: "Audience expansion into DE/FR",
    blurb:
      "Geo targeting gains DE and FR, consent basis switches to explicit consent, and an EU segment is added. The compliance block is untouched.",
    proves:
      "Cross-field consistency. compliance.restricted_regions still blocks DE and FR, and the GDPR review predates this change — so the conflict lives between a changed path and an unchanged one, and appears nowhere in the diff.",
    after: audienceRevision(),
  },
];

export function scenarioById(id: string): Scenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}
