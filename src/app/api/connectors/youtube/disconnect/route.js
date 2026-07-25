import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error } = await supabase.from("youtube_connections").delete().eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
