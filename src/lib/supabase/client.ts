import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "../env";

// Browser-side client. Uses only the public anon key; Row Level Security in
// the database decides what each visitor may see or do.
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
