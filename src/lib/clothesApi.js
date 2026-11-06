import { attachImageUrls, removeImage, removeImages, uploadImage } from './imageApi.js';
import { supabase } from './supabase.js';

const TABLE = 'clothes';
const COLUMNS = 'id, name, price, category, style_tags, wear_count, brand, image_path, created_at';

/** 옷장 목록 조회 (최신 등록순, 이미지 임시 주소 포함) */
export async function fetchClothes() {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).order('created_at', { ascending: false });
  if (error) throw error;
  return attachImageUrls(data ?? []);
}

/** 옷별 마지막으로 입은 날짜. Map<옷 id, 'YYYY-MM-DD'>. 실패하면 빈 Map (정렬만 영향받음) */
export async function fetchLastWorn() {
  const { data, error } = await supabase.rpc('clothes_last_worn');
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [Number(r.id), r.last_worn]));
}

/** 새 옷 등록 후 저장된 행을 반환. imageBlob 이 있으면 먼저 업로드한다. */
export async function insertCloth({ name, price, category, style_tags, brand, imageBlob }) {
  const image_path = imageBlob ? await uploadImage(imageBlob) : null;
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ name, price, category, style_tags, brand: brand || null, image_path, wear_count: 0 })
    .select(COLUMNS)
    .single();

  if (error) {
    await removeImage(image_path).catch(() => {}); // 등록 실패 시 남는 파일 정리
    throw error;
  }
  const [withUrl] = await attachImageUrls([data]);
  return withUrl;
}

/**
 * 옷 수정. 착용 횟수는 바꾸지 않는다.
 * imageAction: 'keep' (유지) | 'replace' (imageBlob 으로 교체) | 'remove' (사진 빼기)
 */
export async function updateCloth(id, { name, price, category, style_tags, brand, imageAction = 'keep', imageBlob, oldImagePath }) {
  let image_path = oldImagePath ?? null;
  let uploaded = null;
  if (imageAction === 'replace' && imageBlob) {
    uploaded = await uploadImage(imageBlob);
    image_path = uploaded;
  } else if (imageAction === 'remove') {
    image_path = null;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({ name, price, category, style_tags, brand: brand || null, image_path })
    .eq('id', id)
    .select(COLUMNS)
    .single();

  if (error) {
    await removeImage(uploaded).catch(() => {}); // 수정 실패 시 새로 올린 파일 정리
    throw error;
  }
  // 저장에 성공한 뒤에만 이전 사진 파일을 지운다
  if (oldImagePath && image_path !== oldImagePath) await removeImage(oldImagePath).catch(() => {});

  const [withUrl] = await attachImageUrls([data]);
  return withUrl;
}

/**
 * 옷 삭제 (한 벌/여러 벌). 지난 착장 기록은 남고, 사진 파일은 함께 지운다.
 * 사진 삭제가 실패해도 옷 삭제는 이미 끝난 상태라 오류로 보지 않는다.
 */
export async function deleteClothes(ids) {
  const { data, error } = await supabase.rpc('delete_clothes', { p_ids: ids });
  if (error) throw error;
  await removeImages(data ?? []).catch(() => {});
}

/**
 * 여러 벌 일괄 수정. 바꿀 항목만 넘긴다.
 * @param {number[]} ids
 * @param {{ category?: string, brand?: string, tagMode?: 'none'|'add'|'remove'|'replace', tags?: string[] }} changes
 *   brand: undefined 면 변경 안 함, '' 이면 브랜드 지우기, 그 외에는 그 값으로 변경
 * @returns {Promise<number>} 바뀐 옷 개수
 */
export async function bulkUpdateClothes(ids, { category, brand, tagMode = 'none', tags = [] }) {
  const { data, error } = await supabase.rpc('bulk_update_clothes', {
    p_ids: ids,
    p_category: category ?? null,
    p_set_brand: brand !== undefined,
    p_brand: brand ?? null,
    p_tag_mode: tagMode,
    p_tags: tags,
  });
  if (error) throw error;
  return data ?? 0;
}
