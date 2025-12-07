import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URLKU;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEYKU;

export const supabase = createClient(supabaseUrl, supabaseKey);