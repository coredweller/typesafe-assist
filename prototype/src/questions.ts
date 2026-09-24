/**
 * Turn a computed diff into a Jev question set.
 *
 * The pattern this prototype exists to demonstrate: the `state` carries both
 * full versions AND the deterministic diff. Jev never has to rediscover what
 * a for-loop already knows, so every question is a pure judgement call.
 *
 * Question keys encode the change index (`material__3` -> changes[3]) so
 * answers zip straight back to changes. Integer indices are used rather than
 * raw JSON paths because paths carry dots and brackets and the API's key
 * charset rules are undocumented. Same trick as `entity__light` /
 * Q_ENTITY_PREFIX in the Home Assistant integration.
 */

import { isPositionMatched, preview } from "./diff.ts";
import { OPERATIONS } from "./operations.ts";
import {
  type Campaign,
  type Change,
  type DiffState,
  OPTION_NONE,
  type Question,
  type SystemOneRequest,
} from "./types.ts";

export const DEFAULT_MODEL = "jev-latest";

/** One "which element is this?" question about a position-matched array. */
export interface IdentityTarget {
  key: string;
  arrayPath: string;
  afterIndex: number;
  afterValue: unknown;
  beforeValues: unknown[];
}

export interface BuiltQuestions {
  questions: Record<string, Question>;
  changes: Change[];
  identities: IdentityTarget[];
}

function noul(instructions: string, t: string, f: string): Question {
  return { type: "noul", instructions, criteria: { true: t, false: f } };
}

function choice(
  instructions: string,
  criteria: Record<string, string | null>,
): Question {
  return { type: "choice", instructions, criteria };
}

/**
 * Render the sign-off state as a sentence for `invalidates_approval`.
 *
 * Reads the *before* version deliberately: the question asks whether this
 * revision invalidates approvals that were already on record, so a revision
 * that itself edits the approvals array must not be allowed to restate its own
 * result as the premise.
 */
function approvalSummary(before: Campaign): string {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "an unrecorded date");

  const parts = before.approvals.map((a) =>
    a.status === "approved"
      ? `${a.role} approved ${day(a.at)}`
      : a.status === "rejected"
      ? `${a.role} rejected ${day(a.at)}`
      : `${a.role} still pending`
  );

  const signoffs = parts.length
    ? `The sign-offs on record are: ${parts.join(", ")}.`
    : "No sign-offs are on record.";

  const { gdpr_reviewed, gdpr_reviewed_at } = before.compliance;
  const gdpr = gdpr_reviewed
    ? `The GDPR review completed ${day(gdpr_reviewed_at)}.`
    : "No GDPR review has been completed.";

  return `${signoffs} ${gdpr}`;
}

/**
 * The delivery-state premise for `safe_while_live`.
 *
 * The question originally hard-coded the `scheduled` case — approved, dated,
 * nothing in flight — because every scenario had that status. The `launch`
 * scenario flips the campaign to `live`, which makes that prose flatly false,
 * and a false premise is worse than a vague one: the handoff's own finding was
 * that this question was unanswerable as written. So the sentence branches on
 * status, and the `scheduled` wording is kept byte-for-byte so the recorded
 * fixtures stay comparable.
 */
function deliveryPremise(after: Campaign): string {
  if (after.status === "live") {
    return `This campaign's status is "live": it started at ` +
      `${after.schedule.start_at} and is delivering right now — sends are going ` +
      `out and impressions are being served against the settings in this ` +
      `record. Given that, can this revision be applied straight to the record ` +
      `as it stands?`;
  }
  if (after.status === "scheduled") {
    return `This campaign's status is "${after.status}": it is approved to run and ` +
      `starts at ${after.schedule.start_at}, but it is not delivering yet — no ` +
      `sends, no impressions, nothing in flight. Given that, can this revision ` +
      `be applied straight to the record as it stands?`;
  }
  return `This campaign's status is "${after.status}": nothing is being ` +
    `delivered against this record at the moment, and its start date is ` +
    `${after.schedule.start_at}. Given that, can this revision be applied ` +
    `straight to the record as it stands?`;
}

