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

  // --- second wave ---------------------------------------------------------
  //
  // The eight above were written against the original four scenarios, and the
  // five added later walked straight through the gaps: disabling a whole paid
  // channel, swapping an ad account, dropping a creative variant, rewriting
  // the send calendar, tripling the data-retention window and switching the
  // attribution model each mapped to no operation at all. The worst case was
  // `channel`, where the single most consequential change in the revision —
  // an entire channel switched off — left every gate dark.
  //
  // Each of these closes one of those gaps. The exclusion clause matters as
  // much as the trigger: it is what stops a new operation from firing on
  // everything the older ones already cover.

  {
    key: "op__push_channel_config",
    reach: "external_platforms",
    label: "Push channel delivery config",
    endpoint: "POST /channels/{channel_id}/config:push",
    description:
      "Push each channel's delivery settings to the provider that runs it: whether the channel is enabled, its send throttle, its bid strategy and the platform account it delivers through. Needed when a channel is switched on or off, or when the rate, bid or account it runs on changes. Not needed when only the money changes — spend figures, caps and pacing are the budget sync's job.",
  },
  {
    key: "op__reprogram_send_schedule",
    reach: "external_platforms",
    label: "Reprogram send schedule",
    endpoint: "POST /channels/{channel_id}/schedule:program",
    description:
      "Rewrite the send calendar held by the email provider. Needed when the campaign's start or end date, its timezone, or any send window changes, because sends already queued are timed against the old calendar and will fire at the wrong hour. Not needed when the content or the volume of a send changes but its timing does not.",
  },
  {
    key: "op__repush_creative_set",
    reach: "external_platforms",
    label: "Re-push creative set & rotation",
    endpoint: "POST /channels/{channel_id}/creatives:push",
    description:
      "Re-upload the set of creative variants and rebalance how traffic is split between them. Needed when a variant is added or removed, when rotation weights change, or when an A/B split no longer matches the variants that actually exist. Not needed for an edit to the wording inside a variant that is already in rotation — that is a content change, not a rotation change.",
  },
  {
    key: "op__rebaseline_reporting",
    reach: "downstream_consumers",
    label: "Re-baseline reporting",
    endpoint: "POST /reporting/campaigns/{campaign_id}:rebaseline",
    description:
      "Mark an attribution break and re-baseline the dashboards. Needed when the attribution model, the primary KPI, or the campaign's reporting identity changes, because results from before and after the change are not comparable and a dashboard will silently blend them. Not needed when target numbers move while the way they are measured stays the same.",
  },
  {
    key: "op__update_retention_policy",
    reach: "downstream_consumers",
    label: "Update retention & footer policy",
    endpoint: "PUT /compliance/retention/{campaign_id}",
    description:
      "Apply the retention window and CAN-SPAM footer to the contact records this campaign has already collected, which are governed by the stored value rather than the new one. Needed when the retention period or the footer reference changes. Not needed when the lawful basis or a regional restriction changes — that belongs to the GDPR review.",
  },
  {
    key: "op__halt_delivery",
    reach: "external_platforms",
    label: "Halt delivery before applying",
    endpoint: "POST /campaigns/{campaign_id}:halt",
    description:
      "Stop delivery before the revision is written, then resume. Needed only when the campaign is delivering right now and the change would land mid-flight in a way that cannot be corrected afterwards. Not needed when the campaign is not yet live, however disruptive the change would be once it starts — check the campaign's status before answering.",
  },
];

export const OPERATION_BY_KEY = new Map(OPERATIONS.map((op) => [op.key, op]));
