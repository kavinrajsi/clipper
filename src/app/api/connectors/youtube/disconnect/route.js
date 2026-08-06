import { NextResponse } from "next/server";
import { hasAppRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // /connectors is clipper-only via requireRole. The API has to agree, or a
  // brand account can drive the whole flow straight past the hidden UI.
  if (!(await hasAppRole(supabase, user, "clipper"))) {
    return NextResponse.json(
      { error: "Only creator accounts can connect a channel." },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("youtube_connections").delete().eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
