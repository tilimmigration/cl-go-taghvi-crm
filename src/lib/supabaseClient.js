// Browser-side Supabase client.
//
// Only ever uses the public URL + publishable/anon key — both are safe to
// ship in the client bundle. Access control lives entirely in Postgres
// Row Level Security policies (see supabase/migrations/), never in
// keeping this key secret. The service_role key is NEVER read here and
// must never be added to a VITE_* environment variable — it lives only
// in Supabase Edge Function secrets (see supabase/functions/monday-webhook).

import { createClient } from "@supabase/supabase-js";

// Vite injects `import.meta.env` (an object carrying every VITE_* var) into the
// browser bundle. Guard it so this module can also be imported from Node — e.g.
// the lib/*.test.js unit tests, which pull in leads.js → this file — where
// `import.meta.env` is undefined and a direct property access would throw.
const viteEnv = import.meta.env ?? {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
// Newer Supabase projects issue a "publishable" key; older ones an "anon"
// key. Both play the same role (safe for the browser), so either name is
// accepted.
const supabaseKey = viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY || viteEnv.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

if (!isSupabaseConfigured) {
  // Deliberately not thrown: the app must still start and render (e.g. so
  // the empty/not-configured state can be shown) even before Supabase
  // env vars are set.
  console.warn(
    "[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set — " +
      "Supabase-backed features will show a not-configured state. See .env.example.",
  );
}

export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseKey) : null;
