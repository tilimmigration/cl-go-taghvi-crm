export const NAVY = "var(--brill-navy)";
export const ORANGE = "var(--brill-orange)";
export const BLUE = "var(--brill-blue)";
export const WINE = "var(--brill-wine)";

export const VIEWS = {
  dash: {
    key: "dash",
    label: "Dashboard",
    overline: "Live metrics",
    title: "Performance overview",
    sub: "Deduplicated leads, funnel conversion and channel cost in one view. Numbers illustrate the structure, not real reporting.",
  },
  pipe: {
    key: "pipe",
    label: "Pre-CE pipeline",
    overline: "Pre-consultation",
    title: "Pipeline and dedupe queue",
    sub: "Every source lands in one board with a source tag. Suspected duplicates hold for review instead of splitting the record.",
  },
  post: {
    key: "post",
    label: "Post-CE by case type",
    overline: "Post-consultation",
    title: "Proposal to signed client",
    sub: "Three case types, three cadences. Urgency sets the follow-up rhythm, not a single generic sequence.",
  },
  record: {
    key: "record",
    label: "Lead record",
    overline: "Single record",
    title: "Unified lead record",
    sub: "One person, one record, every touch appended. The AI layer reads this record and drafts the next step.",
  },
  map: {
    key: "map",
    label: "Funnel map",
    overline: "Future state",
    title: "End-to-end funnel map",
    sub: "The pre-CE and post-CE flow as agreed in the scope, with the automations that fire at each hand-off.",
  },
  road: {
    key: "road",
    label: "Roadmap",
    overline: "Phasing",
    title: "Phase 1, 2 and 3",
    sub: "Fix the plumbing first, add the AI layer second, revisit the platform only if Monday runs out of room.",
  },
};

export const SOURCES = [
  { name: "Paid ads — quiz", state: "Connected", color: ORANGE },
  { name: "Paid ads — checklist", state: "Connected", color: ORANGE },
  { name: "Website form", state: "Needs fix", color: "var(--brill-neutral-warm)" },
  { name: "Calendly", state: "Connected", color: ORANGE },
  { name: "AI receptionist", state: "Connected", color: ORANGE },
  { name: "Referrals", state: "Manual", color: "var(--fg-on-dark-3)" },
];

export const TF_LABELS = { week: "This week", month: "This month", quarter: "This quarter" };

export const KPI_SETS = {
  week: [
    ["Total unique leads", "21", "+11% vs prior week", 1],
    ["CE booked", "8", "+14%", 1],
    ["Proposal Pending Acceptance", "5", "−4%", -1],
    ["Contracts signed", "2", "Flat", 0],
    ["Revenue", "$12,800", "+18%", 1],
  ],
  month: [
    ["Total unique leads", "84", "+18% vs last month", 1],
    ["CE booked", "31", "+29%", 1],
    ["Proposal Pending Acceptance", "19", "+12%", 1],
    ["Contracts signed", "6", "+20%", 1],
    ["Revenue", "$47,400", "+22%", 1],
  ],
  quarter: [
    ["Total unique leads", "231", "+9% vs prior quarter", 1],
    ["CE booked", "88", "+6%", 1],
    ["Proposal Pending Acceptance", "57", "−3%", -1],
    ["Contracts signed", "18", "+13%", 1],
    ["Revenue", "$142,600", "+15%", 1],
  ],
};

export function kpisFor(tf) {
  return KPI_SETS[tf].map((k) => ({
    label: k[0],
    value: k[1],
    delta: k[2],
    color: k[3] > 0 ? ORANGE : k[3] < 0 ? WINE : "var(--fg-3)",
  }));
}

export const FUNNEL = [
  { label: "Leads → CE booked", count: "31 of 84", rate: "37%", width: "37%", bar: NAVY, target: "40%", verdict: "3 points short" },
  { label: "CE booked → CE completed", count: "19 of 31", rate: "61%", width: "61%", bar: WINE, target: "80%", verdict: "biggest leak — reminders and no-shows" },
  { label: "CE completed → proposal sent", count: "14 of 19", rate: "74%", width: "74%", bar: NAVY, target: "90%", verdict: "5 CEs left without a proposal" },
  { label: "Proposal sent → signed", count: "6 of 14", rate: "43%", width: "43%", bar: NAVY, target: "45%", verdict: "on track" },
  { label: "Overall lead → signed", count: "6 of 84", rate: "7.1%", width: "7%", bar: ORANGE, target: "10%", verdict: "recovering CE show rate closes most of the gap" },
];

