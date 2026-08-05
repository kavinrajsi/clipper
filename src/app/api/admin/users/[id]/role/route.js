import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ROLES = ["clipper", "brand"];

// The only way a role changes after signup.
//
// guard_profile_role refuses the write for any caller with an auth.uid(), so
// this has to go through the service-role client — which is exactly why the
// caller is verified against the normal RLS-scoped client FIRST. The admin
// client is reached only after isSuperAdmin has passed.
export async function POST(request, { params }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isSuperAdmin(user)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const { id } = await params;
  const { role } = await request.json();

  // The CHECK constraint on profiles.role is a backstop, not the validation —
  // a 400 here is a much better answer than a 500 out of Postgres.
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Role must be clipper or brand" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Note: moving someone TO brand creates a workspace via
  // tg_ensure_workspace_for_brand. Moving them back does not remove it — there
  // is no inverse trigger, and their campaigns stay where they are.
  return NextResponse.json({ ok: true });
}
