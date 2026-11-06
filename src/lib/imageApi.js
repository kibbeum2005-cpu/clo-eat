import { supabase } from './supabase.js';

const BUCKET = 'clothes-images';
const MAX_SIDE = 900;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

/** 업로드 전에 긴 변 900px, JPEG 로 줄여 저장 용량과 로딩 시간을 아낀다. */
export async function prepareImage(file) {
  if (!ALLOWED.includes(file.type)) throw new Error('JPG, PNG, WebP 이미지만 올릴 수 있어요.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('이미지는 15MB 이하만 올릴 수 있어요.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('이미지를 읽을 수 없어요. 다른 파일을 선택해 주세요.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG 투명 배경이 검게 나오지 않도록
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('이미지를 변환하지 못했어요.');
  return blob;
}

/** 업로드 후 저장 경로(userId/uuid.jpg)를 반환 */
export async function uploadImage(blob) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('로그인이 필요합니다.');
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

/** 여러 파일을 한 번에 삭제 (경로가 없으면 아무것도 안 함) */
export async function removeImages(paths) {
  const list = paths.filter(Boolean);
  if (list.length) await supabase.storage.from(BUCKET).remove(list);
}

export async function removeImage(path) {
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

/** 각 옷에 1시간짜리 임시 주소(image_url)를 붙인다. 실패해도 목록은 그대로 보여준다. */
export async function attachImageUrls(clothes) {
  const paths = [...new Set(clothes.map((c) => c.image_path).filter(Boolean))];
  if (!paths.length) return clothes.map((c) => ({ ...c, image_url: null }));
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const urls = new Map((!error && data ? data : []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return clothes.map((c) => ({ ...c, image_url: urls.get(c.image_path) ?? null }));
}

/**
 * 임의의 객체 배열에 임시 주소를 붙인다. 예: attachSignedUrls(logs, 'photo_path', 'photo_url')
 * 실패해도 목록은 그대로 돌려준다 (이미지만 안 보임).
 */
export async function attachSignedUrls(items, pathKey, urlKey) {
  const paths = [...new Set(items.map((i) => i[pathKey]).filter(Boolean))];
  if (!paths.length) return items.map((i) => ({ ...i, [urlKey]: null }));
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const urls = new Map((!error && data ? data : []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return items.map((i) => ({ ...i, [urlKey]: urls.get(i[pathKey]) ?? null }));
}
