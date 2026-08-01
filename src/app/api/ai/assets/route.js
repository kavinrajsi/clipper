// Register a source asset and hand back a one-shot upload URL.
//
// The file does not pass through this route. A source asset is a 90-minute
// podcast; a function has a request body limit and a wall-clock limit that a
// multi-gigabyte upload will not respect. So the row is created here and the
// browser PUTs straight to storage against a signed URL.
//
// Note there is no admin client anywhere in this file. The signed URL inherits
// the caller's permissions, so the storage.objects insert policy still decides
// whether this workspace may write to this path — which is the check we want.
// Minting it on the service-role client would bypass exactly that.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceRole, CAMPAIGN_ROLES } from "@/lib/workspaces";
import { createSourceAssetUploadUrl, sourceAssetPath } from "@/lib/storage";

// Generous, and matched by the bucket's own 5 GiB limit. The bucket is the real
// enforcement — this is here so an obviously impossible upload fails before a
// row is created rather than after.
const MAX_BYTES = 5 * 1024 * 1024 * 1024;

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const workspaceId = body?.workspaceId;
  const filename = body?.filename;
  const mimeType = body?.mimeType ?? null;
  const sizeBytes = body?.sizeBytes ?? null;

  if (!workspaceId || !filename) {
    return NextResponse.json(
      { error: "A workspace and a filename are required." },
      { status: 400 }
    );
  }

  if (sizeBytes !== null && (!Number.isFinite(sizeBytes) || sizeBytes <= 0)) {
    return NextResponse.json({ error: "That file size isn't valid." }, { status: 400 });
  }

  if (sizeBytes !== null && sizeBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is larger than the 5 GB limit." },
      { status: 400 }
    );
  }

  // Membership is checked here as well as by RLS. RLS would refuse the insert
  // anyway, but it would do it as an opaque failure after the row id and path
  // had already been chosen; this gives the caller a real answer.
  const role = await getWorkspaceRole(supabase, user, workspaceId);
  if (!role || !CAMPAIGN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // The id is generated before the insert because the storage path contains it,
  // and the row records the path. One of the two has to come first.
  const assetId = crypto.randomUUID();
  const storagePath = sourceAssetPath(workspaceId, assetId, filename);

  const { data: asset, error: insertError } = await supabase
    .from("source_assets")
    .insert({
      id: assetId,
      workspace_id: workspaceId,
      uploaded_by: user.id,
      storage_path: storagePath,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
    })
    .select()
    .single();

  if (insertError) {
    console.error("source_assets insert failed", insertError);
    return NextResponse.json({ error: "Could not register the upload." }, { status: 400 });
  }

  const { token, error: signError } = await createSourceAssetUploadUrl(supabase, storagePath);

  if (signError || !token) {
    // Nothing was uploaded, so the row would be a permanent orphan pointing at
    // an object that will never exist. Drop it rather than leave the studio
    // listing a file nobody can play.
    await supabase.from("source_assets").delete().eq("id", assetId);
    console.error("createSignedUploadUrl failed", signError);
    return NextResponse.json({ error: "Could not start the upload." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, asset, path: storagePath, token });
}