export const CASE_TYPES = [
  { name: "Deportation / asylum", urgency: "Very urgent", urgencyColor: WINE, leads: "19", ceRate: "47%", signRate: "11%", days: "4" },
  { name: "Family immigration", urgency: "Medium urgent", urgencyColor: ORANGE, leads: "38", ceRate: "40%", signRate: "8%", days: "19" },
  { name: "Employment immigration", urgency: "Low urgency", urgencyColor: "var(--fg-3)", leads: "27", ceRate: "30%", signRate: "4%", days: "96" },
];

export const CHANNELS = [
  { name: "Google Ads", leads: "24", cpl: "$86", ces: "11", cpce: "$187", signed: "3", cac: "$686", weight: "500", cacColor: NAVY },
  { name: "Meta Ads", leads: "31", cpl: "$61", ces: "9", cpce: "$211", signed: "2", cac: "$949", weight: "500", cacColor: WINE },
  { name: "Website — organic", leads: "14", cpl: "—", ces: "5", cpce: "—", signed: "1", cac: "—", weight: "500", cacColor: "var(--fg-3)" },
  { name: "Phone — inbound", leads: "9", cpl: "—", ces: "4", cpce: "—", signed: "0", cac: "—", weight: "500", cacColor: "var(--fg-3)" },
  { name: "Referrals", leads: "6", cpl: "—", ces: "2", cpce: "—", signed: "0", cac: "—", weight: "500", cacColor: "var(--fg-3)" },
  { name: "Total", leads: "84", cpl: "$47 blended", ces: "31", cpce: "$128", signed: "6", cac: "$659", weight: "700", cacColor: NAVY },
];

export const ALERTS = [
  { tag: "Attribution", title: "First touch decides channel credit", body: "Meta buys the cheaper lead; Google converts it. Judge Meta on CPL and lead quality, Google on CAC — and read blended CAC before moving budget." },
  { tag: "Leak", title: "12 booked consultations never happened", body: "No-shows and cancellations are the largest single loss in the funnel. Calendly reminders plus a same-day confirmation call recover most of it." },
  { tag: "Data gap", title: "Website form still writes to the sheet only", body: "The 31 July submission reached Google Sheets but no inbox. Until the webhook is re-enabled, website leads depend on someone opening the sheet." },
];

const CARD_CASE = {
  Family: ["var(--brill-orange-100)", "var(--brill-wine)"],
  Employment: ["var(--surface-muted)", "var(--fg-2)"],
  Deportation: ["var(--brill-wine-100)", "var(--brill-wine)"],
};

function mk(name, cs, source, age, owner, flag, flagText, leadKey, showDedupeFlags) {
  return {
    name,
    case: cs,
    source,
    age,
    owner,
    caseBg: CARD_CASE[cs][0],
    caseFg: CARD_CASE[cs][1],
    ownerColor: owner === "Unassigned" ? WINE : "var(--fg-3)",
    flag: !!(flag && showDedupeFlags),
    flagText,
    leadKey: leadKey || "ana",
  };
}

export function boardFor(showDedupeFlags = true) {
  return [
    {
      name: "New lead", count: "9", accent: NAVY, trigger: "Auto on form submission",
      cards: [
        mk("Ana Beltrán", "Family", "Meta — quiz", "2h", "Unassigned", true, "Merged with inbound call · same phone", "ana", showDedupeFlags),
        mk("Marcus Oyelaran", "Deportation", "Phone — AI receptionist", "5h", "Alejandro", false, "", "marcus", showDedupeFlags),
        mk("Priya Raghunathan", "Employment", "Google — checklist", "1d", "Alejandro", false, "", "priya", showDedupeFlags),
        mk("Luis Herrera", "Family", "Website — query form", "1d", "Unassigned", true, "Email matches 2024 enquiry", "ana", showDedupeFlags),
      ],
    },
    {
      name: "Contacted", count: "6", accent: NAVY, trigger: "Manual update by Alejandro",
      cards: [
        mk("Yusuf Demir", "Employment", "Google — checklist", "2d", "Alejandro", false, "", "priya", showDedupeFlags),
        mk("Grace Nwosu", "Family", "Referral — partner firm", "3d", "Alejandro", false, "", "ana", showDedupeFlags),
      ],
    },
    {
      name: "Engaged", count: "4", accent: ORANGE, trigger: "Lead replied or asked a question",
      cards: [
        mk("Diego Salvatierra", "Deportation", "Meta — quiz", "1d", "Soulmaz", false, "", "marcus", showDedupeFlags),
        mk("Elena Petrova", "Employment", "Website — organic", "4d", "Alejandro", false, "", "priya", showDedupeFlags),
      ],
    },
    {
      name: "CE booked", count: "7", accent: BLUE, trigger: "Auto via Calendly",
      cards: [
        mk("Ana Beltrán", "Family", "Calendly — 14 Aug 10:30", "booked", "Soulmaz", false, "", "ana", showDedupeFlags),
        mk("Marcus Oyelaran", "Deportation", "Calendly — 11 Aug 09:00", "booked", "Soulmaz", false, "", "marcus", showDedupeFlags),
        mk("Tariq Aziz", "Family", "Calendly — 15 Aug 13:00", "booked", "Soulmaz", false, "", "ana", showDedupeFlags),
      ],
    },
    {
      name: "CE completed", count: "5", accent: BLUE, trigger: "Calendly status or manual",
      cards: [
        mk("Priya Raghunathan", "Employment", "CE 6 Aug", "proposal due", "Alejandro", false, "", "priya", showDedupeFlags),
        mk("Nadia Haddad", "Family", "CE 5 Aug", "proposal sent", "Alejandro", false, "", "ana", showDedupeFlags),
      ],
    },
  ];
}

