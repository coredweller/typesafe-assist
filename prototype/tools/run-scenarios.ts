/**
 * Headless scenario runner / regression harness.
 *
 * Runs every scenario through the same pipeline the browser uses — diff,
 * buildRequest, POST /v1/systemone, interpret — then records the raw response
 * to fixtures/ and prints a report of the readings we are tuning.
 *
 * The point is to make rubric work cheap: once fixtures exist, threshold and
 * interpretation changes can be re-scored offline, and a rubric change can be
 * compared against the last recorded run instead of against memory.
 *
 *   deno task scenarios              # run all four live, record fixtures
 *   deno task scenarios -- creative  # run one
 *   deno task scenarios -- --replay  # re-score recorded fixtures, no API calls
 *   deno task scenarios -- --diff    # run live, compare against fixtures
 *
 * `--replay` and `--diff` are the two that matter: the first is free, the
 * second is what you run after editing a rubric.
 */

import { diffCampaign } from "../src/diff.ts";
import { buildRequest } from "../src/questions.ts";
import { DEFAULT_THRESHOLDS, interpret } from "../src/interpret.ts";
import { SCENARIOS } from "../src/scenarios.ts";
import { BEFORE } from "../src/campaign.ts";
import type { Scenario, SystemOneResponse } from "../src/types.ts";

