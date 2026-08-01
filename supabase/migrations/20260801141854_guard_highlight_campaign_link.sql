-- Close a gap in the highlight-candidate column guard.
--
-- 20260801075645 protects the moment itself — bounds, title, rationale, quote,
-- scores — and lets a member flip `selected`. It does NOT protect
-- `campaign_id`, which was an oversight rather than a decision: a member could
-- point a moment at any campaign id they liked, including one in another
-- workspace, because the update policy only checks membership of the *asset*.
--
-- campaign_id is written when a brief turns picked moments into a draft
-- campaign, which is pipeline work. `selected` stays the one column a human
-- may change.
create or replace function public.tg_guard_highlight_candidate_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.source_asset_id is distinct from old.source_asset_id
     or new.start_seconds is distinct from old.start_seconds
     or new.end_seconds is distinct from old.end_seconds
     or new.title is distinct from old.title
     or new.rationale is distinct from old.rationale
     or new.quote is distinct from old.quote
     or new.viral_score is distinct from old.viral_score
     or new.score_confidence is distinct from old.score_confidence
     or new.campaign_id is distinct from old.campaign_id then
    raise exception
      'Only the AI pipeline can change a highlight candidate; you can select or deselect it'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_guard_highlight_candidate_columns()
  from public, anon, authenticated;
