// Mint a local dev session and print it as a Cookie header, so protected pages
// can be fetched and checked:
//
//   node scripts/dev-session.mjs                 # prints the Cookie header
//   curl -s -H "Cookie: $(node scripts/dev-session.mjs --header)" \
//        http://localhost:3000/workspace/settings
//
// Why this exists: sign-in is Google-only, so there is no scriptable login, and
// `next build` does not render dynamic Server Components — which is most of this
// app. Without this, every protected page ships having never been rendered.
// That has already happened once: /workspace/settings shipped in 0aab9ac with
// build, lint and RLS coverage only.
//
// The cookie name and encoding are not hardcoded. @supabase/ssr writes them
// into the fake jar below, so this keeps working if the library changes either.
//
// LOCAL STACK ONLY. Refuses to run against anything else — see the guard.
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";

const EMAIL = "dev@local.test";
const PASSWORD = "devpassword123";

function env(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.development.local", ".env.local"]) {
    try {
      const line = readFileSync(file, "utf8")
        .split("\n")
        .reverse()
        .find((l) => l.trim().replace(/^export\s+/, "").startsWith(`${key}=`));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch {}
  }
  return undefined;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

// The whole point is a throwaway password account. Against the hosted project
// that would be a real, permanent, password-authenticated user on a
// Google-only product.
if (!url || !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is ${url ?? "unset"}.`);
  console.error("This script is for the local stack only. Start it with `supabase start`.");
  process.exit(2);
}

const jar = new Map();
const supabase = createServerClient(url, key, {
  cookies: {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
  },
});

let { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });

if (error) {
  // First run on a fresh `db reset`: create the user. The signup path is the
  // real one — handle_new_user() reads full_name and role out of the metadata,
  // and a 'brand' role then fires ensure_workspace_for_brand.
  const { error: signUpError } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { data: { full_name: "Dev Tester", role: "brand" } },
  });
  if (signUpError) {
    console.error("Could not sign up the dev user:", signUpError.message);
    process.exit(1);
  }
  ({ error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD }));
  if (error) {
    console.error("Signed up but could not sign in:", error.message);
    process.exit(1);
  }
}

const header = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");

if (process.argv.includes("--header")) {
  process.stdout.write(header);
} else {
  console.error(`Signed in as ${EMAIL} (role: brand, has a workspace).`);
  console.error("Use with:  curl -H \"Cookie: $(node scripts/dev-session.mjs --header)\" ...");
  console.log(header);
}
