import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { YoutubeConnectorCard } from "@/components/youtube-connector-card";

export default async function ConnectorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/connectors");
  }

  const { data: connection } = await supabase
    .from("youtube_connections")
    .select(
      "channel_title, channel_thumbnail_url, connected_at, last_synced_at, verification_method, verification_code, verified_at, payout_multiplier, bio_code_confirmed_at"
    )
    .eq("user_id", user.id)
    .single();

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Connectors</h1>
        <p className="text-sm text-muted-foreground">
          Connect external accounts to pull data into your workspace.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <YoutubeConnectorCard connection={connection} />
      </div>
    </div>
  );
}
