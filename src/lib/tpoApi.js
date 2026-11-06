import { DEFAULT_TPOS } from './tpo.js';
import { defaultsReady } from './optionsApi.js';
import { supabase } from './supabase.js';

const COLUMNS = 'id, name, emoji, prefer, avoid, hint';

/**
 * 내 TPO 목록.
 * 기본 항목 시드(ensure_defaults)가 아직 안 됐으면 기본값을 읽기 전용(fromFallback)으로 돌려준다.
 */
export async function fetchTpos() {
  if (!defaultsReady()) return { tpos: DEFAULT_TPOS.map((t) => ({ ...t })), fromFallback: true };
  const { data, error } = await supabase.from('tpos').select(COLUMNS).order('id', { ascending: true });
  if (error) throw error;
  return { tpos: data ?? [], fromFallback: false };
}

const payload = ({ name, emoji, prefer, avoid, hint }) => ({ name, emoji, prefer, avoid, hint });

export async function createTpo(tpo) {
  const { error } = await supabase.from('tpos').insert(payload(tpo));
  if (error) {
    if (error.code === '23505') throw new Error('이미 있는 TPO 이름이에요.');
    throw error;
  }
}

/** 이름을 바꾸면 지난 착장 기록의 TPO 이름도 함께 바뀐다. */
export async function updateTpo(id, tpo) {
  const { error } = await supabase.rpc('update_tpo', {
    p_id: id,
    p_name: tpo.name,
    p_emoji: tpo.emoji,
    p_prefer: tpo.prefer,
    p_avoid: tpo.avoid,
    p_hint: tpo.hint,
  });
  if (error) {
    if (error.code === '23505') throw new Error('이미 있는 TPO 이름이에요.');
    throw error;
  }
}

export async function deleteTpo(id) {
  const { error } = await supabase.from('tpos').delete().eq('id', id);
  if (error) throw error;
}
