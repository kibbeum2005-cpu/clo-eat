import { attachSignedUrls, removeImage, uploadImage } from './imageApi.js';
import { localDateString } from './logs.js';
import { supabase } from './supabase.js';

const COLUMNS = 'id, date, tpo, clothes_ids, memo, planned, rating_half, photo_path';

/** 각 기록에 사진 임시 주소(photo_url)를 붙인다 */
const withPhotoUrls = (logs) => attachSignedUrls(logs, 'photo_path', 'photo_url');

/** since(YYYY-MM-DD) 이후의 착장 기록 (중복 착장 확인용이라 사진 주소는 붙이지 않는다) */
export async function fetchLogsSince(since) {
  const { data, error } = await supabase
    .from('daily_logs')
    .select(COLUMNS)
    .gte('date', since)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** from ~ to (둘 다 포함) 기간의 착장 기록 (사진 주소 포함) */
export async function fetchLogsBetween(from, to) {
  const { data, error } = await supabase
    .from('daily_logs')
    .select(COLUMNS)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false });
  if (error) throw error;
  return withPhotoUrls(data ?? []);
}

/** 별점을 남긴 모든 기록 (별점 높은 순 → 최근 날짜 순, 최대 500개) */
export async function fetchRatedLogs() {
  const { data, error } = await supabase
    .from('daily_logs')
    .select(COLUMNS)
    .not('rating_half', 'is', null)
    .order('rating_half', { ascending: false })
    .order('date', { ascending: false })
    .limit(500);
  if (error) throw error;
  return withPhotoUrls(data ?? []);
}

/**
 * 착장 기록. date 기본값은 오늘.
 * 오늘/과거 날짜면 바로 착용 횟수 +1, 미래 날짜면 "예정"으로만 저장된다. (DB 함수가 처리)
 * ratingHalf: 1~10 (0.5점 단위) 또는 null, photoBlob: 줄여 둔 사진(선택)
 */
export async function confirmOutfit({ date = localDateString(), tpo, clothesIds, memo = null, ratingHalf = null, photoBlob = null }) {
  const photo_path = photoBlob ? await uploadImage(photoBlob) : null;
  const { data, error } = await supabase.rpc('confirm_outfit', {
    p_date: date,
    p_tpo: tpo,
    p_clothes_ids: clothesIds,
    p_today: localDateString(),
    p_memo: memo,
    p_rating: ratingHalf,
    p_photo_path: photo_path,
  });
  if (error) {
    await removeImage(photo_path).catch(() => {}); // 기록 실패 시 남는 사진 정리
    if (error.code === '23505') throw new Error('이 날짜에는 이미 착장 기록이 있어요.');
    throw error;
  }
  return data;
}

/**
 * 기록된 날의 메모·별점·사진 저장.
 * photoAction: 'keep' (유지) | 'replace' (photoBlob 으로 교체) | 'remove' (사진 빼기)
 */
export async function updateLogDetails(date, { memo, ratingHalf, photoAction = 'keep', photoBlob, oldPhotoPath }) {
  let photo_path = oldPhotoPath ?? null;
  let uploaded = null;
  if (photoAction === 'replace' && photoBlob) {
    uploaded = await uploadImage(photoBlob);
    photo_path = uploaded;
  } else if (photoAction === 'remove') {
    photo_path = null;
  }

  const { data, error } = await supabase.rpc('set_log_details', {
    p_date: date,
    p_memo: memo,
    p_rating: ratingHalf,
    p_photo_path: photo_path,
  });
  if (error) {
    await removeImage(uploaded).catch(() => {}); // 저장 실패 시 새로 올린 사진 정리
    throw error;
  }
  // 저장에 성공한 뒤에만 이전 사진을 지운다
  if (oldPhotoPath && photo_path !== oldPhotoPath) await removeImage(oldPhotoPath).catch(() => {});
  return data;
}

/** 해당 날짜 착장 기록 삭제 (이미 반영된 착용 횟수는 되돌리고, 사진 파일도 지운다) */
export async function deleteLog(date) {
  const { data, error } = await supabase.rpc('delete_log', { p_date: date });
  if (error) throw error;
  await removeImage(data).catch(() => {});
}

/** 날짜가 지난 예정 착장을 실제 착용으로 확정한다. 처리된 개수를 반환. */
export async function settlePlannedLogs() {
  const { data, error } = await supabase.rpc('settle_planned_logs', { p_today: localDateString() });
  if (error) throw error;
  return data ?? 0;
}
