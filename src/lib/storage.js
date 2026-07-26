// Storage helpers.
//
// The avatar upload block was duplicated verbatim in brand-profile-form.jsx and
// profile-form.jsx. It lives here now.
//
// Two buckets, deliberately different:
//
//   avatars       public.  getPublicUrl. An avatar is meant to be seen by
//                 anyone, including on a public creator profile.
//   brand-assets  private. createSignedUrl. Licensed fonts and music carry
//                 redistribution terms, so a permanent public URL is wrong —
//                 a leaked link would be ungoverned forever.
//
// storage.objects has its own RLS, separate from the table policies. Both are
// workspace-scoped on the object key's first path segment.

export const AVATARS_BUCKET = "avatars";
export const BRAND_ASSETS_BUCKET = "brand-assets";

// Signed URLs are short-lived on purpose: long enough to click, short enough
// that a copied link stops working.
const SIGNED_URL_TTL_SECONDS = 60 * 10;

/**
 * Upload a public image and return its permanent URL.
 *
 * `stem` is "avatar" for a personal profile and "logo" for a brand — the only
 * thing that differed between the two copies this replaces.
 *
 * The path is deterministic per user, so re-uploading replaces rather than
 * accumulates. That is why upsert is on, and also why the URL needs
 * cache-busting below.
 */
export async function uploadPublicImage(supabase, userId, file, stem = "avatar") {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${userId}/${stem}.${extension}`;

  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, { upsert: true });

  if (error) return { url: null, error };

  const {
    data: { publicUrl },
  } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);

  // Cache-bust: the path is stable, so browsers would otherwise keep showing
  // the previous image.
  return { url: `${publicUrl}?v=${Date.now()}`, error: null };
}

/**
 * Upload a brand asset. The first path segment must be the workspace id — the
 * storage.objects policies read it to decide access.
 */
export async function uploadBrandAsset(supabase, workspaceId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${workspaceId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(BRAND_ASSETS_BUCKET)
    .upload(path, file, { upsert: false });

  return { path: error ? null : path, error };
}

/**
 * Time-limited download URL for a private brand asset.
 */
export async function signBrandAssetUrl(supabase, storagePath, expiresIn = SIGNED_URL_TTL_SECONDS) {
  const { data, error } = await supabase.storage
    .from(BRAND_ASSETS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  return { url: data?.signedUrl ?? null, error };
}

/**
 * Sign many at once — the asset library lists everything on one page, and
 * signing serially would be one round trip per row.
 */
export async function signBrandAssetUrls(supabase, storagePaths, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (storagePaths.length === 0) return {};

  const { data } = await supabase.storage
    .from(BRAND_ASSETS_BUCKET)
    .createSignedUrls(storagePaths, expiresIn);

  return Object.fromEntries(
    (data ?? []).filter((row) => row.signedUrl).map((row) => [row.path, row.signedUrl])
  );
}

export async function removeBrandAsset(supabase, storagePath) {
  return supabase.storage.from(BRAND_ASSETS_BUCKET).remove([storagePath]);
}
