/**
 * Nine campaign revisions. Each defeats a different assumption that a purely
 * structural diff makes, which is the point: the diff tells you *what* moved,
 * Jev tells you what it *means*.
 *
 * 1-4 were the original set. 5-9 were added to cover axes none of them
 * exercised: a revision where the correct answer is "do nothing" (5), one where
 * the smallest diff carries the largest consequence (6), one that is entirely
 * invisible to customers yet re-points every external system (7), one that
 * makes `safe_while_live` answerable by actually being live (8), and one that
 * edits the guardrail instead of the thing it guards (9).
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

// --- 5: cosmetic churn -----------------------------------------------------

function noiseRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // An em dash becomes an en dash, and a team is renamed to its short form.
  c.name = "Q4 Enterprise Push – NA";
  c.owner.team = "Demand Gen";

  // allocations is keyed by `channel`, so reordering it produces no changes
  // at all — the differ matches by id and every element compares equal.
  c.budget.allocations = [
    { channel: "display", amount: 50000 },
    { channel: "paid_search", amount: 120000 },
    { channel: "paid_social", amount: 80000 },
  ];

  // These two are arrays of primitives with no key to match on, so the same
  // reorder is reported as a wholesale replace. Identical sets, two change
  // rows. That asymmetry is the whole point of this scenario.
  c.audience.exclusions = ["seg_active_opportunity", "seg_churned_90d"];
  c.audience.filters.industries = ["fintech", "healthcare", "saas"];

  return c;
}

// --- 6: channel disabled ---------------------------------------------------

function channelRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // One boolean. It is the smallest possible edit and it stops an entire
  // paid channel from delivering.
  c.channels[1].enabled = false;

  const email = c.channels[0];
  email.throttle_per_hour = 1200;
  // creatives is keyed by creative_id, so this is a clean single removal
  // rather than the index churn of scenario 3.
  email.creatives = [email.creatives[0]];
  email.creatives[0].weight = 100;

  // landing.ab_test is deliberately untouched: it still reads
  // { enabled: true, split: [50, 50] } while only one variant now exists.
  // Like scenario 4, the inconsistency lives between a changed path and an
  // unchanged one and appears nowhere in the diff.

  return c;
}

// --- 7: integration re-pointing --------------------------------------------

function integrationRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // Nothing here is customer-facing, and every one of them re-points a system
  // that is already holding this campaign's data.
  c.integrations.crm.campaign_ref = "701Bs00000PqRst";
  c.integrations.crm.sync = "outbound_only";
  c.integrations.map.program_id = "PGM-4590";
  // Budgets were pushed to acc_5512, which keeps spending against them.
  c.integrations.ad_accounts.linkedin = "acc_7731";

  // Changing the attribution model mid-flight makes results before and after
  // the change incomparable — arguably the deepest change in the whole set.
  c.goals.attribution_model = "last_touch";
  c.goals.primary_kpi = "sqls";

  return c;
}

// --- 8: launched early -----------------------------------------------------

function launchRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // The only scenario where the campaign is actually delivering, which is the
  // only condition under which `safe_while_live` has a true answer.
  c.status = "live";
  c.schedule.start_at = "2026-09-18T08:00:00Z";
  c.budget.daily_cap = 9000;
  c.budget.pacing = "accelerated";

  // The revision clears its own launch gate: finance goes from pending to
  // approved, signed by u_221 — the campaign owner, and the same user as
  // `updated_by`. questions.ts reads approvals from the *before* version
  // precisely so this cannot restate its own result as the premise.
  c.approvals[2] = {
    role: "finance",
    status: "approved",
    by: "u_221",
    at: "2026-09-18T09:58:00Z",
  };

  return c;
}

// --- 9: guardrail loosened -------------------------------------------------

function guardrailRevision(): Campaign {
  const c = clone(BEFORE);
  c.version = 8;
  c.updated_at = "2026-09-18T10:05:00Z";

  // The inverse of scenario 4: audience is untouched — still US/CA only — and
  // the compliance block is what moves. Clearing restricted_regions resolves
  // the conflict scenario 4 trips over by deleting the rule rather than by
  // changing the targeting.
  c.compliance.restricted_regions = [];
  c.compliance.data_retention_days = 1095;
  c.compliance.can_spam_footer_id = "ftr_5";
  // gdpr_reviewed stays true and its date is moved forward, asserting a review
  // that covers none of the above.
  c.compliance.gdpr_reviewed_at = "2026-09-18T09:00:00Z";

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
  {
    id: "noise",
    title: "Cosmetic churn & array reordering",
    blurb:
      "An em dash becomes an en dash, a team is renamed, and three arrays are reordered without changing a single member. Budget allocations are keyed so their reorder vanishes; exclusions and industries are plain strings, so the same reorder is reported as two wholesale replacements.",
    proves:
      "The negative case, which nothing else in the set covers: if materiality does not collapse here, the whole readout cries wolf. It also shows the differ's one honest false positive — an unkeyed array of primitives cannot be reordered without looking edited — and it is the only revision where every change grades cosmetic while an operation still clears a gate, off the rename alone. That reconciliation case is what run-scenarios.ts now checks for.",
    after: noiseRevision(),
  },
  {
    id: "channel",
    title: "Channel disabled & variant pulled",
    blurb:
      "paid_social.enabled flips to false, the email throttle drops to 1200/hr, and variant B is deleted with A's weight raised to 100. Four changes, one of them a single boolean.",
    proves:
      "Diff size is unrelated to consequence. enabled: true → false is the smallest edit the differ can report, and materiality ranks it above the three larger edits beside it. It also carries a cross-field conflict the question set has no question for: landing.ab_test still reads enabled with a 50/50 split against a variant that no longer exists. Scenario 4's conflict is caught only because consent_conflict was written for it — the general pattern is uncovered.",
    after: channelRevision(),
  },
  {
    id: "integration",
    title: "Integration re-pointing & attribution",
    blurb:
      "New Salesforce campaign ref, CRM sync narrowed to outbound-only, a new Marketo program, a different LinkedIn ad account, and the attribution model switched from w-shaped to last-touch.",
    proves:
      "Reach without visibility, and the far end of the blast_radius ladder that the original four never reached. No customer sees any of it, yet every change re-points a system already holding this campaign's data and the old ad account keeps spending the budget pushed to it. The row graded *lowest* is the new Salesforce ref — the one that aims the whole campaign at a different record. Per-field materiality has no way to know an identifier is an identifier.",
    after: integrationRevision(),
  },
  {
    id: "launch",
    title: "Launched early, finance self-approved",
    blurb:
      "Status flips to live with the start date moved into the past, the daily cap doubles to 9000 with accelerated pacing, and the pending finance approval is marked approved by u_221 — the campaign owner, and the same user who made this edit.",
    proves:
      "Two things the original four could not. First, safe_while_live finally has a true answer: this is the only revision with something actually in flight to disrupt, and it is the only one where the reading comes back decisively negative. Second, the revision edits the approvals array it is judged against — which is why questions.ts builds that premise from the before version — and per-field materiality grades approvals[finance].by as bookkeeping, because no one field can carry the fact that the signer is the user who made the edit.",
    after: launchRevision(),
  },
  {
    id: "guardrail",
    title: "Compliance guardrail loosened",
    blurb:
      "restricted_regions is emptied, data retention goes from 365 to 1095 days, the CAN-SPAM footer is swapped, and the GDPR review date is moved forward to today. The audience block is untouched — still US/CA only.",
    proves:
      "A revision can edit the rule instead of the thing the rule governs, and the diff cannot tell a policy update from a bypass. This is scenario 4 run backwards — the same DE/FR conflict, resolved by deleting the restriction — and the consequence is that consent_conflict goes quiet, correctly, because after this revision there is no conflict left to find. Only invalidates_approval catches it. It is also the one revision where no operation clears any gate while a global reading says launch is blocked.",
    after: guardrailRevision(),
  },
];

export function scenarioById(id: string): Scenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}
