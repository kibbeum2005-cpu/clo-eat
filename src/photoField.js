import { esc } from './lib/html.js';
import { prepareImage } from './lib/imageApi.js';

/**
 * 사진 입력 상태 (착장 기록용).
 * action: 'keep' 그대로 / 'replace' 새 사진 / 'remove' 사진 빼기
 */
export function createPhotoDraft(existingUrl = null) {
  return { blob: null, previewUrl: null, existingUrl, action: 'keep' };
}

/** 지금 보여줄 사진 주소 (없으면 null) */
export const photoUrlOf = (d) => (d.blob ? d.previewUrl : d.action === 'keep' ? d.existingUrl : null);

/** 사진 선택 UI (파일 선택 [data-photo-input], 빼기 [data-photo-remove]) */
export function photoFieldHTML(d) {
  const url = photoUrlOf(d);
  return `
    <div>
      <span class="field-label">사진 (선택)</span>
      <div class="flex items-center gap-3">
        <div class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-navy-50 text-2xl text-navy-300">${
          url ? `<img src="${esc(url)}" alt="착장 사진 미리보기" class="h-full w-full object-cover" />` : '📷'
        }</div>
        <div class="min-w-0 space-y-1">
          <input data-photo-input type="file" accept="image/jpeg,image/png,image/webp" aria-label="착장 사진 선택" class="block w-full text-sm text-navy-500 file:mr-3 file:rounded-full file:border-0 file:bg-pink-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-pink-600" />
          ${url ? '<button type="button" data-photo-remove class="text-xs font-semibold text-navy-500 underline underline-offset-2">사진 빼기</button>' : ''}
          <p class="text-xs text-navy-400">달력의 대표 사진으로 보여요.</p>
        </div>
      </div>
    </div>`;
}

/** 파일을 줄여서 draft 에 담는다. 실패하면 오류를 던진다. */
export async function choosePhoto(d, file) {
  const blob = await prepareImage(file);
  if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
  d.blob = blob;
  d.previewUrl = URL.createObjectURL(blob);
  d.action = 'replace';
}

export function removePhoto(d) {
  if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
  d.blob = null;
  d.previewUrl = null;
  d.action = d.existingUrl ? 'remove' : 'keep';
}

/** 쓰지 않게 된 draft 의 미리보기 주소를 해제 */
export function disposePhoto(d) {
  if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
}
