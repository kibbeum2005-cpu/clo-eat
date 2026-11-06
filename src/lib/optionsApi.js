import { DEFAULT_CATEGORIES, DEFAULT_TAGS } from './constants.js';
import { supabase } from './supabase.js';

// 기본 카테고리/태그/TPO 는 로그인 후 한 번 DB 에 넣어 두고(ensure_defaults), 이후에는 전부 사용자가 편집할 수 있다.
// 아직 넣어지지 않았으면(SQL 미실행 등) 예전처럼 기본값 + 사용자 추가 항목을 보여준다.
let seeded = false;

export const defaultsReady = () => seeded;

/** 로그인 직후 한 번 호출. 실패해도 앱은 기본값으로 계속 동작한다. */
export async function ensureDefaults() {
  seeded = false;
  const { error } = await supabase.rpc('ensure_defaults');
  if (error) throw error;
  seeded = true;
}

export function resetOptionsState() {
  seeded = false;
}

const merge = (defaults, custom) => [...defaults, ...custom.filter((n) => !defaults.includes(n))];

/** 카테고리/태그 목록 (사용자가 삭제한 기본 항목은 나오지 않는다) */
export async function fetchOptions() {
  const { data, error } = await supabase.from('custom_options').select('kind, name').order('id', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const categories = rows.filter((r) => r.kind === 'category').map((r) => r.name);
  const tags = rows.filter((r) => r.kind === 'tag').map((r) => r.name);
  return seeded
    ? { categories, tags }
    : { categories: merge(DEFAULT_CATEGORIES, categories), tags: merge(DEFAULT_TAGS, tags) };
}

/** kind: 'category' | 'tag' */
export async function addOption(kind, name) {
  const { error } = await supabase.from('custom_options').insert({ kind, name });
  if (error) {
    if (error.code === '23505') throw new Error('이미 있는 항목이에요.');
    throw error;
  }
}

/** 이름 변경. 옷과 TPO 에 들어 있는 같은 이름도 함께 바뀐다. */
export async function renameOption(kind, oldName, newName) {
  const { error } = await supabase.rpc('rename_option', { p_kind: kind, p_old: oldName, p_new: newName });
  if (error) {
    if (error.code === '23505') throw new Error('이미 있는 이름이에요.');
    throw error;
  }
}

/** 삭제. 태그는 모든 옷과 TPO 에서 빠지고, 옷이 남아 있는 카테고리는 삭제되지 않는다. */
export async function deleteOption(kind, name) {
  const { error } = await supabase.rpc('delete_option', { p_kind: kind, p_name: name });
  if (error) throw error;
}
