import { MAX_HALF, ratingText, starFill } from './lib/rating.js';

const star = (half, i) => `
  <span class="star">
    <span class="star-glyph star-bg">★</span>
    <span class="star-fill" style="width:${starFill(half, i)}%"><span class="star-glyph">★</span></span>`;

/**
 * 별점 입력 (별 5개, 각 별의 왼쪽 절반 = 0.5점, 오른쪽 절반 = 1점).
 * 클릭은 호출하는 쪽에서 위임 처리: [data-rate="1~10"], 지우기는 [data-rate="0"]
 * @param {number|null} half 현재 값
 */
export function ratingInputHTML(half) {
  const stars = [1, 2, 3, 4, 5]
    .map(
      (i) => `${star(half, i)}
    <button type="button" data-rate="${2 * i - 1}" class="star-hit star-hit-l" aria-label="${i - 0.5}점" aria-pressed="${half === 2 * i - 1}"></button>
    <button type="button" data-rate="${2 * i}" class="star-hit star-hit-r" aria-label="${i}점" aria-pressed="${half === 2 * i}"></button>
  </span>`,
    )
    .join('');
  return `
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div class="flex" role="group" aria-label="별점">${stars}</div>
      <span class="text-sm font-semibold text-navy-700">${half ? `${ratingText(half)}점` : '선택 안 함'}</span>
      ${half ? '<button type="button" data-rate="0" class="text-xs font-semibold text-navy-500 underline underline-offset-2">별점 지우기</button>' : ''}
    </div>`;
}

/** 읽기 전용 별 표시 (작은 크기) + 점수 */
export function starsHTML(half) {
  if (!half) return '';
  const stars = [1, 2, 3, 4, 5].map((i) => `${star(half, i)}</span>`).join('');
  return `<span class="inline-flex items-center gap-1" role="img" aria-label="별점 ${ratingText(half)}점">
    <span class="flex star-sm">${stars}</span>
    <span class="text-xs font-semibold text-navy-700">${ratingText(half)}</span>
  </span>`;
}

/**
 * 클릭 이벤트에서 새 별점을 구한다. 별점 입력이 아닌 곳을 눌렀으면 undefined.
 * 같은 값을 다시 누르면 0(지우기)이 된다. 반환값 0 이면 별점 없음.
 */
export function rateFromEvent(e, current) {
  const btn = e.target.closest('[data-rate]');
  if (!btn) return undefined;
  const value = Number(btn.dataset.rate);
  if (!Number.isInteger(value) || value < 0 || value > MAX_HALF) return undefined;
  return value === current ? 0 : value;
}