// The Deduplication queue is now driven by live data — see
// components/DedupeQueue.jsx and lib/dedupe.js. (The old mock DEDUPE rows were
// removed when that section went live.)

export const LANES = [
  { name: "Deportation", urgency: "Very urgent", window: "1–7 days", color: WINE, note: "Proposal goes out the same hour as the CE. Calls carry the follow-up; email only backs them up." },
  { name: "Family", urgency: "Medium urgent", window: "2–4 weeks", color: ORANGE, note: "Proposal within 24 hours, then alternating email and call to day 28 before Boomerang or Lost." },
  { name: "Employment", urgency: "Low urgency", window: "3–7 months", color: "var(--fg-3)", note: "Nurture, not pursuit. Monthly check-ins with content that keeps the firm in mind until timing changes." },
];

function cell(n, note, tone) {
  return {
    n,
    note,
    bg: tone === "hot" ? "var(--brill-wine-100)" : tone === "warm" ? "var(--brill-orange-100)" : "var(--surface-muted)",
    fg: tone === "hot" ? WINE : tone === "warm" ? "var(--brill-orange-700)" : NAVY,
  };
}

export const POST_STAGES = [
  { name: "Proposal sent", trigger: "Manual or Indadox", cells: [cell("3", "same day", "hot"), cell("6", "within 24h", "warm"), cell("5", "within 48h", "cool")] },
  { name: "Pending acceptance", trigger: "Auto on contract send", cells: [cell("2", "72h window", "hot"), cell("5", "day 3–28", "warm"), cell("4", "week 1–24", "cool")] },
  { name: "Follow-up in progress", trigger: "Auto by time since proposal", cells: [cell("1", "final call due", "hot"), cell("3", "call due day 10", "warm"), cell("3", "nurture week 4", "cool")] },
  { name: "Signed up", trigger: "Auto via e-signature", cells: [cell("2", "avg 4 days", "cool"), cell("3", "avg 19 days", "cool"), cell("1", "avg 96 days", "cool")] },
  { name: "Payment received", trigger: "Auto via Stripe", cells: [cell("2", "$13,000", "cool"), cell("3", "$12,600", "cool"), cell("1", "$9,800", "cool")] },
  { name: "Boomerang", trigger: "Manual — revisit later", cells: [cell("0", "—", "cool"), cell("2", "re-open day 60", "cool"), cell("4", "quarterly touch", "cool")] },
  { name: "Lost", trigger: "Auto after cadence ends, or manual", cells: [cell("1", "chose competitor", "cool"), cell("4", "no response", "cool"), cell("2", "not qualified", "cool")] },
];

export const CADENCE = [
  {
    name: "Deportation", window: "1–7 days to sign", color: WINE,
    exit: "No answer after 72 hours moves to Lost — no response. Urgency cuts both ways.",
    steps: [
      { when: "Same hour", what: "Proposal sent" },
      { when: "Same day", what: "Follow-up call" },
      { when: "12 hours", what: "Follow-up email" },
      { when: "24 hours", what: "Follow-up call" },
      { when: "48 hours", what: "Follow-up email" },
      { when: "72 hours", what: "Final call" },
    ],
  },
  {
    name: "Family", window: "2–4 weeks to sign", color: ORANGE,
    exit: "Day 28 email decides it: Boomerang if timing, Lost if silence.",
    steps: [
      { when: "24 hours", what: "Proposal sent" },
      { when: "Day 3", what: "Follow-up email" },
      { when: "Day 5", what: "Follow-up call" },
      { when: "Day 7", what: "Follow-up email" },
      { when: "Day 10", what: "Follow-up call" },
      { when: "Day 14", what: "Follow-up email" },
      { when: "Day 21", what: "Follow-up call" },
      { when: "Day 28", what: "Final email" },
    ],
  },
  {
    name: "Employment", window: "3–7 months to sign", color: "var(--fg-3)",
    exit: "Month 6 outreach closes the cadence. Most of this cohort signs later, so Boomerang is the normal outcome.",
    steps: [
      { when: "48 hours", what: "Proposal sent" },
      { when: "Week 1", what: "Follow-up email" },
      { when: "Week 2", what: "Follow-up call" },
      { when: "Week 4", what: "Nurture email" },
      { when: "Week 6", what: "Check-in call" },
      { when: "Week 8", what: "Nurture email" },
      { when: "Month 3", what: "Check-in call" },
      { when: "Month 5", what: "Check-in call" },
      { when: "Month 6", what: "Final outreach" },
    ],
  },
];

