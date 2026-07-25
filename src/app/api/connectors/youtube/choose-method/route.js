import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function generateVerificationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `CLIP-${code}`;
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { method } = await request.json();

  if (method !== "linked" && method !== "bio_code") {
    return NextResponse.json({ error: "Invalid method" }, { status: 400 });
  }

  if (method === "bio_code") {
    const { data: connection } = await supabase
      .from("youtube_connections")
      .select("bio_code_confirmed_at")
      .eq("user_id", user.id)
      .single();

    if (connection?.bio_code_confirmed_at) {
      return NextResponse.json(
        { error: "Bio-code verification already used — connect with OAuth instead." },
        { status: 400 }
      );
    }
  }

  const update =
    method === "linked"
      ? {
          verification_method: "linked",
          payout_multiplier: 1.0,
          verification_code: null,
          verified_at: new Date().toISOString(),
        }
      : {
          verification_method: "bio_code",
          payout_multiplier: 0.75,
          verification_code: generateVerificationCode(),
          verified_at: null,
        };

  const { error } = await supabase
    .from("youtube_connections")
    .update(update)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save verification method" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