/** Get a nested array by dotted path, e.g. "schedule.send_windows". */
function readPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[seg];
  }, root);
}

/**
 * Position-matched arrays that actually have changes. These are the ones where
 * the diff may be lying about what moved, so we ask Jev to re-establish
 * identity — the one question that genuinely needs both versions in state.
 */
function identityTargets(
  before: Campaign,
  after: Campaign,
  changes: Change[],
): IdentityTarget[] {
  const arrayPaths = new Set<string>();
  for (const c of changes) {
    if (!isPositionMatched(c.path)) continue;
    const m = c.path.match(/^(.*?)\[\d+\]/);
    if (m) arrayPaths.add(m[1]);
  }

  const targets: IdentityTarget[] = [];
  for (const arrayPath of arrayPaths) {
    const beforeArr = readPath(before, arrayPath);
    const afterArr = readPath(after, arrayPath);
    if (!Array.isArray(beforeArr) || !Array.isArray(afterArr)) continue;
    // Keep the batch sane; these are only diagnostic.
    const limit = Math.min(afterArr.length, 6);
    for (let i = 0; i < limit; i++) {
      targets.push({
        key: `identity__${targets.length}`,
        arrayPath,
        afterIndex: i,
        afterValue: afterArr[i],
        beforeValues: beforeArr,
      });
    }
  }
  return targets;
}

export function buildState(
  before: Campaign,
  after: Campaign,
  changes: Change[],
): DiffState {
  return {
    campaign_id: after.campaign_id,
    status: after.status,
    before,
    after,
    changes,
  };
}