function F(label, value, src, tone) {
  return { label, value, src, srcColor: tone === "manual" ? WINE : tone === "flag" ? "var(--brill-orange-700)" : "var(--fg-3)" };
}

export const LEADS = {
  ana: {
    name: "Ana Beltrán", id: "LD-1042", merged: "3", stage: "CE booked", stageBg: "var(--brill-blue-100)", stageFg: "var(--brill-blue-700)", owner: "Soulmaz",
    fields: [
      F("Email", "ana.beltran@gmail.com", "Primary key · quiz", "auto"),
      F("Phone", "(818) 442-0197", "Secondary key · normalised", "auto"),
      F("Case type", "Family immigration", "Derived from quiz", "auto"),
      F("First touch", "8 Aug 2026", "Meta ad → family quiz", "auto"),
      F("First-touch channel", "Meta Ads", "utm_source=meta", "auto"),
      F("Source detail", "Family quiz · Reunite-Aug · ad set B", "UTM captured", "auto"),
      F("Home address", "Not captured", "Required before contract", "manual"),
      F("Zip", "91406", "Quiz field", "auto"),
      F("CE date", "14 Aug 2026, 10:30", "Calendly", "auto"),
      F("Assigned to", "Soulmaz", "Manual", "manual"),
      F("Days since activity", "0", "Formula", "auto"),
      F("Dedupe status", "Merged, name variant confirmed", "Manual review 9 Aug", "flag"),
    ],
    timeline: [
      { date: "8 Aug 14:12", dot: ORANGE, title: "Family quiz completed", channel: "Meta Ads", body: "Spouse petition, US citizen sponsor, married 2023. UTM captured on the landing page." },
      { date: "8 Aug 14:13", dot: BLUE, title: "Immediate email sent", channel: "Constant Contact", body: "Welcome email plus consultation link. Opened twice, no click." },
      { date: "8 Aug 14:13", dot: "var(--fg-3)", title: "Added to 21-day sequence", channel: "Constant Contact", body: "Family nurture track. Will stop automatically once a CE is booked." },
      { date: "9 Aug 09:41", dot: WINE, title: "Inbound call, 4m 12s", channel: "AI receptionist", body: "Asked about timeline and cost. Phone matched an existing record — activity appended instead of creating a second lead." },
      { date: "9 Aug 10:05", dot: WINE, title: "Duplicate flagged and merged", channel: "Dedupe", body: "Name on the call was \"Ana Beltran\", quiz said \"Ana Beltrán\". Confirmed by Alejandro." },
      { date: "9 Aug 16:30", dot: NAVY, title: "Follow-up call, connected", channel: "Alejandro", body: "Walked through the process. Agreed to book a consultation." },
      { date: "9 Aug 16:52", dot: BLUE, title: "Consultation booked", channel: "Calendly", body: "14 Aug 10:30 with Soulmaz. Confirmation email and text sent; 48h, 24h and 1h reminders queued." },
    ],
    ai: {
      summary: { heading: "Lead summary", cta: "Copy to Monday", hasList: false, items: [], lines: [
        "Ana Beltrán came in through the family quiz on 8 August and called the office the next day, so the record is one person across two sources.",
        "Spouse petition with a US citizen sponsor, married 2023, based in Van Nuys. Her questions are timeline and total cost, not eligibility.",
        "Consultation is booked for 14 August at 10:30 with Soulmaz. Nothing is blocking except the home address needed for the contract.",
      ]},
      nba: { heading: "Next best action", cta: "Assign to Alejandro", hasList: true, lines: [
        "She booked within 24 hours of first contact, which puts her in the fastest-converting group of family leads. The risk now is the no-show rate, not interest.",
      ], items: [
        { text: "Confirmation call the morning of 13 August — booked-to-completed sits at 61%, and a live confirmation is the single biggest lever on it." },
        { text: "Collect the home address before the CE so the engagement letter can go out the same day." },
        { text: "Send the fee range ahead of the call. Cost is her stated question; answering it early shortens the CE." },
      ]},
      email: { heading: "Draft follow-up email", cta: "Send for review", hasList: false, items: [], lines: [
        "Subject: Your consultation on 14 August — what to bring",
        "Hi Ana,",
        "You're booked with Soulmaz on Thursday 14 August at 10:30. The call runs about 45 minutes and covers your timeline, the documents needed for a spouse petition, and our fees in full.",
        "Two things that help us move faster: your marriage certificate date and your current mailing address. You can reply with both.",
        "If Thursday stops working, use the link in your confirmation email to move it rather than cancelling.",
        "— Alejandro, Taghavi Immigration Law",
      ]},
      text: { heading: "Draft SMS", cta: "Send for review", hasList: false, items: [], lines: [
        "Hi Ana — Alejandro from Taghavi Immigration Law. Confirming Thursday 14 Aug, 10:30 with Soulmaz. Reply YES to confirm, or MOVE and I'll find another time.",
        "Second message, day of: Ana, we're on for 10:30 today. Link is in your email. Bring your marriage date and mailing address.",
      ]},
      prep: { heading: "Call prep brief", cta: "Open one-pager", hasList: true, lines: [
        "Spouse petition (I-130), US citizen sponsor, married 2023, no prior filings. Van Nuys, zip 91406.",
      ], items: [
        { text: "Likely questions: how long until a green card, can she work while it is pending, total cost including USCIS fees." },
        { text: "Talking point: her case is a straightforward concurrent filing — lead with the timeline, it is the strongest part of the answer." },
        { text: "Watch for: she compared timelines with a friend's consular case. Separate adjustment of status from consular processing early." },
      ]},
    },
  },
  marcus: {
    name: "Marcus Oyelaran", id: "LD-1051", merged: "2", stage: "Engaged", stageBg: "var(--brill-wine-100)", stageFg: WINE, owner: "Soulmaz",
    fields: [
      F("Email", "m.oyelaran@proton.me", "Primary key · call follow-up", "auto"),
      F("Phone", "(310) 559-8842", "Secondary key · normalised", "auto"),
      F("Case type", "Deportation defence", "Call transcript", "auto"),
      F("First touch", "9 Aug 2026", "AI receptionist, 06:58", "auto"),
      F("First-touch channel", "Phone — inbound", "No UTM", "auto"),
      F("Source detail", "Branded search → click to call", "GA4 assist", "auto"),
      F("Hearing date", "3 Sep 2026", "Stated on call", "manual"),
      F("Zip", "90045", "Call", "manual"),
      F("CE date", "11 Aug 2026, 09:00", "Calendly", "auto"),
      F("Assigned to", "Soulmaz", "Manual", "manual"),
      F("Days since activity", "0", "Formula", "auto"),
      F("Dedupe status", "Single record", "No match found", "auto"),
    ],
    timeline: [
      { date: "9 Aug 06:58", dot: WINE, title: "Inbound call, 7m 40s", channel: "AI receptionist", body: "Removal proceedings, hearing 3 September. Asked for the earliest possible consultation." },
      { date: "9 Aug 07:02", dot: ORANGE, title: "Flagged urgent", channel: "Automation", body: "Deportation keyword in the transcript routes to the urgent queue and notifies #leads in Slack." },
      { date: "9 Aug 07:20", dot: NAVY, title: "Callback, connected", channel: "Alejandro", body: "Confirmed the hearing date and that he has no counsel of record." },
      { date: "9 Aug 07:35", dot: BLUE, title: "Consultation booked", channel: "Calendly", body: "11 Aug 09:00 with Soulmaz. Reminders queued at 24h and 1h." },
      { date: "9 Aug 07:36", dot: "var(--fg-3)", title: "Nurture suppressed", channel: "Constant Contact", body: "Urgent cases skip the 21-day sequence. Direct contact only." },
    ],
    ai: {
      summary: { heading: "Lead summary", cta: "Copy to Monday", hasList: false, items: [], lines: [
        "Marcus Oyelaran called at 06:58 on 9 August about removal proceedings with a hearing on 3 September.",
        "No counsel of record, no prior filings mentioned. He asked for the earliest consultation available and took the first slot offered.",
        "Booked for 11 August at 09:00. Twenty-three days between consultation and hearing sets the whole timeline.",
      ]},
      nba: { heading: "Next best action", cta: "Assign to Soulmaz", hasList: true, lines: [
        "Deportation leads sign in one to seven days or not at all. Speed is the only variable that matters here.",
      ], items: [
        { text: "Have the engagement letter drafted before the consultation, not after. Same-hour send is the cadence for this case type." },
        { text: "Confirm by text tonight and again an hour before. A missed CE here costs a case, not a booking." },
        { text: "Ask for the hearing notice by email before the call so the filing deadline is verified independently." },
      ]},
      email: { heading: "Draft follow-up email", cta: "Send for review", hasList: false, items: [], lines: [
        "Subject: Tuesday 09:00 — please send your hearing notice",
        "Mr Oyelaran,",
        "You're booked with Soulmaz Taghavi on Tuesday 11 August at 09:00.",
        "Before then, please reply with a photo of your hearing notice (the NTA or the most recent notice from the court). It confirms the date and what has been filed, and it lets us come to the call with a plan rather than questions.",
        "If anything changes, call the office directly rather than replying — we will move the time.",
        "— Alejandro, Taghavi Immigration Law",
      ]},
      text: { heading: "Draft SMS", cta: "Send for review", hasList: false, items: [], lines: [
        "Mr Oyelaran — Alejandro at Taghavi Immigration Law. Confirming Tuesday 11 Aug, 9:00am with Soulmaz. Please text a photo of your hearing notice when you can.",
        "Hour before: We're ready for you at 9:00. Call this number if you have any trouble joining.",
      ]},
      prep: { heading: "Call prep brief", cta: "Open one-pager", hasList: true, lines: [
        "Removal proceedings, hearing 3 September 2026, no counsel of record. Los Angeles, zip 90045.",
      ], items: [
        { text: "Establish first: has he ever missed a hearing, and has anything been filed on his behalf." },
        { text: "Likely questions: can the hearing be moved, is detention a risk, what happens to his work permit." },
        { text: "Twenty-three days to the hearing. Say plainly what is achievable in that window and what is not." },
      ]},
    },
  },
  priya: {
    name: "Priya Raghunathan", id: "LD-1039", merged: "2", stage: "CE completed", stageBg: "var(--surface-muted)", stageFg: NAVY, owner: "Alejandro",
    fields: [
      F("Email", "priya.r@nimbusworks.io", "Primary key · checklist", "auto"),
      F("Phone", "(408) 220-6714", "Secondary key · normalised", "auto"),
      F("Case type", "Employment immigration", "Checklist form", "auto"),
      F("Current visa status", "H-1B, expires Mar 2028", "Checklist form", "auto"),
      F("First touch", "31 Jul 2026", "Google search → checklist", "auto"),
      F("First-touch channel", "Google Ads", "utm_source=google", "auto"),
      F("Source detail", "Employment checklist · EB2-NIW · exact match", "UTM captured", "auto"),
      F("Employer sponsorship", "Willing, undecided on timing", "CE notes", "manual"),
      F("CE date", "6 Aug 2026, completed", "Calendly", "auto"),
      F("Proposal", "Not yet sent", "Due 8 Aug", "flag"),
      F("Days since activity", "3", "Formula", "auto"),
      F("Dedupe status", "Single record", "No match found", "auto"),
    ],
    timeline: [
      { date: "31 Jul 11:24", dot: ORANGE, title: "Employment checklist completed", channel: "Google Ads", body: "H-1B holder exploring EB-2 NIW. Employer willing to sponsor but no timeline set." },
      { date: "31 Jul 11:25", dot: BLUE, title: "Immediate email sent", channel: "Constant Contact", body: "Checklist PDF delivered. Opened, one click through to the consultation page." },
      { date: "2 Aug 09:00", dot: "var(--fg-3)", title: "Sequence email 1", channel: "Constant Contact", body: "NIW eligibility explainer. Opened." },
      { date: "4 Aug 15:10", dot: NAVY, title: "Consultation booked", channel: "Calendly", body: "6 Aug 11:00 with Soulmaz." },
      { date: "6 Aug 11:00", dot: BLUE, title: "Consultation completed, 52m", channel: "Soulmaz", body: "Strong publication record. Advised NIW over PERM. Asked for a fee breakdown by phase." },
      { date: "9 Aug", dot: WINE, title: "Proposal overdue", channel: "Automation", body: "Employment cadence calls for a proposal within 48 hours of the CE. Three days elapsed." },
    ],
    ai: {
      summary: { heading: "Lead summary", cta: "Copy to Monday", hasList: false, items: [], lines: [
        "Priya Raghunathan found the firm through a Google search on 31 July and completed the employment checklist.",
        "H-1B valid to March 2028, exploring EB-2 NIW with a willing employer and no fixed timeline. Consultation completed 6 August; Soulmaz advised NIW over PERM.",
        "She asked for fees broken out by phase. That proposal is three days overdue against the 48-hour employment cadence.",
      ]},
      nba: { heading: "Next best action", cta: "Assign to Alejandro", hasList: true, lines: [
        "Employment cases take three to seven months to sign, which makes a late proposal easy to rationalise and expensive to repeat. This is the stage where the funnel loses 5 of 19 completed CEs.",
      ], items: [
        { text: "Send the phased fee proposal today. She asked for it directly on the call — the request is the buying signal." },
        { text: "Set the follow-up cadence to the employment track: week 1 email, week 2 call, then monthly." },
        { text: "Treat 2028 as the real deadline, not a reason to wait. Frame the cost of starting late." },
      ]},
      email: { heading: "Draft follow-up email", cta: "Send for review", hasList: false, items: [], lines: [
        "Subject: Your NIW fee breakdown, by phase",
        "Hi Priya,",
        "Following our call on 6 August, here is the fee structure broken out the way you asked — petition preparation, filing, and response to any request for evidence, priced separately so you can see where the work sits.",
        "Two notes from the call. Your publication record is the strongest part of the case, and starting before your H-1B enters its final year gives us room if USCIS comes back with questions.",
        "Attached is the engagement letter. Happy to walk through any line on a short call this week.",
        "— Alejandro, Taghavi Immigration Law",
      ]},
      text: { heading: "Draft SMS", cta: "Send for review", hasList: false, items: [], lines: [
        "Hi Priya — Alejandro from Taghavi Immigration Law. Just emailed the phased fee breakdown you asked for after Thursday's call. Any questions, reply here and I'll call you back.",
        "Week 2, if no reply: Priya — checking you got the NIW proposal. Happy to answer anything before you decide on timing.",
      ]},
      prep: { heading: "Call prep brief", cta: "Open one-pager", hasList: true, lines: [
        "EB-2 NIW candidate, H-1B to March 2028, employer willing to sponsor. Bay Area, zip 95126.",
      ], items: [
        { text: "Recap: NIW recommended over PERM because it removes the employer dependency and the labour certification wait." },
        { text: "Likely questions: cost split across phases, whether to file concurrently, what happens if she changes employer." },
        { text: "Objection to expect: no urgency. Answer with the timeline, not the discount." },
      ]},
    },
  },
};

