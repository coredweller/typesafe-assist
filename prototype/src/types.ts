/**
 * Type contracts for the Jev diff prototype.
 *
 * Two unrelated domains live here:
 *   1. The marketing campaign object we are diffing.
 *   2. The TypeSafe System One request/answer shapes, mirrored from
 *      custom_components/typesafe_conversation/api.py.
 */

// ---------------------------------------------------------------------------
// TypeSafe System One wire format
// ---------------------------------------------------------------------------

/** A Choice question: pick one labelled option from `criteria`. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option key -> rubric sentence describing when that option applies */
  criteria: Record<string, string | null>;
}

/** A Noul question: a single yes/no probability. */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

/** A Score question: a number on a legend scale. Parsed by api.py, unused here. */
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria?: Record<string, string>;
}

export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface SystemOneRequest {
  state: unknown;
  model: string;
  questions: Record<string, Question>;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: Record<string, number>;
}

/** Hard limit from the TypeSafe API on Choice cardinality. */
export const MAX_CHOICE_OPTIONS = 255;

/** Sentinel option letting the model opt out of a Choice question. */
export const OPTION_NONE = "none";

// ---------------------------------------------------------------------------
// The marketing campaign object
// ---------------------------------------------------------------------------

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "paused"
  | "completed"
  | "archived";

export type Objective =
  | "awareness"
  | "consideration"
  | "pipeline_generation"
  | "retention";

export interface Owner {
  user_id: string;
  email: string;
  team: string;
}

/**
 * A send window. Deliberately has NO stable id — this is what makes the
 * schedule scenario (reorder vs edit) genuinely ambiguous to a structural differ.
 */
export interface SendWindow {
  days: string[];
  start: string;
  end: string;
}

export interface Schedule {
  start_at: string;
  end_at: string;
  timezone: string;
  send_windows: SendWindow[];
}

/** Keyed by `channel` — a key-aware differ can match these across versions. */
export interface BudgetAllocation {
  channel: string;
  amount: number;
}

export interface Budget {
  currency: string;
  total: number;
  daily_cap: number;
  pacing: "even" | "accelerated";
  allocations: BudgetAllocation[];
}

export interface Segment {
  segment_id: string;
  name: string;
  size_estimate: number;
  source: string;
}

export interface AudienceFilters {
  geo: { include: string[]; exclude: string[] };
  company_size: { min: number | null; max: number | null };
  industries: string[];
}

export interface Audience {
  segments: Segment[];
  exclusions: string[];
  filters: AudienceFilters;
  consent_basis: "consent" | "legitimate_interest" | "contract";
}

/** Keyed by `creative_id`. */
export interface Creative {
  creative_id: string;
  variant: string;
  subject?: string;
  preheader?: string;
  headline?: string;
  body_template_id?: string;
  weight: number;
}

export interface BidStrategy {
  type: string;
  target_cpa?: number;
  max_bid?: number;
}

/** Keyed by `channel_id`. */
export interface Channel {
  channel_id: string;
  type: string;
  enabled: boolean;
  provider?: string;
  platform?: string;
  throttle_per_hour?: number;
  bid_strategy?: BidStrategy;
  creatives: Creative[];
}

export interface Landing {
  url: string;
  utm: {
    source: string;
    medium: string;
    campaign: string;
    content: string;
  };
  form_id: string;
  ab_test: { enabled: boolean; split: number[] };
}

export interface Goals {
  primary_kpi: string;
  targets: Record<string, number>;
  attribution_model: string;
}

/** Keyed by `role`. */
export interface Approval {
  role: string;
  status: "pending" | "approved" | "rejected";
  by: string | null;
  at: string | null;
}

export interface Integrations {
  crm: { system: string; campaign_ref: string; sync: string };
  map: { system: string; program_id: string };
  ad_accounts: Record<string, string>;
}

export interface Compliance {
  gdpr_reviewed: boolean;
  gdpr_reviewed_at: string | null;
  can_spam_footer_id: string;
  data_retention_days: number;
  restricted_regions: string[];
}

export interface Campaign {
  campaign_id: string;
  name: string;
  status: CampaignStatus;
  objective: Objective;
  version: number;
  updated_at: string;
  updated_by: string;
  owner: Owner;
  schedule: Schedule;
  budget: Budget;
  audience: Audience;
  channels: Channel[];
  landing: Landing;
  goals: Goals;
  approvals: Approval[];
  integrations: Integrations;
  compliance: Compliance;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type ChangeOp = "add" | "remove" | "replace";

/**
 * One deterministic change. `i` is the stable index used to key questions
 * back to changes (`material__3` -> changes[3]) — the same trick the Home
 * Assistant integration uses with `entity__light`.
 */
export interface Change {
  i: number;
  path: string;
  op: ChangeOp;
  old: unknown;
  new: unknown;
}

/** The state payload sent to Jev: both versions PLUS the computed diff. */
export interface DiffState {
  campaign_id: string;
  status: CampaignStatus;
  before: Campaign;
  after: Campaign;
  changes: Change[];
}

// ---------------------------------------------------------------------------
// Operations (a readout — nothing is ever executed)
// ---------------------------------------------------------------------------

/**
 * How far outside this record an operation reaches. Used to *derive* a blast
 * radius from the operation gates rather than asking Jev for one directly —
 * see DERIVED_LEVELS in interpret.ts.
 *
 * `gating` operations are process steps (approvals, reviews). They block
 * launch but move no data, so they contribute no reach.
 */
export type Reach = "this_record" | "downstream_consumers" | "external_platforms" | "gating";

export interface OperationSpec {
  /** Question key, e.g. "op__resync_ad_budgets". */
  key: string;
  label: string;
  /** The call this *would* map to, shown for illustration only. */
  endpoint: string;
  description: string;
  /** The outermost boundary this operation crosses. */
  reach: Reach;
}

export type Bucket = "required" | "review" | "skip";

export interface OperationResult extends OperationSpec {
  probability: number;
  bucket: Bucket;
}

export interface Thresholds {
  high: number;
  low: number;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  /** What this scenario proves that a diff tool alone cannot do. */
  proves: string;
  /**
   * The version this revision is applied to. Omitted means the shared
   * `scheduled` BEFORE; the exclusion pair supplies a live one so the same
   * diff can be judged against two different states.
   */
  before?: Campaign;
  after: Campaign;
}
