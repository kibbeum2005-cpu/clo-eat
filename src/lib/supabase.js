import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// 설정이 없으면 null 로 두고, UI 에서 안내 문구를 보여줍니다.
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;
