/**
 * The operations catalogue.
 *
 * Each entry becomes one `noul` question, because the API has no list-valued
 * answer type — ChoiceAnswer.choice is a single string, noul and score are
 * single floats. "Which of these apply?" is structurally impossible to ask as
 * one question, so it becomes N yes/no questions in the same batch.
 *
 * Nothing here is ever called. The endpoints are shown so the readout reads
 * like a real work queue.
 */

import type { OperationSpec } from "./types.ts";

export const OPERATIONS: OperationSpec[] = [
  {
    key: "op__resync_ad_budgets",
    reach: "external_platforms",
    label: "Re-sync ad platform budgets",
    endpoint: "POST /ads/{platform}/budgets:sync",
    description:
      "Push the new budget totals, daily caps and pacing to LinkedIn and Google. Needed whenever spend figures or pacing change on a campaign that is scheduled or live.",
  },
  {
    key: "op__legal_recheck",
    reach: "gating",
    label: "Re-open legal review",
    endpoint: "POST /reviews/creative",
    description:
      "Send changed creative back to legal. Needed when copy introduces a claim, guarantee, statistic or comparison that was not in the approved version — not for rewording.",
  },
  {
    key: "op__rebuild_audience",
    // Segment membership is recomputed in our own audience store; the push to
    // ad platforms is resync_ad_budgets' job.
    reach: "downstream_consumers",
    label: "Rebuild audience segments",
    endpoint: "POST /audiences/{segment_id}:rebuild",
    description:
      "Recompute segment membership. Needed when targeting filters, exclusions or the segment list change in a way that alters who receives the campaign.",
  },
  {
    key: "op__crm_sync",
    reach: "downstream_consumers",
    label: "Re-sync CRM campaign record",
    endpoint: "POST /crm/salesforce/campaigns/{ref}:sync",
    description:
      "Push campaign metadata, goals and targets to Salesforce. Needed when names, targets, attribution or ownership change.",
  },
  {
    key: "op__regenerate_utm",
    reach: "external_platforms",
    label: "Regenerate tracking links",
    endpoint: "POST /links/utm:regenerate",
    description:
      "Reissue landing URLs and UTM parameters. Needed when any utm field or the landing URL changes, since links already in flight will mis-attribute.",
  },
  {
    key: "op__recompute_forecast",
    reach: "downstream_consumers",
    label: "Recompute pipeline forecast",
    endpoint: "POST /forecast:recompute",
    description:
      "Re-run the delivery and pipeline model. Needed when budget, targets, audience size or schedule change enough to move projected outcomes.",
  },
  {
    key: "op__finance_approval",
    reach: "gating",
    label: "Raise finance approval task",
    endpoint: "POST /approvals:create",
    description:
      "Open a finance approval. Needed when total budget increases materially, or when an existing finance approval no longer covers the current spend.",
  },
  {
    key: "op__invalidate_gdpr",
    reach: "gating",
    label: "Invalidate GDPR review",
    endpoint: "DELETE /compliance/gdpr-review/{campaign_id}",
    description:
      "Mark the existing GDPR review stale and block launch. Needed when targeting reaches regions or lawful bases the completed review did not cover.",
  },
];

export const OPERATION_BY_KEY = new Map(OPERATIONS.map((op) => [op.key, op]));
