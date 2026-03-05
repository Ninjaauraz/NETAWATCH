import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Returns a real Supabase client if env vars exist, otherwise null.
// The app falls back to local seed data when null (works without Supabase).
export const supabase =
  supabaseUrl && supabaseKey && !supabaseUrl.includes("YOUR_PROJECT")
    ? createClient(supabaseUrl, supabaseKey)
    : null;