export const AI_LABELS = { summary: "Summary", nba: "Next best action", email: "Draft email", text: "Draft text", prep: "Call prep" };

export const MAP_SOURCES = [
  { name: "Paid ads", detail: "Meta and Google → family quiz, employment checklist", method: "Sheet → Zapier → Monday" },
  { name: "Website", detail: "Framer query form and Calendly booking, tracked as separate sources", method: "Webhook → Monday" },
  { name: "Phone", detail: "AI receptionist transcript and call tracker", method: "Native in Monday" },
  { name: "Referral", detail: "Partner firms and existing clients", method: "Intake form → Monday" },
];

export const MAP_STAGES = [
  { name: "New lead", trigger: "Auto on submission", arrow: "→", bg: "var(--brill-navy-900)", fg: "#FFFFFF", border: "var(--fg-on-dark-3)" },
  { name: "Contacted", trigger: "Manual — Alejandro", arrow: "→", bg: "var(--brill-navy-900)", fg: "#FFFFFF", border: "var(--fg-on-dark-3)" },
  { name: "Engaged", trigger: "Lead replied", arrow: "→", bg: "var(--brill-navy-900)", fg: "#FFFFFF", border: "var(--fg-on-dark-3)" },
  { name: "CE booked", trigger: "Auto via Calendly", arrow: "", bg: "var(--brill-orange)", fg: "var(--brill-navy)", border: "var(--brill-orange)" },
];

