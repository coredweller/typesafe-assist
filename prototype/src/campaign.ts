/**
 * The "Before" campaign — version 7, approved except for finance, about to
 * go live on 1 Oct. Every scenario in scenarios.ts is a mutation of this.
 */

import type { Campaign } from "./types.ts";

export const BEFORE: Campaign = {
  campaign_id: "cmp_8f2a91",
  name: "Q4 Enterprise Push — NA",
  status: "scheduled",
  objective: "pipeline_generation",
  version: 7,
  updated_at: "2026-09-16T14:22:00Z",
  updated_by: "u_221",

  owner: {
    user_id: "u_221",
    email: "r.okonkwo@example.com",
    team: "Demand Generation",
  },

  schedule: {
    start_at: "2026-10-01T09:00:00Z",
    end_at: "2026-12-15T23:59:00Z",
    timezone: "America/New_York",
    // No ids on these — deliberately. See the schedule scenario.
    send_windows: [
      { days: ["mon", "tue", "wed"], start: "09:00", end: "11:30" },
      { days: ["mon", "tue", "wed"], start: "13:00", end: "17:00" },
      { days: ["thu"], start: "09:00", end: "17:00" },
      { days: ["fri"], start: "09:00", end: "12:00" },
    ],
  },

  budget: {
    currency: "USD",
    total: 250000,
    daily_cap: 4500,
    pacing: "even",
    allocations: [
      { channel: "paid_search", amount: 120000 },
      { channel: "paid_social", amount: 80000 },
      { channel: "display", amount: 50000 },
    ],
  },

  audience: {
    segments: [
      {
        segment_id: "seg_ent_na",
        name: "Enterprise NA",
        size_estimate: 48200,
        source: "crm",
      },
      {
        segment_id: "seg_tech_dm",
        name: "Technical Decision Makers",
        size_estimate: 31450,
        source: "enrichment",
      },
    ],
    exclusions: ["seg_churned_90d", "seg_active_opportunity"],
    filters: {
      geo: { include: ["US", "CA"], exclude: ["PR"] },
      company_size: { min: 500, max: null },
      industries: ["saas", "fintech", "healthcare"],
    },
    consent_basis: "legitimate_interest",
  },

  channels: [
    {
      channel_id: "ch_email_01",
      type: "email",
      enabled: true,
      provider: "sendgrid",
      throttle_per_hour: 5000,
      creatives: [
        {
          creative_id: "cr_a1",
          variant: "A",
          subject: "Transform your pipeline in Q4",
          preheader: "See how enterprise teams close faster",
          body_template_id: "tpl_991",
          weight: 50,
        },
        {
          creative_id: "cr_a2",
          variant: "B",
          subject: "Your Q4 pipeline, rebuilt",
          preheader: "A practical guide for enterprise teams",
          body_template_id: "tpl_992",
          weight: 50,
        },
      ],
    },
    {
      channel_id: "ch_paid_social_01",
      type: "paid_social",
      platform: "linkedin",
      enabled: true,
      bid_strategy: { type: "target_cost", target_cpa: 185, max_bid: 260 },
      creatives: [
        {
          creative_id: "cr_s1",
          variant: "A",
          headline: "Enterprise pipeline, predictably",
          body_template_id: "tpl_s40",
          weight: 100,
        },
      ],
    },
  ],

  landing: {
    url: "https://example.com/q4-enterprise",
    utm: {
      source: "linkedin",
      medium: "paid_social",
      campaign: "q4_ent_na",
      content: "variant_a",
    },
    form_id: "frm_77",
    ab_test: { enabled: true, split: [50, 50] },
  },

  goals: {
    primary_kpi: "mqls",
    targets: { mqls: 1200, sqls: 240, pipeline_usd: 3600000 },
    attribution_model: "w_shaped",
  },

  approvals: [
    { role: "legal", status: "approved", by: "u_88", at: "2026-09-10T11:04:00Z" },
    { role: "brand", status: "approved", by: "u_12", at: "2026-09-11T09:40:00Z" },
    { role: "finance", status: "pending", by: null, at: null },
  ],

  integrations: {
    crm: {
      system: "salesforce",
      campaign_ref: "701Bs00000XyZab",
      sync: "bidirectional",
    },
    map: { system: "marketo", program_id: "PGM-4412" },
    ad_accounts: { linkedin: "acc_5512", google: "acc_9921" },
  },

  compliance: {
    gdpr_reviewed: true,
    gdpr_reviewed_at: "2026-09-09T16:00:00Z",
    can_spam_footer_id: "ftr_3",
    data_retention_days: 365,
    restricted_regions: ["DE", "FR"],
  },
};

/** Deep clone helper so scenarios never mutate the shared BEFORE object. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The same campaign two weeks later: finance signed off (by someone other
 * than the owner), it launched on 15 Sept, and it is delivering now.
 *
 * Every scenario used to share the `scheduled` BEFORE, which meant nothing was
 * ever in flight and `halt_delivery` could not fire anywhere. The timezone
 * pair applies one identical edit to both versions.
 */
export const BEFORE_LIVE: Campaign = (() => {
  const c = clone(BEFORE);
  c.status = "live";
  c.schedule.start_at = "2026-09-15T09:00:00Z";
  c.approvals[2] = {
    role: "finance",
    status: "approved",
    by: "u_40",
    at: "2026-09-14T16:30:00Z",
  };
  return c;
})();
