/**
 * Ten campaign revisions. Each defeats a different assumption that a purely
 * structural diff makes, which is the point: the diff tells you *what* moved,
 * Jev tells you what it *means*.
 *
 * The array order is the demo order — it is the button order, the default on
 * load, and the screenshot numbering. It runs from semantics (creative) through
 * identity (schedule), conflicts that live outside the diff (audience,
 * guardrail), the same diff judged against two states (the timezone pair),
 * consequence vs size (channel) and the negative control (noise), to the two
 * deep cuts (budget, integration).
 *
 * The retired `launch` scenario's fixture is kept in fixtures/baseline-v3/.
 * Its self-approval moved into `budget`, and its live status into the pair.
 */

import { BEFORE, BEFORE_LIVE, clone } from "./campaign.ts";
import type { Campaign, Scenario } from "./types.ts";

/** Stamp a revision the way a save would. */
function revise(from: Campaign): Campaign {
  const c = clone(from);
  c.version = from.version + 1;
  c.updated_at = "2026-09-18T10:05:00Z";
  return c;
}

// --- creative --------------------------------------------------------------

function creativeRevision(): Campaign {
  const c = revise(BEFORE);
  const email = c.channels[0];
  const social = c.channels[1];

  // A 2x2 of keyword against claim. A filter for "guarantee" catches the
  // explicit claim, falsely flags the decoy, and misses the ranking claim —
  // which has no trigger word and no digit in it.
  email.creatives[0].subject = "Transform your pipeline this quarter"; // reword
  email.creatives[1].subject = "Your Q4 pipeline, rebuilt — guaranteed 3x ROI"; // claim
  email.creatives[1].preheader =
    "A practical guide for enterprise teams — no guarantees, no hype"; // decoy
  social.creatives[0].headline = "The pipeline platform analysts rank first"; // hidden claim

  // Noise: casing only.
  email.creatives[0].preheader = "See How Enterprise Teams Close Faster";

  // landing.utm.content used to go variant_a → Variant_A here. It graded
  // cosmetic (.14, and .36 even after materiality learned about tracking)
  // while regenerate_utm fired at .88 — a contradiction that pulled focus from
  // the copy. Removed; the finding is recorded in the README.

  return c;
}

// --- schedule --------------------------------------------------------------

function scheduleRevision(): Campaign {
  const c = revise(BEFORE);

  // Three edits in plain English: drop the morning window, pull Thursday in
  // by an hour, and add an early-morning test window. Because send_windows
  // has no ids, an index-matched differ reports this as nearly every field
  // on every element changing — and the new window as an edit to Friday's.
  c.schedule.send_windows = [
    { days: ["mon", "tue", "wed"], start: "13:00", end: "17:00" },
    { days: ["thu"], start: "09:00", end: "16:00" },
    { days: ["fri"], start: "09:00", end: "12:00" },
    { days: ["tue", "thu"], start: "07:30", end: "08:30" },
  ];

  return c;
}

// --- audience / compliance -------------------------------------------------

