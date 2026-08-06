-- ---------------------------------------------------------------------------
-- Constrain every user-supplied URL column to http(s)
-- ---------------------------------------------------------------------------
--
-- WHY THE DATABASE AND NOT THE FORM
--
-- The three components that write these columns -- submission-form.jsx,
-- brand-profile-form.jsx and portfolio-manager.jsx -- are client components
-- calling supabase-js directly. There is no API route in between, so form-level
-- validation (`type="url"`, which accepts javascript:alert(1) anyway) is UX and
-- nothing more. A constraint holds however the row arrives: browser, SQL
-- editor, a future API route, or a service-role script.
--
-- WHAT THESE VALUES REACH
--
-- portfolio_items is the important one. Its RLS policy checks only user_id --
-- nothing constrains the values -- and those rows render as <img src> and href
-- on /c/[handle], which is readable by anonymous visitors. React 19 blocks a
-- javascript: href at render time, but it does not touch <img src>, and there
-- is no CSP on this app to constrain the outbound request. An attacker-chosen
-- image URL on a public profile is an arbitrary GET fired from every visitor's
-- browser.
--
-- ON THE PATTERN
--
-- `^https?://[^\s/]` -- the [^\s/] tail rejects `https:///` and, together with
-- the anchor, protocol-relative `//host/path`. `~*` makes it case-insensitive
-- so `HTTPS://` passes rather than tripping a confusing failure.
--
-- Added NOT VALID and validated separately. All six columns returned zero
-- violating rows when checked against production on 2026-08-05, so the
-- validation should be instant -- but NOT VALID means new writes are enforced
-- from the moment this lands even if a legacy row slipped in since, rather than
-- the whole migration aborting on one bad row.

-- portfolio_items -- client-written, rendered on the public profile page
alter table public.portfolio_items
  drop constraint if exists portfolio_items_thumbnail_url_scheme;
alter table public.portfolio_items
  add constraint portfolio_items_thumbnail_url_scheme
  check (thumbnail_url is null or thumbnail_url ~* '^https?://[^\s/]') not valid;
alter table public.portfolio_items validate constraint portfolio_items_thumbnail_url_scheme;

alter table public.portfolio_items
  drop constraint if exists portfolio_items_video_url_scheme;
alter table public.portfolio_items
  add constraint portfolio_items_video_url_scheme
  check (video_url is null or video_url ~* '^https?://[^\s/]') not valid;
alter table public.portfolio_items validate constraint portfolio_items_video_url_scheme;

-- campaign_submissions -- clipper-written, rendered in the brand's review UI
alter table public.campaign_submissions
  drop constraint if exists campaign_submissions_video_url_scheme;
alter table public.campaign_submissions
  add constraint campaign_submissions_video_url_scheme
  check (video_url is null or video_url ~* '^https?://[^\s/]') not valid;
alter table public.campaign_submissions validate constraint campaign_submissions_video_url_scheme;

-- brand_profiles -- website is free text; logo_url comes from Storage today,
-- but the column is writable by the same client-side upsert.
alter table public.brand_profiles
  drop constraint if exists brand_profiles_website_scheme;
alter table public.brand_profiles
  add constraint brand_profiles_website_scheme
  check (website is null or website ~* '^https?://[^\s/]') not valid;
alter table public.brand_profiles validate constraint brand_profiles_website_scheme;

alter table public.brand_profiles
  drop constraint if exists brand_profiles_logo_url_scheme;
alter table public.brand_profiles
  add constraint brand_profiles_logo_url_scheme
  check (logo_url is null or logo_url ~* '^https?://[^\s/]') not valid;
alter table public.brand_profiles validate constraint brand_profiles_logo_url_scheme;

-- profiles.avatar_url is written by handle_new_user from Google's OAuth
-- metadata as well as by the profile form. https://lh3.googleusercontent.com/...
-- passes; this does not break signup.
alter table public.profiles
  drop constraint if exists profiles_avatar_url_scheme;
alter table public.profiles
  add constraint profiles_avatar_url_scheme
  check (avatar_url is null or avatar_url ~* '^https?://[^\s/]') not valid;
alter table public.profiles validate constraint profiles_avatar_url_scheme;
