import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Server-side Supabase client.
 * Auto-configured using Vercel-provisioned Supabase environment variables.
 */
export const supabase: SupabaseClient | null = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        }
    })
    : null;

export function getSupabaseClient(): SupabaseClient {
    if (!supabase) {
        throw new Error(
            '[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. ' +
            'Please link your Supabase project in Vercel or configure .env.'
        );
    }
    return supabase;
}