function audienceRevision(): Campaign {
  const c = revise(BEFORE);

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

// --- guardrail loosened ----------------------------------------------------

function guardrailRevision(): Campaign {
  const c = revise(BEFORE);

  // The inverse of audience: targeting is untouched — still US/CA only — and
  // the compliance block is what moves. Clearing restricted_regions resolves
  // the conflict audience trips over by deleting the rule rather than by
  // changing the targeting.
  c.compliance.restricted_regions = [];
  c.compliance.data_retention_days = 1095;
  c.compliance.can_spam_footer_id = "ftr_5";
  // gdpr_reviewed stays true and its date is moved forward, asserting a review
  // that covers none of the above.
  c.compliance.gdpr_reviewed_at = "2026-09-18T09:00:00Z";

  return c;
}

// --- timezone pair ---------------------------------------------------------

/**
 * One edit, applied to two versions of the campaign. Moving the timezone from
 * New York to Los Angeles shifts every send window three hours. Before launch
 * that is a calendar to reprogram; mid-flight, sends already queued against
 * the old calendar fire at the wrong hour. The diff row is byte-identical in
 * both — only the state it is judged against differs.
 *
 * The first cut dropped seg_active_opportunity from the exclusions instead.
 * safe_while_live flipped (.73 → .29) but halt_delivery only reached .58; the
 * timezone edit flips wider (.76 → .19) and halt clears the review gate.
 */
function timezoneRevision(from: Campaign): Campaign {
  const c = revise(from);
  c.schedule.timezone = "America/Los_Angeles";
  return c;
}

// --- channel disabled ------------------------------------------------------

function channelRevision(): Campaign {
  const c = revise(BEFORE);

  // One boolean. It is the smallest possible edit and it stops an entire
  // paid channel from delivering.
  c.channels[1].enabled = false;

  const email = c.channels[0];
  email.throttle_per_hour = 1200;
  // creatives is keyed by creative_id, so this is a clean single removal
  // rather than the index churn of the schedule scenario.
  email.creatives = [email.creatives[0]];
  email.creatives[0].weight = 100;

  // landing.ab_test is deliberately untouched: it still reads
  // { enabled: true, split: [50, 50] } while only one variant now exists.

  return c;
}

// --- cosmetic churn --------------------------------------------------------

function noiseRevision(): Campaign {
  const c = revise(BEFORE);

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
  // rows. That asymmetry is the differ's one honest false positive.
  c.audience.exclusions = ["seg_active_opportunity", "seg_churned_90d"];
  c.audience.filters.industries = ["fintech", "healthcare", "saas"];

  return c;
}

// --- budget ----------------------------------------------------------------

function budgetRevision(): Campaign {
  const c = revise(BEFORE);
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

  // The revision clears its own spend gate: finance goes from pending to
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

// --- integration re-pointing -----------------------------------------------

function integrationRevision(): Campaign {
  const c = revise(BEFORE);

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

// ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  {
    id: "creative",
    title: "Claims vs rewording",
    blurb:
      'Four copy edits, all the same shape — a string replaced by a string. One is a plain reword, one adds "guaranteed 3x ROI", one says "no guarantees", and one says "analysts rank first". A preheader also changes casing.',
    proves:
      'Semantic judgement that neither a diff nor a keyword filter can do. Read the claim rows: a filter for "guarantee" flags the decoy and misses the ranking claim, which has no trigger word and no digit. Materiality alone cannot separate them either — the decoy is a real meaning change, just not a claim.',
    after: creativeRevision(),
  },
  {
    id: "schedule",
    title: "Send windows reshuffled",
    blurb:
      "The Mon–Wed morning window is dropped, Thursday is pulled in by an hour, and a new early-morning Tue/Thu window is added. send_windows has no stable ids, so the index-matched differ reports ten edits.",
    proves:
      "Array element identity — the one question that genuinely needs both versions in the state. Read the identity group: three entries resolve as moved up one place and the fourth as new, so ten diff rows are really one removal, one edit and one addition. The new entry is the weak one: answered without knowing Friday is already claimed, it often picks Friday's old slot too, and code enforces the one-to-one rule that settles it.",
    after: scheduleRevision(),
  },
  {
    id: "audience",
    title: "Audience expansion into DE/FR",
    blurb:
      "Geo targeting gains DE and FR, consent basis switches to explicit consent, and an EU segment is added. The compliance block is untouched.",
    proves:
      "Cross-field consistency. compliance.restricted_regions still blocks DE and FR and the GDPR review predates the change, so the conflict lives between a changed path and an unchanged one — nowhere in the diff — and consent_conflict still finds it. crm_sync sits right at the review gate across runs: drag the review slider here.",
    after: audienceRevision(),
  },
  {
    id: "guardrail",
    title: "Compliance guardrail loosened",
    blurb:
      "restricted_regions is emptied, data retention goes from 365 to 1095 days, the CAN-SPAM footer is swapped, and the GDPR review date is moved forward to today. The audience block is untouched — still US/CA only.",
    proves:
      "Audience run backwards: the conflict is resolved by deleting the rule rather than changing the targeting, so consent_conflict correctly goes quiet and invalidates_approval catches it instead. The tell is the review date moved forward with no review: per-field materiality grades that row as bookkeeping, and only the relational unverified_signoff sees it.",
    after: guardrailRevision(),
  },
  {
    id: "timezone",
    title: "Timezone moved — scheduled",
    blurb:
      "schedule.timezone goes from America/New_York to America/Los_Angeles, so every send window lands three hours later. The campaign is scheduled for 1 Oct: nothing has been sent yet.",
    proves:
      "Half of a pair. Nothing is queued yet, so this is a calendar to reprogram before launch, and it is safe to apply in place. Compare the next scenario, whose diff is byte-identical.",
    after: timezoneRevision(BEFORE),
  },
  {
    id: "timezone-live",
    title: "Timezone moved — live",
    blurb:
      "The same edit, applied to the same campaign two weeks on: finance signed, launched 15 Sept, and sending now. Sends already queued against the New York calendar fire at the wrong hour as soon as the change lands.",
    proves:
      "Same diff, opposite verdict. The diff table and per-change materiality match the previous scenario, while apply-in-place flips and halt_delivery — dark in every other scenario — clears a gate. The answer lives in the state, not the diff, which is why state carries both full versions.",
    before: BEFORE_LIVE,
    after: timezoneRevision(BEFORE_LIVE),
  },
  {
    id: "channel",
    title: "Channel disabled & variant pulled",
    blurb:
      "paid_social.enabled flips to false, the email throttle drops to 1200/hr, and variant B is deleted with A's weight raised to 100. Four changes, one of them a single boolean.",
    proves:
      "Diff size is unrelated to consequence: enabled: true → false is the smallest edit the differ can report, and it grades at the top of the set. landing.ab_test still reads 50/50 against a variant that no longer exists, and appears nowhere in the diff. repush_creative_set fires, but its rubric also triggers on the removed variant, so this scenario cannot show which of the two it caught.",
    after: channelRevision(),
  },
  {
    id: "noise",
    title: "Cosmetic churn & array reordering",
    blurb:
      "An em dash becomes an en dash, a team is renamed, and three arrays are reordered without changing a single member. Budget allocations are keyed so their reorder vanishes; exclusions and industries are plain strings, so the same reorder is reported as two wholesale replacements.",
    proves:
      "The negative control: if materiality does not collapse here, the whole readout cries wolf — and every row grades cosmetic. The two array rows are the differ's one honest false positive. crm_sync still clears the review gate off the rename, because the CRM holds that name; the flag names the disagreement rather than resolving it.",
    after: noiseRevision(),
  },
  {
    id: "budget",
    title: "Budget +24%, finance self-approved",
    blurb:
      "Total up 24%, daily cap raised, pacing switched to accelerated, spend redistributed and a video line added. In the same edit the pending finance approval is marked approved by u_221 — the campaign owner, and the user who made this revision.",
    proves:
      "One intent fans out to three systems, each its own Required operation. Per-field materiality grades approvals[finance].by as bookkeeping, and finance_approval is talked down by a record that now says approved; unverified_signoff, which reads across fields, sees that the signer is the requester, and the flag reconciles the two. That half is admittedly close to a for-loop check — the point is that per-change questions cannot see it.",
    after: budgetRevision(),
  },
  {
    id: "integration",
    title: "Integration re-pointing & attribution",
    blurb:
      "New Salesforce campaign ref, CRM sync narrowed to outbound-only, a new Marketo program, a different LinkedIn ad account, and the attribution model switched from w-shaped to last-touch.",
    proves:
      "Reach without visibility. No customer sees any of it, yet every change re-points a system already holding this campaign's data, and the old ad account keeps spending the budget pushed to it. rebaseline_reporting clears highest: results from before and after an attribution switch are not comparable.",
    after: integrationRevision(),
  },
];

/** The version a scenario is applied to — the shared BEFORE unless it names one. */
export function beforeOf(s: Scenario): Campaign {
  return s.before ?? BEFORE;
}

export function scenarioById(id: string): Scenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}
