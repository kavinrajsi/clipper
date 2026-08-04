-- Seed the NAC Jewellers brand profile and ten campaigns into an existing
-- brand account.
--
-- Run against the LIVE project (ref nfeuykwnqqtdecwucujo) via the Supabase MCP
-- execute_sql tool or the SQL editor. Do NOT run it with the DATABASE_URL from
-- .env.development.local — that points at the local stack, and this file would
-- silently seed the wrong database.
--
-- Re-runnable: the brand profile upserts, and each campaign is skipped if a
-- campaign with the same title already exists in the workspace.
--
-- ⚠ The active and completed rows carry funding_status='paid' without any
-- Razorpay payment behind them. razorpay_order_id and razorpay_payment_id are
-- deliberately left NULL: the real funding path
-- (src/app/api/payments/campaigns/[id]/verify/route.js) always sets
-- razorpay_payment_id alongside funding_status='paid', so
--
--   select * from public.campaigns
--   where funding_status = 'paid' and razorpay_payment_id is null;
--
-- identifies exactly the rows seeded here. Consequence: these campaigns cannot
-- be refunded, because the Refunds API needs a real payment id.

-- No psql backslash commands in here: the file is meant to be pasted whole into
-- execute_sql / the SQL editor as well as run through psql. The DO block raises
-- on a bad lookup and the surrounding transaction rolls the whole thing back.

begin;

do $$
declare
  -- Swap this to a local brand (e.g. 'dev@local.test') to dry-run against the
  -- local stack before touching production.
  target_email constant text := 'madarth.com@gmail.com';
  brand_uid uuid;
  ws_id uuid;
  inserted int;