export const AUTOMATIONS = [
  { trigger: "On new lead", steps: [{ text: "Slack alert to #leads" }, { text: "Immediate email via Constant Contact" }, { text: "Added to the 21-day sequence" }, { text: "Added to the retargeting audience" }] },
  { trigger: "On CE booked", steps: [{ text: "Calendly confirmation email and text" }, { text: "Reminders at 48h, 24h and 1h" }, { text: "Nurture sequence stops" }, { text: "AI call prep brief generated" }] },
  { trigger: "On no response, 7 days", steps: [{ text: "Task for a sales call" }, { text: "AI-drafted follow-up email" }, { text: "AI-drafted follow-up text" }, { text: "Escalate if two attempts fail" }] },
];

export const MAP_POST = [
  { name: "Proposal sent", detail: "Engagement letter generated in Indadox, sent by email, logged against the record.", tag: "Auto", tagColor: BLUE, bg: "var(--surface-muted)", fg: NAVY },
  { name: "Pending acceptance", detail: "Follow-ups fire on the cadence for that case type. Day 3, 7, 14, 21, 28 for family.", tag: "Auto", tagColor: BLUE, bg: "var(--surface-muted)", fg: NAVY },
  { name: "Signed up → payment received", detail: "E-signature marks the record signed; Stripe confirms first payment and the lead becomes an active client.", tag: "Auto", tagColor: BLUE, bg: "var(--brill-orange-100)", fg: "var(--brill-orange-700)" },
  { name: "Boomerang or Lost", detail: "Boomerang re-enters nurture with a revisit date. Lost is split by reason: no response, competitor, not qualified.", tag: "Manual + auto", tagColor: WINE, bg: "var(--brill-wine-100)", fg: WINE },
];

