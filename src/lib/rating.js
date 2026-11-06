// 별점 (0.5점 단위, 최대 5점). DB 에는 "반 개 단위 개수"(1~10)로 저장한다. 1 = 0.5점, 10 = 5점.

export const MAX_HALF = 10;

/** 3.5 처럼 보여줄 숫자 (5점이면 "5") */
export const ratingText = (half) => String(half / 2);

/** i번째 별(1~5)이 채워진 비율(%): 0 / 50 / 100 */
export const starFill = (half, i) => Math.max(0, Math.min(2, (half ?? 0) - 2 * (i - 1))) * 50;

/** 별점 모아보기 필터 (이 값 이상) */
export const RATING_FILTERS = [
  { value: 1, label: '별점 전체' },
  { value: 4, label: '2점 이상' },
  { value: 6, label: '3점 이상' },
  { value: 8, label: '4점 이상' },
  { value: 9, label: '4.5점 이상' },
  { value: 10, label: '5점만' },
];

/** 별점이 minHalf 이상인 기록만, 별점 높은 순 → 최근 날짜 순 */
export function filterRated(logs, minHalf = 1) {
  return logs
    .filter((l) => l.rating_half != null && l.rating_half >= minHalf)
    .sort((a, b) => b.rating_half - a.rating_half || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
