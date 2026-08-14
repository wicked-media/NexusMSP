import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabasePublishableKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

/**
 * Browser-safe Supabase client for optional realtime subscriptions and public,
 * policy-controlled reads. Never add service-role credentials to this module.
 */
export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  : null;

export const isSupabaseConfigured = () => Boolean(supabase);
