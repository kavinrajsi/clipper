import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE, getWorkspaceRole } from "@/lib/workspaces";

// Sets which workspace the user is acting in.
//
// Membership is verified here, and getActiveWorkspace() re-verifies on every
// read. The cookie is only ever a hint — setting it to a workspace you do not
// belong to gains nothing, because both sides check.
export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { workspaceId } = await request.json();

  const role = await getWorkspaceRole(supabase, user, workspaceId);
  if (!role) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true });
}
