import { choosePhoto, photoFieldHTML, removePhoto } from './photoField.js';
import { ratingInputHTML, rateFromEvent } from './ratingView.js';

/**
 * 착장 기록의 선택 항목: 별점(0.5점 단위) + 사진.
 * @param {{ rating: number|null, photo: ReturnType<typeof import('./photoField.js').createPhotoDraft>, showRating?: boolean }} p
 *   showRating: 앞으로의 날짜(예정 착장)에는 별점을 받지 않으므로 false
 */
export function logExtrasHTML({ rating, photo, showRating = true }) {
  return `
    <div class="space-y-3 rounded-2xl bg-white p-3">
      ${showRating ? `<div><span class="field-label">별점 (선택)</span>${ratingInputHTML(rating)}</div>` : ''}
      ${photoFieldHTML(photo)}
    </div>`;
}

/**
 * logExtrasHTML 이 그려진 영역의 클릭/선택을 처리한다. (영역을 다시 그릴 때마다 호출)
 * @param {ParentNode} container
 * @param {{ getRating: () => number|null, setRating: (half: number|null) => void, photo: any, rerender: () => void, onError: (message: string) => void }} ctx
 */
export function bindLogExtras(container, { getRating, setRating, photo, rerender, onError }) {
  container.querySelectorAll('[data-rate]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const next = rateFromEvent(e, getRating());
      if (next === undefined) return;
      setRating(next === 0 ? null : next);
      rerender();
    }),
  );

  container.querySelector('[data-photo-input]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await choosePhoto(photo, file);
      rerender();
    } catch (err) {
      e.target.value = '';
      onError(err.message);
    }
  });

  container.querySelector('[data-photo-remove]')?.addEventListener('click', () => {
    removePhoto(photo);
    rerender();
  });
}
