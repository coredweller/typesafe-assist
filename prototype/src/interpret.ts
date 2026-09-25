/**
 * Answers + thresholds -> an operations readout.
 *
 * Jev returns distributions. Turning a distribution into a decision is
 * entirely this file's job, and the gates are adjustable at runtime so the
 * same answer set can yield different operational policy depending on how
 * expensive a wrong action would be.
 *
 * Note that Jev has no knowledge of its own other answers within a request —
 * every question was evaluated independently against the state. Any
 * cross-question consistency is enforced here.
 */

import { OPERATIONS } from "./operations.ts";
import type { BuiltQuestions, IdentityTarget } from "./questions.ts";
import {
  type Bucket,
  type Change,
  type ChoiceAnswer,
  type OperationResult,
  OPTION_NONE,
  type Reach,
  type SystemOneResponse,
  type Thresholds,
} from "./types.ts";

export const DEFAULT_THRESHOLDS: Thresholds = { high: 0.85, low: 0.6 };

/**
 * A probability this close to .5 is a coin flip, not a judgement. Readings in
 * this band are reported as unknown rather than being rounded into a
 * directive — the original code turned a .53 into "pause the campaign".
 */
export const UNCERTAIN_BAND = 0.1;

const isUncertain = (p: number) => Math.abs(p - 0.5) < UNCERTAIN_BAND;

/** Reach levels, innermost first. A derived radius is the outermost gated one. */
const REACH_ORDER: Reach[] = [
  "this_record",
  "downstream_consumers",
  "external_platforms",
];

export interface ChangeVerdict {
  change: Change;
  probability: number;
  material: boolean;
  /** Per-edit claim reading; only copy fields are asked. */
  claim: number | null;
}

export interface IdentityVerdict {
  target: IdentityTarget;
  /** Resolved before-index, or null when Jev judged the element new. */
  resolvedTo: number | null;
  confidence: number;
  /** True when identity differs from naive position matching. */
  moved: boolean;
  /** True when the one-to-one rule overrode Jev's own choice. */
  reassigned: boolean;
}

/**
 * Each identity question is answered without sight of the others, so two
 * elements can both claim the same previous element. Observed on `schedule`:
 * the new 07:30 window resolved to Friday's old slot in two runs of three,
 * while Friday itself resolved there at .98. Identity is one-to-one, so the
 * stronger claim keeps the slot and the weaker falls back to its next-best
 * option that nobody else holds — "new" is always available.
 */
function enforceOneToOne(
  verdicts: IdentityVerdict[],
  answers: Map<IdentityVerdict, ChoiceAnswer>,
): void {
  const byArray = Map.groupBy(verdicts, (v) => v.target.arrayPath);
  for (const group of byArray.values()) {
    for (let pass = 0; pass < group.length; pass++) {
      const claims = Map.groupBy(
        group.filter((v) => v.resolvedTo !== null),
        (v) => v.resolvedTo as number,
      );
      const clash = [...claims].find(([, vs]) => vs.length > 1);
      if (!clash) break;

      const [index, claimants] = clash;
      const probOf = (v: IdentityVerdict, opt: string) =>
        answers.get(v)?.probabilities[opt] ?? 0;
      claimants.sort((a, b) => probOf(b, String(index)) - probOf(a, String(index)));

      for (const loser of claimants.slice(1)) {
        const held = new Set(
          group.filter((v) => v !== loser && v.resolvedTo !== null)
            .map((v) => String(v.resolvedTo)),
        );
        const [opt, p] = Object.entries(answers.get(loser)?.probabilities ?? {})
          .filter(([o]) => !held.has(o))
          .sort((a, b) => b[1] - a[1])[0] ?? [OPTION_NONE, 0];
        loser.resolvedTo = opt === OPTION_NONE ? null : Number.parseInt(opt, 10);
        loser.confidence = p;
        loser.moved = loser.resolvedTo !== null &&
          loser.resolvedTo !== loser.target.afterIndex;
        loser.reassigned = true;
      }
    }
  }
}

export interface Interpretation {
  operations: OperationResult[];
  changes: ChangeVerdict[];
  identities: IdentityVerdict[];
  theme: ChoiceAnswer | null;
  blastRadius: ChoiceAnswer | null;
  /**
   * Blast radius computed from which operations cleared a gate, rather than
   * asked. The operation gates are bimodal and well separated where the
   * blast_radius choice is not, so this is the more trustworthy of the two.
   */
  derivedBlastRadius: Reach | "none";
  safeWhileLive: number | null;
  invalidatesApproval: number | null;
  consentConflict: number | null;
  claimRisk: number | null;
  unverifiedSignoff: number | null;
  /** Consistency notes produced here, not by the model. */
  flags: string[];
}

