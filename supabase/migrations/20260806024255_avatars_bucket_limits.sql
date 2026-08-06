-- ---------------------------------------------------------------------------
-- avatars: constrain what can be stored in the one PUBLIC bucket
-- ---------------------------------------------------------------------------
--
-- The bucket is public (20260731191104), so every object in it is served
-- unauthenticated by URL from the Supabase storage origin — the same origin
-- storage tokens live on. It was created with no allowed_mime_types and no
-- file_size_limit, and uploadPublicImage() derived the extension straight from
-- file.name with no filter, unlike the other two upload helpers in
-- src/lib/storage.js which both sanitise.
--
-- So a user could store `evil.svg` (or HTML, with a chosen content type) and
-- have it served publicly and permanently as script on that origin.
--
-- RLS already pins the first path segment to auth.uid(), so this was always
-- self-scoped — no cross-user overwrite and no traversal. The exposure is
-- hosting active content on a trusted origin, not touching anyone else's files.
--
-- source-assets already sets a limit (20260801044647); avatars was the gap.
-- The matching client-side check in src/lib/storage.js gives a readable error;
-- this is the half that actually holds.

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
       file_size_limit = 5242880   -- 5 MB
 where id = 'avatars';

do $$
declare limits record;
begin
  select allowed_mime_types, file_size_limit into limits
    from storage.buckets where id = 'avatars';

  if limits is null then
    raise notice 'avatars bucket not present — nothing to constrain';
  elsif limits.allowed_mime_types is null or limits.file_size_limit is null then
    raise exception 'avatars bucket is still unconstrained';
  end if;
end $$;