export function buildQuestions(
  before: Campaign,
  after: Campaign,
  changes: Change[],
): BuiltQuestions {
  const questions: Record<string, Question> = {};

  // --- per change ---------------------------------------------------------
  for (const c of changes) {
    questions[`material__${c.i}`] = noul(
      `Change #${c.i} at "${c.path}" (${c.op}): ${preview(c.old, 90)} → ` +
        `${preview(c.new, 90)}. Is this a material change?`,
      "Material: it alters behaviour, spend, reach, targeting, timing, or the " +
        "meaning of customer-facing copy.",
      "Cosmetic: whitespace, casing, punctuation, reordering, an equivalent " +
        "rewording, or a bookkeeping field that carries no decision.",
    );
  }

  // --- array element identity --------------------------------------------
  const identities = identityTargets(before, after, changes);
  for (const t of identities) {
    const criteria: Record<string, string | null> = {};
    t.beforeValues.forEach((v, j) => {
      criteria[String(j)] = `Previously at index ${j}: ${preview(v, 110)}`;
    });
    criteria[OPTION_NONE] = "This element is new — it did not exist before.";

    questions[t.key] = choice(
      `In "${t.arrayPath}", the element now at index ${t.afterIndex} is ` +
        `${preview(t.afterValue, 110)}. Which element of the previous version ` +
        `is this the same logical entry as? Judge by what the entry means, ` +
        `not by its position.`,
      criteria,
    );
  }

  // --- global -------------------------------------------------------------
  questions.theme = choice(
    "Taken as a whole, what is this revision mainly about?",
    {
      budget: "Spend amounts, caps, pacing or allocation between channels",
      targeting: "Who the campaign reaches: segments, filters, exclusions",
      creative: "Customer-facing copy, subject lines, headlines or assets",
      schedule: "When the campaign runs or sends",
      compliance: "Consent basis, data handling, regional restrictions",
      integration: "CRM, marketing automation or ad account wiring",
      metadata: "Names, owners, references and other bookkeeping",
    },
  );

  // A strict ordinal ladder. The original phrasing ("how far do the effects
  // reach?") let every level be arguably true at once, and external_platforms
  // — the broadest — won all four scenarios at .46-.57. Reach is cumulative,
  // so the instruction now names the tie-break explicitly and each criterion
  // states its own upper bound.
  questions.blast_radius = choice(
    "Each level below contains the ones above it. Pick the single furthest " +
      "level this revision actually forces work at — the outermost system that " +
      "would be left holding stale settings if nobody did anything. Do not pick " +
      "a level merely because it is adjacent to something that changed.",
    {
      none:
        "Bookkeeping only — names, references, notes. Nothing anywhere behaves differently afterwards, and no system needs to be told.",
      this_record:
        "The campaign record now reads differently, and that is the end of it. Nothing is recomputed, re-synced or re-pushed anywhere.",
      downstream_consumers:
        "An internal system that reads this campaign now holds a stale value — the pipeline forecast, reporting, the CRM record or the marketing-automation program. Nothing outside the organisation is affected.",
      external_platforms:
        "A configuration owned by an outside vendor is now wrong and would keep running on stale settings: an ad platform's budget, bid or targeting, or the email provider's send configuration. Pick this only if an outside system would actually misbehave, not merely because the campaign eventually reaches customers.",
      full_relaunch:
        "The revision cannot be applied to this campaign at all. Identifiers, attribution continuity or approvals are invalidated deeply enough that it must be stopped and re-created from scratch.",
    },
  );

  // The original asked whether the campaign could be changed "without pausing"
  // — but this campaign is `scheduled`, not live, so there is nothing to pause
  // and the question had no true answer. Answers sat at .53/.55/.67/.26.
  // Now the status is spelled out and the real discriminator (does this break
  // a launch gate?) is stated rather than implied.
  questions.safe_while_live = noul(
    deliveryPremise(after),
    "Yes — apply in place. Nothing is in flight for it to disrupt, and it does " +
      "not invalidate any approval or review that the launch depends on.",
    "No — the campaign must be halted or re-gated first. Either this would " +
      "disrupt delivery already underway, or it puts the campaign outside an " +
      "approval or compliance review that launch depends on.",
  );

  // Split out of safe_while_live: this is the half that actually varies while
  // the campaign is pre-launch, and it is the one an operator can act on.
  questions.invalidates_approval = noul(
    `${approvalSummary(before)} Does this revision put the campaign outside ` +
      `what those completed approvals and reviews actually examined?`,
    "Yes — at least one completed approval or review no longer covers the " +
      "campaign as revised and must be obtained again before launch.",
    "No — every completed approval and review still covers the campaign as " +
      "revised. A sign-off that was already pending does not count as invalidated.",
  );

  questions.consent_conflict = noul(
    "Compare the campaign's audience targeting against its compliance block. " +
      "Does the targeting now reach regions or use a lawful basis that the " +
      "compliance settings or the completed review do not cover?",
    "Yes — targeting and compliance are now inconsistent",
    "No — targeting stays within what compliance permits and covers",
  );

  questions.claim_risk = noul(
    "Look at any customer-facing copy that changed in this revision. Does any " +
      "of it introduce a performance claim, guarantee, statistic or comparison " +
      "that was not present in the previous version?",
    "Yes — new claim, guarantee, figure or comparison in the copy",
    "No — copy changes are rewording, formatting or tone only",
  );

  // --- operation gates ----------------------------------------------------
  for (const op of OPERATIONS) {
    questions[op.key] = noul(
      `${op.description} Given this revision, is "${op.label}" required?`,
      "Required: this revision makes the operation necessary",
      "Not required: this revision does not make the operation necessary",
    );
  }

  return { questions, changes, identities };
}

export function buildRequest(
  before: Campaign,
  after: Campaign,
  changes: Change[],
  model = DEFAULT_MODEL,
): { request: SystemOneRequest; built: BuiltQuestions } {
  const built = buildQuestions(before, after, changes);
  return {
    request: {
      state: buildState(before, after, changes),
      model,
      questions: built.questions,
    },
    built,
  };
}
