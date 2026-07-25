import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS on every table. Server-only.
// Never import this from a "use client" file, and never call it
// without first checking isSuperAdmin(user) on the request.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
