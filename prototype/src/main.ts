/**
 * Entry point. Owns all mutable state; everything else is a pure function.
 */

import { BEFORE } from "./campaign.ts";
import { diffCampaign } from "./diff.ts";
import { DEFAULT_THRESHOLDS, type Interpretation, interpret } from "./interpret.ts";
import { type BuiltQuestions, buildRequest } from "./questions.ts";
import { SCENARIOS, scenarioById } from "./scenarios.ts";
import {
  renderAnswers,
  renderDiff,
  renderOperations,
  renderScenarios,
  renderScenarioText,
} from "./ui.ts";
import type {
  Campaign,
  Change,
  SystemOneRequest,
  SystemOneResponse,
  Thresholds,
} from "./types.ts";

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

const els = {
  scenarios: must<HTMLDivElement>("#scenarios"),
  blurb: must<HTMLParagraphElement>("#blurb"),
  proves: must<HTMLDivElement>("#proves"),
  beforeJson: must<HTMLPreElement>("#before-json"),
  afterJson: must<HTMLTextAreaElement>("#after-json"),
  jsonState: must<HTMLSpanElement>("#json-state"),
  diffTable: must<HTMLTableElement>("#diff-table"),
  diffCount: must<HTMLElement>("#diff-count"),
  diffNote: must<HTMLElement>("#diff-note"),
  payloadJson: must<HTMLPreElement>("#payload-json"),
  payloadSummary: must<HTMLElement>("#payload-summary"),
  payloadHint: must<HTMLDivElement>("#payload-hint"),
  answers: must<HTMLDivElement>("#answers"),
  operations: must<HTMLDivElement>("#operations"),
  ask: must<HTMLButtonElement>("#ask"),
  callStatus: must<HTMLDivElement>("#call-status"),
  bundleStatus: must<HTMLDivElement>("#bundle-status"),
};

interface State {
  scenarioId: string;
  after: Campaign | null;
  changes: Change[];
  request: SystemOneRequest | null;
  built: BuiltQuestions | null;
  response: SystemOneResponse | null;
  interp: Interpretation | null;
  thresholds: Thresholds;
  inFlight: boolean;
}

const state: State = {
  scenarioId: SCENARIOS[0].id,
  after: null,
  changes: [],
  request: null,
  built: null,
  response: null,
  interp: null,
  thresholds: { ...DEFAULT_THRESHOLDS },
  inFlight: false,
};

// ---------------------------------------------------------------------------
// Stages 2-4: recompute from whatever is in the After pane
// ---------------------------------------------------------------------------

function recompute(): void {
  let parsed: Campaign | null = null;
  try {
    parsed = JSON.parse(els.afterJson.value) as Campaign;
    els.jsonState.textContent = "valid JSON";
    els.jsonState.className = "";
  } catch (e) {
    els.jsonState.textContent = e instanceof Error ? e.message : "invalid JSON";
    els.jsonState.className = "invalid";
  }

  state.after = parsed;

  if (!parsed) {
    els.ask.disabled = true;
    return;
  }

  state.changes = diffCampaign(BEFORE, parsed);
  renderDiff(els.diffTable, els.diffCount, els.diffNote, state.changes);

  const { request, built } = buildRequest(BEFORE, parsed, state.changes);
  state.request = request;
  state.built = built;

  const payload = JSON.stringify(request, null, 2);
  els.payloadJson.textContent = payload;

  const qCount = Object.keys(built.questions).length;
  els.payloadSummary.textContent =
    `show POST /v1/systemone payload — ${qCount} questions, ${(payload.length / 1024).toFixed(1)} KB`;
  els.payloadHint.textContent =
    `state = { campaign_id, status, before, after, changes[${state.changes.length}] }. ` +
    `The diff is computed here, not by Jev — so every question is a judgement call, ` +
    `not a re-derivation. State is sent once for all ${qCount} questions.`;

  els.ask.disabled = state.inFlight || state.changes.length === 0;

  // A new payload invalidates any previous answers.
  if (state.response) {
    state.response = null;
    state.interp = null;
    els.answers.replaceChildren();
    els.answers.append(hint("Payload changed — press Ask Jev to re-send."));
    els.operations.replaceChildren();
    els.operations.append(hint("Waiting for answers."));
    els.callStatus.textContent = "stale";
    els.callStatus.className = "status";
  }
}

function hint(text: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "hint";
  d.textContent = text;
  return d;
}

// ---------------------------------------------------------------------------
// Stage 1
// ---------------------------------------------------------------------------

function selectScenario(id: string): void {
  state.scenarioId = id;
  const s = scenarioById(id);
  renderScenarios(els.scenarios, SCENARIOS, id, selectScenario);
  renderScenarioText(els.blurb, els.proves, s);
  els.afterJson.value = JSON.stringify(s.after, null, 2);
  recompute();
}

// ---------------------------------------------------------------------------
// Stages 5-6
// ---------------------------------------------------------------------------

function reinterpret(): void {
  if (!state.response || !state.built) return;
  state.interp = interpret(state.response, state.built, state.thresholds);
  renderAnswers(els.answers, state.response, state.built, state.interp);
  renderOperations(els.operations, state.interp, state.thresholds, (t) => {
    state.thresholds = t;
    reinterpret();
  });
}

async function ask(): Promise<void> {
  if (!state.request || state.inFlight) return;

  state.inFlight = true;
  els.ask.disabled = true;
  els.callStatus.textContent = "calling Jev…";
  els.callStatus.className = "status";

  const started = performance.now();
  try {
    const res = await fetch("/api/systemone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state.request),
    });
    const elapsed = Math.round(performance.now() - started);
    const text = await res.text();

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${res.status}: ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
      const d = data as { error?: string; hint?: string; detail?: unknown };
      throw new Error(d.hint ? `${d.error} ${d.hint}` : d.error ?? JSON.stringify(data).slice(0, 300));
    }

    state.response = data as SystemOneResponse;
    const answered = Object.keys(state.response.answers ?? {}).length;
    const sent = Object.keys(state.request.questions).length;
    els.callStatus.textContent = `${elapsed} ms · ${answered}/${sent} answered`;
    els.callStatus.className = answered === sent ? "status ok" : "status err";
    reinterpret();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    els.callStatus.textContent = "failed";
    els.callStatus.className = "status err";
    els.answers.replaceChildren();
    els.answers.append(hint(message));
    console.error(e);
  } finally {
    state.inFlight = false;
    els.ask.disabled = !state.request || state.changes.length === 0;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let debounce: ReturnType<typeof setTimeout> | undefined;
els.afterJson.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(recompute, 250);
});

els.ask.addEventListener("click", () => void ask());

els.beforeJson.textContent = JSON.stringify(BEFORE, null, 2);
els.bundleStatus.textContent = `${SCENARIOS.length} scenarios loaded`;
selectScenario(state.scenarioId);