export const PHASES = [
  {
    name: "Fix the plumbing", window: "Phase 1 · now – 30 days", bg: "var(--brill-navy)", fg: "#FFFFFF", subFg: "var(--fg-on-dark-2)", tagColor: ORANGE, rule: "rgba(255,255,255,0.18)",
    thesis: "Monday stays the source of truth. Nothing new gets bought until every source lands in one board.",
    items: [
      { text: "Re-enable the website form webhook so submissions reach both the sheet and the inbox" },
      { text: "Retire the outdated query page and tag remaining forms as distinct sources" },
      { text: "All sources into the Marketing Leads board with a source tag and UTM capture" },
      { text: "Zapier find-record step before create, matching on email then phone" },
      { text: "Slack alerts on new leads and overdue follow-ups" },
      { text: "Business Scorecard reads Monday by API for the metrics view" },
    ],
    doneWhen: "One board reconciles to every source, and the CE count matches the Calendly count.",
  },
  {
    name: "Add the AI layer", window: "Phase 2 · 30 – 90 days", bg: "var(--surface-raised)", fg: "var(--fg-1)", subFg: "var(--fg-2)", tagColor: "var(--brill-orange-700)", rule: "var(--border-subtle)",
    thesis: "This dashboard. It reads Monday, Sheets, Calendly and Stripe, and drafts the next step for a human to send.",
    items: [
      { text: "Unified lead record with a merged activity timeline" },
      { text: "Lead summary and next best action on every record" },
      { text: "Email and SMS drafts queued for review, never auto-sent" },
      { text: "Call prep brief generated before each consultation" },
      { text: "Funnel and channel metrics, including CPL, CPCE and CAC by first touch" },
    ],
    doneWhen: "Alejandro works from a queue of drafts instead of writing follow-ups from scratch.",
  },
  {
    name: "Revisit the platform", window: "Phase 3 · 90 days +", bg: "var(--surface-sunken)", fg: "var(--fg-1)", subFg: "var(--fg-2)", tagColor: WINE, rule: "rgba(27,36,71,0.15)",
    thesis: "Only if Monday's limits bite: board capacity, automation fragility, or dashboards that need workarounds.",
    items: [
      { text: "Evaluate HubSpot, Close or a custom build against the Phase 2 requirements" },
      { text: "Price migration against the cost of the workarounds it removes" },
      { text: "Add lead scoring, win/loss analysis and campaign recommendations" },
      { text: "Contract drafting from case type and fee structure" },
    ],
    doneWhen: "A decision is made on evidence from Phase 2, not on a feature list.",
  },
];

function st(label, tone) {
  return {
    status: label,
    bg: tone === "block" ? "var(--brill-wine-100)" : tone === "go" ? "var(--brill-orange-100)" : "var(--surface-muted)",
    fg: tone === "block" ? WINE : tone === "go" ? "var(--brill-orange-700)" : "var(--fg-2)",
  };
}

export const ACTIONS = [
  { item: "Lead-source and process sheet: all fields, mandatory flags for the Monday tracker, shared with the Taghavi team", owner: "Sheetal", ...st("In progress", "go") },
  { item: "Screenshots of existing Monday automations, Calendly emails and texts, and both Constant Contact sequences", owner: "Simone", ...st("Requested", "") },
  { item: "Website team: why the 31 July submission reached the sheet but no inbox", owner: "Sheetal + web", ...st("Blocking", "block") },
  { item: "Decision on removing the outdated submit-a-query page", owner: "Taghavi", ...st("Awaiting", "") },
  { item: "Monday board and column structure emailed to the Taghavi team for sign-off", owner: "Simone", ...st("Drafted", "go") },
  { item: "Dedupe rules confirmed: email primary, phone secondary, name mismatch to manual review", owner: "Robert + Sheetal", ...st("For this meeting", "go") },
];
