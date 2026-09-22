/**
 * Scale test — the claim nothing had actually exercised.
 *
 * Every scenario so far ran on 4-10 changes and ~20 questions. The argument
 * for computing the diff in code was always about the case where an object has
 * ~150 candidate fields: one question per *change* instead of one per
 * candidate. That case had never been run, so the batch limits were unknown.
 *
 * This ramps the change count and reports, at each step, how many questions
 * came back answered and what it cost.
 *
 *   deno task scale                  # default ramp
 *   deno task scale -- 10 50 150     # explicit steps
 *
 * It also prints the three different "payload size" numbers that the UI, the
 * harness and the handoff note each quote, because they disagree.
 */

import { diffCampaign } from "../src/diff.ts";
import { buildRequest } from "../src/questions.ts";
import { BEFORE, clone } from "../src/campaign.ts";
import type { Campaign } from "../src/types.ts";

const UPSTREAM = Deno.env.get("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai";
const API_KEY = Deno.env.get("TYPESAFE_API_KEY")?.trim();

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

/**
 * A campaign carrying `n` extra tracked fields, all of which differ between
 * before and after. Synthetic, but it is the question count and the state size
 * that are under test, not the semantics.
 */
function pair(n: number): { before: Campaign; after: Campaign } {
  const before = clone(BEFORE) as Campaign & {
    custom_fields: Record<string, string | number>;
  };
  before.custom_fields = {};
  for (let i = 0; i < n; i++) {
    before.custom_fields[`attr_${String(i).padStart(3, "0")}`] = i % 3 === 0
      ? i * 10
      : `value_${i}_before`;
  }

  const after = clone(before);
  after.version = 8;
  for (let i = 0; i < n; i++) {
    const k = `attr_${String(i).padStart(3, "0")}`;
    after.custom_fields[k] = i % 3 === 0 ? i * 10 + 5 : `value_${i}_after`;
  }
  return { before, after };
}

async function step(n: number) {
  const { before, after } = pair(n);
  const changes = diffCampaign(before, after);
  const { request } = buildRequest(before, after, changes);

  const questions = Object.keys(request.questions).length;
  const minified = JSON.stringify(request);
  const stateOnly = JSON.stringify(request.state);
  const pretty = JSON.stringify(request, null, 2);

  const row = (label: string, v: string) => `${label} ${v}`;
  console.log(
    C.bold(`\n── ${n} changes `.padEnd(74, "─")) + "\n" +
      C.dim(
        `   ${questions} questions · state ${(stateOnly.length / 1024).toFixed(1)} KB · ` +
          `request ${(minified.length / 1024).toFixed(1)} KB minified / ` +
          `${(pretty.length / 1024).toFixed(1)} KB pretty`,
      ),
  );

  if (!API_KEY) {
    console.log(C.yellow("   no API key — sizing only"));
    return;
  }

  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${UPSTREAM}/v1/systemone`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: minified,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    console.log(C.red(`   ✗ transport: ${e instanceof Error ? e.message : e}`));
    return;
  }
  const ms = Math.round(performance.now() - started);
  const text = await res.text();

  if (!res.ok) {
    console.log(C.red(`   ✗ HTTP ${res.status} in ${ms} ms`));
    console.log(C.red(`     ${text.slice(0, 400).replace(/\n/g, "\n     ")}`));
    return;
  }

  const body = JSON.parse(text);
  const answers = Object.keys(body.answers ?? {}).length;
  const missing = Object.keys(request.questions).filter((k) => !body.answers?.[k]);

  const complete = answers === questions;
  console.log(
    `   ${complete ? C.green("✓") : C.red("✗")} ${answers}/${questions} answered · ` +
      `${ms} ms · ${(ms / questions).toFixed(1)} ms/question` +
      (body.usage
        ? C.dim(
          ` · ${body.usage.input_tokens} in / ${body.usage.output_tokens} out`,
        )
        : ""),
  );
  if (missing.length) {
    console.log(
      C.red(`     missing: ${missing.slice(0, 8).join(", ")}`) +
        (missing.length > 8 ? C.red(` … +${missing.length - 8}`) : ""),
    );
  }
  void row;
}

const steps = Deno.args.filter((a) => /^\d+$/.test(a)).map(Number);
const ramp = steps.length ? steps : [10, 25, 50, 100, 150, 250];

console.log(
  C.bold("\nScale test — one question per change, ramping the change count"),
);
console.log(C.dim(`  upstream ${UPSTREAM}`));

for (const n of ramp) await step(n);
console.log();