function noulOf(res: SystemOneResponse, key: string): number | null {
  const a = res.answers?.[key];
  return a && a.type === "noul" ? a.noul : null;
}

function choiceOf(res: SystemOneResponse, key: string): ChoiceAnswer | null {
  const a = res.answers?.[key];
  return a && a.type === "choice" ? a : null;
}

function bucketFor(p: number, t: Thresholds): Bucket {
  if (p >= t.high) return "required";
  if (p >= t.low) return "review";
  return "skip";
}

export function interpret(
  response: SystemOneResponse,
  built: BuiltQuestions,
  thresholds: Thresholds,
): Interpretation {
  // --- per-change materiality --------------------------------------------
  const changes: ChangeVerdict[] = built.changes.map((change) => {
    const p = noulOf(response, `material__${change.i}`) ?? 0;
    return {
      change,
      probability: p,
      material: p >= thresholds.low,
      claim: noulOf(response, `claim__${change.i}`),
    };
  });

  // --- array element identity --------------------------------------------
  const identityAnswers = new Map<IdentityVerdict, ChoiceAnswer>();
  const identities: IdentityVerdict[] = built.identities.map((target) => {
    const answer = choiceOf(response, target.key);
    if (!answer) {
      return { target, resolvedTo: null, confidence: 0, moved: false, reassigned: false };
    }
    const resolvedTo = answer.choice === OPTION_NONE
      ? null
      : Number.parseInt(answer.choice, 10);
    const valid = resolvedTo !== null && Number.isFinite(resolvedTo);
    const verdict: IdentityVerdict = {
      target,
      resolvedTo: valid ? resolvedTo : null,
      confidence: answer.confidence,
      moved: valid && resolvedTo !== target.afterIndex,
      reassigned: false,
    };
    identityAnswers.set(verdict, answer);
    return verdict;
  });
  enforceOneToOne(identities, identityAnswers);

  // --- operations ---------------------------------------------------------
  const operations: OperationResult[] = OPERATIONS.map((op) => {
    const p = noulOf(response, op.key) ?? 0;
    return { ...op, probability: p, bucket: bucketFor(p, thresholds) };
  }).sort((a, b) => b.probability - a.probability);

  // --- globals ------------------------------------------------------------
  const safeWhileLive = noulOf(response, "safe_while_live");
  const invalidatesApproval = noulOf(response, "invalidates_approval");
  const consentConflict = noulOf(response, "consent_conflict");
  const claimRisk = noulOf(response, "claim_risk");
  const unverifiedSignoff = noulOf(response, "unverified_signoff");

  // --- blast radius, derived ----------------------------------------------
  // Take the outermost boundary crossed by any operation that cleared the
  // review gate. Gating operations (approvals, reviews) move no data, so they
  // contribute nothing here even when they fire.
  const gatedReaches = new Set(
    operations
      .filter((o) => o.bucket !== "skip" && o.reach !== "gating")
      .map((o) => o.reach),
  );
  const derivedBlastRadius: Reach | "none" =
    [...REACH_ORDER].reverse().find((r) => gatedReaches.has(r)) ?? "none";

  // --- cross-question consistency, enforced in code ----------------------
  const flags: string[] = [];

  if (consentConflict !== null && consentConflict >= thresholds.low) {
    const gdpr = operations.find((o) => o.key === "op__invalidate_gdpr");
    if (gdpr && gdpr.bucket === "skip") {
      flags.push(
        "Jev flagged a targeting/compliance conflict but did not require the " +
          "GDPR review to be invalidated. These answers were produced " +
          "independently — treat the conflict as blocking.",
      );
    }
  }

  // Either reading is enough: the global one sees the copy as a whole, the
  // per-edit ones each see a single change.
  const perEditClaim = Math.max(0, ...changes.map((c) => c.claim ?? 0));
  if (Math.max(claimRisk ?? 0, perEditClaim) >= thresholds.high) {
    const legal = operations.find((o) => o.key === "op__legal_recheck");
    if (legal && legal.bucket !== "required") {
      flags.push(
        "A new performance claim was detected in copy, but legal re-review " +
          "did not clear the required gate. Escalate manually.",
      );
    }
  }

  // A reading near .5 is the model declining to commit. Reporting it as a
  // decision ("pause the campaign") manufactures certainty the answer does not
  // contain, so the two cases are separated.
  if (safeWhileLive !== null) {
    if (isUncertain(safeWhileLive)) {
      flags.push(
        `Jev would not commit on whether this can be applied in place ` +
          `(${safeWhileLive.toFixed(2)}). Treat it as unanswered and decide by ` +
          `policy, not by rounding the number.`,
      );
    } else if (safeWhileLive < thresholds.low) {
      flags.push(
        "This revision is judged unsafe to apply in place — halt or re-gate " +
          "the campaign before applying any of the operations below.",
      );
    }
  }

  if (invalidatesApproval !== null && invalidatesApproval >= thresholds.low) {
    flags.push(
      `This revision falls outside a completed approval or review ` +
        `(${invalidatesApproval.toFixed(2)}). Launch is gated until it is ` +
        `obtained again.`,
    );
  }

  if (unverifiedSignoff !== null && unverifiedSignoff >= thresholds.low) {
    // Observed on `budget`: the self-signed finance approval reads .87 here,
    // while finance_approval — asked separately — drops from .95 to .47,
    // because the record now *says* approved. Same shape as the consent/GDPR
    // check above: the relational reading wins and the gap is named.
    const regated = operations.some(
      (o) => o.reach === "gating" && o.bucket === "required",
    );
    flags.push(
      `A sign-off or review record was created or refreshed without evidence ` +
        `of an independent reviewer (${unverifiedSignoff.toFixed(2)}). Treat it ` +
        `as not obtained` +
        (regated
          ? "."
          : ` — and no approval or review operation cleared the Required gate, ` +
            `so re-raise it manually.`),
    );
  }

  // The two readings answer overlapping questions and were produced
  // independently, so they can contradict each other. Say so rather than
  // silently preferring one.
  if (
    safeWhileLive !== null && invalidatesApproval !== null &&
    !isUncertain(safeWhileLive) && safeWhileLive >= thresholds.low &&
    invalidatesApproval >= thresholds.low
  ) {
    flags.push(
      `Contradiction: safe to apply in place (${safeWhileLive.toFixed(2)}) but ` +
        `an approval no longer covers it (${invalidatesApproval.toFixed(2)}). ` +
        `The approval gate is the stricter reading — prefer it.`,
    );
  }

  // Observed live on 19 Sep 2026: for a near-tied Choice, `choice` is not
  // necessarily the argmax of `probabilities` — the creative scenario returned
  // choice=downstream_consumers (.300) while this_record scored .310. Code that
  // reads `choice` alone will occasionally disagree with the distribution it
  // came with, so the disagreement is surfaced rather than silently resolved.
  for (const [key, label] of [["theme", "theme"], ["blast_radius", "blast radius"]]) {
    const a = choiceOf(response, key);
    if (!a?.probabilities) continue;
    const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
    if (ranked.length && ranked[0][0] !== a.choice) {
      flags.push(
        `The ${label} answer reports "${a.choice}" but "${ranked[0][0]}" carries ` +
          `the higher probability (${ranked[0][1].toFixed(3)} vs ` +
          `${(a.probabilities[a.choice] ?? 0).toFixed(3)}). The options are ` +
          `effectively tied — confidence is ${a.confidence.toFixed(2)}. Read the ` +
          `distribution, not the label.`,
      );
    }
  }

  // Every change graded cosmetic, yet an operation still cleared a gate. This
  // is the `noise` case: an em dash in the campaign name reads as nothing per
  // field, but the CRM holds that name. Both answers are defensible, and they
  // were produced independently, so the disagreement is named, not resolved.
  const gatedOps = operations.filter((o) => o.bucket !== "skip");
  if (
    changes.length && gatedOps.length &&
    changes.every((c) => c.probability < thresholds.low)
  ) {
    flags.push(
      `No change was graded material, yet ${
        gatedOps.map((o) => `${o.label} (${o.probability.toFixed(2)})`).join(", ")
      } cleared a gate. Per-field grading and the operation gates disagree — ` +
        `check what the operation keys off.`,
    );
  }

  const movedCount = identities.filter((v) => v.moved).length;
  if (movedCount > 0) {
    flags.push(
      `${movedCount} array element${movedCount === 1 ? "" : "s"} shifted ` +
        `position. The diff reports these as edits; Jev resolved them as the ` +
        `same entries moved. Treat the affected change rows as suspect.`,
    );
  }

  for (const v of identities.filter((v) => v.reassigned)) {
    flags.push(
      `${v.target.arrayPath}[${v.target.afterIndex}] claimed a previous element ` +
        `that another element holds more strongly. Identity is one-to-one, so ` +
        `it was reassigned to ${
          v.resolvedTo === null ? "a new entry" : `index ${v.resolvedTo}`
        } (${v.confidence.toFixed(2)}) — a constraint enforced here, not by Jev.`,
    );
  }

  return {
    operations,
    changes,
    identities,
    theme: choiceOf(response, "theme"),
    blastRadius: choiceOf(response, "blast_radius"),
    derivedBlastRadius,
    safeWhileLive,
    invalidatesApproval,
    consentConflict,
    claimRisk,
    unverifiedSignoff,
    flags,
  };
}