const UPSTREAM = Deno.env.get("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai";
const API_KEY = Deno.env.get("TYPESAFE_API_KEY")?.trim();
const FIXTURES = new URL("../fixtures/", import.meta.url);

// --- reporting helpers ------------------------------------------------------

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const pct = (n: number | null) => n === null ? "  — " : n.toFixed(2).padStart(4);

/** Colour a probability by how decisive it is, not by whether it is high. */
function decisive(n: number | null): string {
  if (n === null) return C.dim(pct(n));
  if (n >= 0.8 || n <= 0.2) return C.green(pct(n));
  if (n >= 0.65 || n <= 0.35) return C.yellow(pct(n));
  return C.red(pct(n)); // near .5 — not actionable
}

interface RunRecord {
  scenario: string;
  recorded_at: string;
  model: string;
  changes: number;
  questions: number;
  state_bytes: number;
  request_bytes: number;
  latency_ms: number;
  usage: unknown;
  response: SystemOneResponse;
}

// --- one scenario -----------------------------------------------------------

async function callLive(
  scenario: Scenario,
): Promise<RunRecord> {
  if (!API_KEY) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Run via `deno task scenarios` so --env-file=.env applies.",
    );
  }

  const changes = diffCampaign(BEFORE, scenario.after);
  const { request } = buildRequest(BEFORE, scenario.after, changes);
  const body = JSON.stringify(request);

  const started = performance.now();
  const res = await fetch(`${UPSTREAM}/v1/systemone`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const latency = Math.round(performance.now() - started);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${scenario.id}: HTTP ${res.status}\n${text.slice(0, 600)}`);
  }

  const response = JSON.parse(text) as SystemOneResponse;
  return {
    scenario: scenario.id,
    recorded_at: new Date().toISOString(),
    model: request.model,
    changes: changes.length,
    questions: Object.keys(request.questions).length,
    state_bytes: JSON.stringify(request.state).length,
    request_bytes: body.length,
    latency_ms: latency,
    usage: response.usage ?? null,
    response,
  };
}

function fixturePath(id: string): URL {
  return new URL(`${id}.json`, FIXTURES);
}

async function readFixture(id: string): Promise<RunRecord | null> {
  try {
    return JSON.parse(await Deno.readTextFile(fixturePath(id))) as RunRecord;
  } catch {
    return null;
  }
}

async function writeFixture(rec: RunRecord): Promise<void> {
  await Deno.mkdir(FIXTURES, { recursive: true });
  await Deno.writeTextFile(
    fixturePath(rec.scenario),
    JSON.stringify(rec, null, 2) + "\n",
  );
}

// --- scoring ----------------------------------------------------------------

/** Re-run interpret() over a record. Pure — no network. */
function score(scenario: Scenario, rec: RunRecord) {
  const changes = diffCampaign(BEFORE, scenario.after);
  const { built } = buildRequest(BEFORE, scenario.after, changes);
  return interpret(rec.response, built, DEFAULT_THRESHOLDS);
}

function report(scenario: Scenario, rec: RunRecord, prev: RunRecord | null) {
  const v = score(scenario, rec);
  const answered = Object.keys(rec.response.answers ?? {}).length;

  console.log();
  console.log(C.bold(`── ${scenario.id} `.padEnd(74, "─")));
  console.log(
    C.dim(
      `   ${rec.changes} changes · ${answered}/${rec.questions} answered · ` +
        `${(rec.state_bytes / 1024).toFixed(1)} KB state · ${rec.latency_ms} ms` +
        (rec.usage
          ? ` · ${(rec.usage as { input_tokens?: number }).input_tokens ?? "?"} in / ` +
            `${(rec.usage as { output_tokens?: number }).output_tokens ?? "?"} out`
          : ""),
    ),
  );

  if (answered < rec.questions) {
    console.log(
      C.red(`   ⚠ ${rec.questions - answered} question(s) returned no answer`),
    );
  }

  // --- global readings, with movement vs the recorded baseline -------------
  const prevV = prev ? score(scenario, prev) : null;
  const delta = (now: number | null, was: number | null | undefined) => {
    if (now === null || was === null || was === undefined) return "";
    const d = now - was;
    if (Math.abs(d) < 0.005) return C.dim("   ·");
    return (d > 0 ? C.green : C.red)(`${d > 0 ? "+" : ""}${d.toFixed(2)}`);
  };

  console.log(C.bold("   globals"));
  const themeLine = v.theme
    ? `${v.theme.choice} (${v.theme.confidence.toFixed(2)})`
    : "—";
  console.log(`     theme             ${themeLine}`);

  if (v.blastRadius) {
    const br = v.blastRadius;
    console.log(
      `     blast_radius      ${br.choice} ` +
        `${decisive(br.confidence)}` +
        (prevV?.blastRadius
          ? `  ${C.dim(`was ${prevV.blastRadius.choice}`)} ${
            delta(br.confidence, prevV.blastRadius.confidence)
          }`
          : ""),
    );
    // The top-two gap matters: a wide gap means the rubric discriminates.
    const probs = br.probabilities ?? {};
    const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1) {
      const gap = ranked[0][1] - ranked[1][1];
      const mismatch = ranked[0][0] !== br.choice;
      console.log(
        C.dim(
          `                       top ${ranked[0][0]} ${ranked[0][1].toFixed(2)} · ` +
            `then ${ranked[1][0]} ${ranked[1][1].toFixed(2)} · gap ${gap.toFixed(2)}`,
        ) + (mismatch ? C.red("  ← choice ≠ argmax") : ""),
      );
    }
  }

  const agree = v.blastRadius?.choice === v.derivedBlastRadius;
  console.log(
    `     └ derived          ${v.derivedBlastRadius} ` +
      (agree ? C.green("(agrees)") : C.yellow("(differs from asked)")) +
      C.dim("  — from the operation gates, not asked"),
  );

  for (
    const [label, now, was] of [
      ["safe_while_live     ", v.safeWhileLive, prevV?.safeWhileLive],
      ["invalidates_approval", v.invalidatesApproval, prevV?.invalidatesApproval],
      ["consent_conflict    ", v.consentConflict, prevV?.consentConflict],
      ["claim_risk          ", v.claimRisk, prevV?.claimRisk],
    ] as const
  ) {
    console.log(`     ${label}  ${decisive(now)}  ${delta(now, was)}`);
  }

  // --- materiality ---------------------------------------------------------
  console.log(C.bold("   materiality"));
  for (const c of v.changes) {
    const was = prevV?.changes.find((p) => p.change.path === c.change.path);
    console.log(
      `     ${decisive(c.probability)}  ${c.change.path.padEnd(46).slice(0, 46)} ` +
        delta(c.probability, was?.probability ?? null),
    );
  }

  // --- identity ------------------------------------------------------------
  if (v.identities.length) {
    console.log(C.bold("   identity"));
    for (const id of v.identities) {
      const to = id.resolvedTo === null ? "NEW" : `was ${id.resolvedTo}`;
      console.log(
        `     ${id.target.arrayPath}[${id.target.afterIndex}] ← ${to.padEnd(7)} ` +
          `conf ${id.confidence.toFixed(2)}${id.moved ? C.cyan("  moved") : ""}`,
      );
    }
  }

  // --- operations ----------------------------------------------------------
  console.log(C.bold("   operations"));
  const gated = v.operations.filter((o) => o.bucket !== "skip");
  for (const op of v.operations) {
    const was = prevV?.operations.find((p) => p.key === op.key);
    const mark = op.bucket === "required"
      ? C.green("REQ ")
      : op.bucket === "review"
      ? C.yellow("REV ")
      : C.dim("    ");
    console.log(
      `     ${mark} ${decisive(op.probability)}  ${op.key.replace("op__", "").padEnd(20)} ` +
        delta(op.probability, was?.probability ?? null),
    );
  }

  // Separation is the health metric for the operation rubrics: the gap between
  // the lowest gated op and the highest non-gated one.
  const skipped = v.operations.filter((o) => o.bucket === "skip");
  if (gated.length && skipped.length) {
    const gap = gated[gated.length - 1].probability - skipped[0].probability;
    console.log(
      C.dim(`     separation ${gap.toFixed(2)} between gated and skipped`),
    );
  }

  if (v.flags.length) {
    console.log(C.bold("   flags"));
    for (const f of v.flags) console.log(C.yellow(`     • ${f.slice(0, 100)}`));
  }

  return v;
}

// --- cross-scenario checks --------------------------------------------------

/**
 * The failure modes the handoff called out are only visible across scenarios:
 * one option winning everywhere, or a reading that never leaves the middle.
 */
function crossCheck(runs: Array<{ id: string; v: ReturnType<typeof score> }>) {
  console.log();
  console.log(C.bold("── cross-scenario ".padEnd(74, "─")));

  const brChoices = runs.map((r) => r.v.blastRadius?.choice ?? "—");
  const brConfs = runs.map((r) => r.v.blastRadius?.confidence ?? 0);
  const distinct = new Set(brChoices);
  const maxConf = Math.max(...brConfs);

  console.log(
    `   blast_radius     ${brChoices.join(", ")}\n` +
      `                    ${brConfs.map((c) => c.toFixed(2)).join(", ")}`,
  );
  if (distinct.size === 1 && runs.length > 1) {
    console.log(
      C.red(
        `   ✗ same option in all ${runs.length} scenarios (max conf ${
          maxConf.toFixed(2)
        }) — rubric is not discriminating`,
      ),
    );
  } else if (maxConf < 0.7) {
    console.log(
      C.yellow(`   ~ ${distinct.size} distinct options but all below .70`),
    );
  } else {
    console.log(
      C.green(`   ✓ ${distinct.size} distinct options, max conf ${maxConf.toFixed(2)}`),
    );
  }

  const derived = runs.map((r) => r.v.derivedBlastRadius);
  console.log(`   └ derived        ${derived.join(", ")}`);
  console.log(
    new Set(derived).size > distinct.size
      ? C.green(
        `   ✓ derived from operation gates discriminates better ` +
          `(${new Set(derived).size} vs ${distinct.size} distinct)`,
      )
      : C.dim(`     ${new Set(derived).size} distinct`),
  );

  for (
    const [label, vals] of [
      ["safe_while_live ", runs.map((r) => r.v.safeWhileLive ?? 0.5)],
      ["invalidates_appr", runs.map((r) => r.v.invalidatesApproval ?? 0.5)],
    ] as const
  ) {
    const mid = vals.filter((n) => n > 0.35 && n < 0.65).length;
    console.log(`   ${label} ${vals.map((n) => n.toFixed(2)).join(", ")}`);
    console.log(
      mid > vals.length / 2
        ? C.red(`   ✗ ${mid}/${vals.length} sit in the unactionable .35–.65 band`)
        : C.green(`   ✓ ${vals.length - mid}/${vals.length} are decisive`),
    );
  }

  const themes = runs.map((r) => r.v.theme?.choice ?? "—");
  const themeConfs = runs.map((r) => r.v.theme?.confidence ?? 0);
  console.log(`   theme            ${themes.join(", ")}`);
  // With more scenarios than theme options, two revisions sharing a label is
  // correct rather than a failure — the original "all distinct" test only held
  // while there were four. What would be a failure is one label swallowing the
  // set, so that is what is checked.
  const themeCounts = new Map<string, number>();
  for (const t of themes) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
  const [modal, modalCount] = [...themeCounts].sort((a, b) => b[1] - a[1])[0];
  console.log(
    modalCount > runs.length / 2
      ? C.red(
        `   ✗ "${modal}" claims ${modalCount}/${runs.length} — not discriminating`,
      )
      : C.green(
        `   ✓ ${themeCounts.size} distinct across ${runs.length}, min conf ${
          Math.min(...themeConfs).toFixed(2)
        }`,
      ),
  );

  // Materiality / operation disagreement — the UTM case from the handoff.
  console.log(C.bold("   materiality vs operation gates"));
  let disagreements = 0;
  for (const { id, v } of runs) {
    const anyCosmetic = v.changes.filter((c) => c.probability < 0.35);
    // Any gate cleared, not just Required. The `noise` scenario is the case
    // that made the difference: every change graded .04-.08 cosmetic while
    // crm_sync cleared the review gate at .73 off the campaign rename. Looking
    // only at Required missed it entirely.
    const gated = v.operations.filter((o) => o.bucket !== "skip");
    if (anyCosmetic.length && gated.length) {
      // Cheap heuristic: an op fired while every change it plausibly keys off
      // was graded cosmetic. Reported, not enforced.
      const allCosmetic = v.changes.every((c) => c.probability < 0.5);
      if (allCosmetic) {
        disagreements++;
        console.log(
          C.yellow(
            `     ${id}: no change graded material, yet ${
              gated.map((o) => `${o.key.replace("op__", "")} ${o.probability.toFixed(2)}`)
                .join(", ")
            } cleared a gate`,
          ),
        );
      }
    }
  }
  if (!disagreements) console.log(C.green("     ✓ none"));
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = Deno.args;
  const replay = args.includes("--replay");
  const compare = args.includes("--diff");
  const picked = args.filter((a) => !a.startsWith("--"));
  const chosen = picked.length
    ? SCENARIOS.filter((s) => picked.includes(s.id))
    : SCENARIOS;

  if (!chosen.length) {
    console.error(`No scenario matched. Known: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    Deno.exit(1);
  }

  console.log(
    C.bold(
      `\nJev diff prototype — ${replay ? "replaying fixtures" : "live run"} ` +
        `(${chosen.length} scenario${chosen.length === 1 ? "" : "s"})`,
    ),
  );
  if (!replay) console.log(C.dim(`  upstream ${UPSTREAM}`));

  const runs: Array<{ id: string; v: ReturnType<typeof score> }> = [];

  for (const scenario of chosen) {
    const prev = (compare || replay) ? await readFixture(scenario.id) : null;

    let rec: RunRecord;
    if (replay) {
      if (!prev) {
        console.log(C.red(`\n  ${scenario.id}: no fixture recorded — skipping`));
        continue;
      }
      rec = prev;
    } else {
      try {
        rec = await callLive(scenario);
      } catch (e) {
        console.log(C.red(`\n  ${scenario.id}: ${e instanceof Error ? e.message : e}`));
        continue;
      }
    }

    const v = report(scenario, rec, replay ? null : prev);
    runs.push({ id: scenario.id, v });

    if (!replay) await writeFixture(rec);
  }

  if (runs.length > 1) crossCheck(runs);

  if (!replay && runs.length) {
    console.log();
    console.log(C.dim(`  fixtures written to prototype/fixtures/`));
  }
  console.log();
}

if (import.meta.main) await main();
