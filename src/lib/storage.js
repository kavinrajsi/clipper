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
//   source-assets private, and uploaded differently from the other two. See
//                 createSourceAssetUploadUrl below.
//
// storage.objects has its own RLS, separate from the table policies. All three
// are workspace- or user-scoped on the object key's first path segment.

export const AVATARS_BUCKET = "avatars";
export const BRAND_ASSETS_BUCKET = "brand-assets";
export const SOURCE_ASSETS_BUCKET = "source-assets";

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

/**
 * Build the object key for a source asset. The first segment is the workspace
 * id because the storage.objects policies read it; the second is the row id, so
 * two uploads of the same filename cannot collide and the object can always be
 * traced back to its row.
 */
export function sourceAssetPath(workspaceId, assetId, filename) {
  const safeName = (filename ?? "upload").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
  return `${workspaceId}/${assetId}/${safeName}`;
}

/**
 * Mint a one-shot upload URL for a source asset.
 *
 * Unlike avatars and brand assets, the file never passes through the server.
 * A source asset is a 90-minute podcast, and a Vercel function has a request
 * body limit and a wall-clock limit that a multi-gigabyte upload will not
 * respect. So the server mints a signed URL and the browser PUTs straight to
 * storage with `uploadToSignedUrl`.
 *
 * Pass the RLS-scoped server client, not the admin client: the signed URL
 * inherits the caller's permissions, so the storage.objects insert policy still
 * decides whether this workspace may write here. Using the service-role client
 * would mint a URL that bypasses that check.
 */
export async function createSourceAssetUploadUrl(supabase, storagePath) {
  const { data, error } = await supabase.storage
    .from(SOURCE_ASSETS_BUCKET)
    .createSignedUploadUrl(storagePath);

  return { token: data?.token ?? null, signedUrl: data?.signedUrl ?? null, error };
}

/**
 * Time-limited playback/download URL. Longer TTL than the brand-asset one:
 * these get scrubbed through in a player while picking highlights, and a link
 * expiring mid-watch is worse than the marginal exposure.
 */
export async function signSourceAssetUrl(supabase, storagePath, expiresIn = 60 * 60) {
  const { data, error } = await supabase.storage
    .from(SOURCE_ASSETS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  return { url: data?.signedUrl ?? null, error };
}

export async function removeSourceAsset(supabase, storagePath) {
  return supabase.storage.from(SOURCE_ASSETS_BUCKET).remove([storagePath]);
}
