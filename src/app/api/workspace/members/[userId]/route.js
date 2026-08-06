import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceRole } from "@/lib/workspaces";

const ASSIGNABLE_ROLES = ["owner", "admin", "member", "billing"];

async function assertAdmin(supabase, user, workspaceId) {
  const role = await getWorkspaceRole(supabase, user, workspaceId);
  return role && ["owner", "admin"].includes(role) ? role : null;
}

// The last-owner invariant is also enforced by a database trigger
// (tg_protect_last_owner). These checks give a usable message; the trigger is
// what actually guarantees it.
export async function PATCH(request, { params }) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { workspaceId, role } = await request.json();

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Unknown role." }, { status: 400 });
  }

  const callerRole = await assertAdmin(supabase, user, workspaceId);
  if (!callerRole) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // No self-promotion: an admin must not be able to make themselves owner.
  if (userId === user.id) {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
  }

  // Only an owner can create another owner.
  if (role === "owner" && callerRole !== "owner") {
    return NextResponse.json({ error: "Only an owner can promote to owner." }, { status: 403 });
  }

  const { error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error) {
    if (error.message?.includes("at least one owner")) {
      return NextResponse.json(
        { error: "This workspace needs at least one owner. Promote someone else first." },
        { status: 400 }
      );
    }
    console.error("Workspace member role update failed", error);
    return NextResponse.json({ error: "Couldn't change that member's role." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  // Leaving is allowed without being an admin; removing someone else is not.
  const isSelf = userId === user.id;
  if (!isSelf) {
    const callerRole = await assertAdmin(supabase, user, workspaceId);
    if (!callerRole) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
  }

  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error) {
    if (error.message?.includes("at least one owner")) {
      return NextResponse.json(
        {
          error: isSelf
            ? "You're the only owner. Promote someone else before leaving."
            : "This workspace needs at least one owner.",
        },
        { status: 400 }
      );
    }
    console.error("Workspace member removal failed", error);
    return NextResponse.json({ error: "Couldn't remove that member." }, { status: 400 });
  }

  // Campaigns they created are untouched — they belong to the workspace, which
  // is the entire point of this model.
  return NextResponse.json({ ok: true });
}