begin
  select id into brand_uid from auth.users where email = target_email;
  if brand_uid is null then
    raise exception 'No auth.users row for %; refusing to seed.', target_email;
  end if;

  -- Same shape as public.is_workspace_member: an unaccepted invite grants
  -- nothing, and a campaign with a null workspace_id is invisible to the brand,
  -- 404s on the detail page, and notifies nobody.
  select w.id into ws_id
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id
  where wm.user_id = brand_uid
    and wm.accepted_at is not null
  order by w.created_at
  limit 1;

  if ws_id is null then
    raise exception 'No accepted workspace membership for %; refusing to seed.', target_email;
  end if;

  raise notice 'Seeding into workspace % for user %', ws_id, brand_uid;

  insert into public.brand_profiles (
    user_id, workspace_id, company_name, website, industry, description,
    guidelines, tone_notes, updated_at
  )
  values (
    brand_uid,
    ws_id,
    'NAC Jewellers',
    'https://www.nacjewellers.com',
    'Jewellery & Retail',
    'Chennai-based jewellery retailer. Gold, diamond and silver ranges, bridal '
      || 'collections, and the Swarna Nidhi savings scheme, sold through '
      || 'showrooms across Tamil Nadu and online.',
    'Always show the BIS hallmark in product close-ups. Never quote a gold rate '
      || 'as fixed — it moves daily, and a stale number in an evergreen clip '
      || 'misleads. No claims about resale value, buy-back margins or investment '
      || 'returns. Do not imply a discount applies to making charges unless the '
      || 'brief says so.',
    'Warm and family-facing, for a Tamil-first audience. Trust and craft over '
      || 'hype. No countdown-timer urgency on price.',
    now()
  )
  on conflict (user_id) do update set
    workspace_id = excluded.workspace_id,
    company_name = excluded.company_name,
    website      = excluded.website,
    industry     = excluded.industry,
    description  = excluded.description,
    guidelines   = excluded.guidelines,
    tone_notes   = excluded.tone_notes,
    updated_at   = now();

  with v (
    title, description, requirements, payout_structure, payout_rate, budget,
    deadline, status, funding_status, visibility, created_at
  ) as (
    values
    -- ---------------------------------------------------------------- active
    (
      'Navratri Golu & Festive Gifting Cuts',
      'Golu season is when families buy small gifting pieces — thin chains, '
        || 'jhumkas, silver lamps and coin sets — rather than big-ticket bridal. '
        || 'We have four hours of showroom b-roll and three stylist interviews '
        || 'from the Anna Nagar store. Pull the gifting-under-a-budget angle out '
        || 'of it and make it feel like a festival, not a sale.',
      'Vertical 9:16, 20-45s. Hook in the first 2 seconds — lead with the piece, '
        || 'not the logo. Burned-in Tamil or English captions, both fine. Show '
        || 'the BIS hallmark in at least one close-up. Do not put a rupee figure '
        || 'on gold rate. No "limited stock" or countdown framing.',
      'per_view', 350, 70000, date '2026-09-28',
      'active', 'paid', 'public', timestamptz '2026-07-18 10:00:00+05:30'
    ),
    (
      'Bridal Season Lookbook Clips',
      'The November-February wedding run is the biggest revenue window of the '
        || 'year. We shot a full bridal lookbook — temple jewellery, kundan, '
        || 'polki and the lightweight reception sets — with six models over two '
        || 'days. We want one clip per look, cut so a bride can send it to her '
        || 'mother in a WhatsApp forward.',
      'Vertical 9:16, 30-60s, one look per clip. Open on the full look, then go '
        || 'to detail shots. Name the style on screen (temple / kundan / polki / '
        || 'reception). Captions required. Show the hallmark once. Do not add '
        || 'pricing. No stock wedding footage — use only the supplied shoot.',
      'flat_fee', 8000, 96000, date '2026-11-30',
      'active', 'paid', 'public', timestamptz '2026-07-22 15:30:00+05:30'
    ),
    (
      'Swarna Nidhi Savings Scheme Explainers',
      'Most customers hear about the monthly savings scheme at the counter and '
        || 'forget the details. We need plain-language explainers: what you pay '
        || 'in, what you get at the end, how the instalments work, and what '
        || 'happens if you miss one. Source material is a 40-minute session with '
        || 'our scheme desk plus the printed terms.',
      'Vertical 9:16, 45-90s. One question per clip — do not try to cover the '
        || 'whole scheme in one. Captions required, plain Tamil or plain English. '
        || 'Every claim must trace back to the supplied terms document; if it is '
        || 'not in there, leave it out. No language framing this as an investment '
        || 'or promising a return. End on "ask at any NAC counter", not a signup CTA.',
      'flat_fee', 6000, 60000, date '2026-10-20',
      'active', 'paid', 'public', timestamptz '2026-07-29 11:15:00+05:30'
    ),
    (
      'Diwali Lightweight Gold Edit',
      'Our biggest push of the year, aimed at first-time and self-buyers rather '
        || 'than wedding shoppers: sub-10g chains, everyday studs, stacking '
        || 'rings. Footage is the Diwali campaign shoot plus store-floor b-roll '
        || 'from three showrooms. We want volume here — this is the one campaign where '
        || 'reach matters more than polish.',
      'Vertical 9:16, 15-30s. Fast cuts, hook in the first second. Captions '
        || 'required. Show weight or "lightweight" framing on screen — that is '
        || 'the whole pitch. Hallmark visible once. No gold rate on screen. Do '
        || 'not imply a discount on making charges.',
      'per_view', 450, 135000, date '2026-11-05',
      'active', 'paid', 'public', timestamptz '2026-08-01 09:00:00+05:30'
    ),
    (
      '916 Hallmark & Purity Explainers',
      'Trust content, not sales content. What 916 actually means, how to read a '
        || 'BIS hallmark, what the HUID is, and why the same weight can cost '
        || 'different amounts at different shops. We have a 25-minute sit-down '
        || 'with our head of quality and macro footage of hallmarks under a loupe.',
      'Vertical 9:16, 30-75s. One concept per clip. Captions required. Macro '
        || 'hallmark footage must be legible at phone size — do not over-crop. '
        || 'Accuracy is the point: no paraphrasing that changes what a standard '
        || 'means. Do not compare NAC to named competitors. No pricing, no rate.',
      'per_view', 300, 45000, date '2026-12-05',
      'active', 'paid', 'public', timestamptz '2026-08-03 17:45:00+05:30'
    ),
    -- ----------------------------------------------------------------- draft
    (
      'Pongal Family Gifting Series',
      'Pongal skews toward silver — lamps, plates, kumkum boxes — and toward '
        || 'gifting across generations rather than for oneself. Shoot has not '
        || 'happened yet; this is scoped against last year''s footage so we can '
        || 'brief clippers early and fund once the January stock is locked.',
      'Vertical 9:16, 20-40s. Family or multi-generation framing preferred. '
        || 'Captions required. Silver pieces do not carry the gold hallmark — do '
        || 'not imply they do. No pricing.',
      'flat_fee', 5000, 50000, date '2027-01-08',
      'draft', 'unfunded', 'public', now()
    ),
    (
      'T. Nagar Flagship Store Walkthrough',
      'A guided walkthrough of the T. Nagar flagship — floor by floor, counter '
        || 'by counter — so an out-of-town customer knows what to expect before '
        || 'they visit. Invite-only: this is filmed inside the store during '
        || 'trading hours and we will only work with clippers we have briefed in '
        || 'person on what may and may not be filmed.',
      'Vertical 9:16, 45-90s. No customer faces on camera, no security '
        || 'equipment, no back-of-house. Staff appear only with signed consent. '
        || 'Captions required. Shoot slots are scheduled with the store manager — '
        || 'do not turn up unannounced.',
      'flat_fee', 12000, 48000, date '2026-11-20',
      'draft', 'unfunded', 'invite_only', now()
    ),
    (
      'Gold Rate Literacy Shorts',
      'Explainers on why the gold rate moves day to day, what making charges '
        || 'are, how wastage is calculated, and how to read a jewellery bill. '
        || 'Evergreen, not seasonal. Still deciding whether to shoot fresh or cut '
        || 'from the quality team''s existing sessions, hence draft.',
      'Vertical 9:16, 30-60s. One concept per clip. Captions required. Never '
        || 'state a specific rate — the clip outlives the number. No advice on '
        || 'when to buy. No investment or returns framing of any kind.',
      'per_view', 300, 30000, date '2026-12-20',
      'draft', 'unfunded', 'public', now()
    ),
    -- ------------------------------------------------------------- completed
    (
      'Akshaya Tritiya Gold Coin Drop',
      'Coin and small-denomination push around Akshaya Tritiya. Ran across the '
        || 'auspicious-buying window with a focus on 1g and 2g coins and the '
        || 'gifting box sets. Closed out — kept here for reference on what the '
        || 'format produced.',
      'Vertical 9:16, 15-30s. Coin in frame within the first second. Captions '
        || 'required. Hallmark close-up mandatory on coin content. No rate on '
        || 'screen, no investment framing.',
      'per_view', 400, 80000, date '2026-05-10',
      'completed', 'paid', 'public', timestamptz '2026-04-01 10:00:00+05:30'
    ),
    (
      'Aadi Offer Countdown Clips',
      'Aadi-month offer window on making charges. Short, high-frequency clips '
        || 'pointing at the offer period and the participating showrooms. Closed '
        || 'when the window ended.',
      'Vertical 9:16, 15-25s. State the offer period on screen. Captions '
        || 'required. The offer applies to making charges only — say so, do not '
        || 'let it read as a discount on gold. List participating showrooms in '
        || 'the description, not burned into the video.',
      'flat_fee', 4000, 32000, date '2026-08-01',
      'completed', 'paid', 'public', timestamptz '2026-07-05 12:00:00+05:30'
    )
  )
  insert into public.campaigns (
    brand_id, workspace_id, title, description, requirements, platform,
    payout_structure, payout_rate, budget, deadline, status, funding_status,
    visibility, created_at, updated_at
  )
  select
    brand_uid, ws_id, v.title, v.description, v.requirements, 'youtube',
    v.payout_structure, v.payout_rate, v.budget, v.deadline, v.status,
    v.funding_status, v.visibility, v.created_at, v.created_at
  from v
  where not exists (
    select 1 from public.campaigns c
    where c.workspace_id = ws_id and c.title = v.title
  );

  get diagnostics inserted = row_count;
  raise notice 'Inserted % campaign(s).', inserted;
end $$;

commit;
