// 별점 (0.5점 단위, 최대 5점). DB 에는 "반 개 단위 개수"(1~10)로 저장한다. 1 = 0.5점, 10 = 5점.
// 착장 기록(daily_logs)과 옷(clothes) 모두 같은 방식을 쓴다.

export const MAX_HALF = 10;

/** 3.5 처럼 보여줄 숫자 (5점이면 "5") */
export const ratingText = (half) => String(half / 2);

/** i번째 별(1~5)이 채워진 비율(%): 0 / 50 / 100 */
export const starFill = (half, i) => Math.max(0, Math.min(2, (half ?? 0) - 2 * (i - 1))) * 50;

/**
 * 별점 모아보기 필터 (달력의 착장 기록, 옷장의 옷에서 같이 사용).
 * 'all' 외에는 별점이 있는 것만 대상이다.
 */
export const RATING_FILTERS = [
  { value: 'all', label: '별점 전체', test: () => true },
  { value: '5', label: '5점만', test: (half) => half >= 10 },
  { value: '4.5', label: '4.5점 이상', test: (half) => half >= 9 },
  { value: '4', label: '4점 이상', test: (half) => half >= 8 },
  { value: '3', label: '3점 이상', test: (half) => half >= 6 },
  { value: 'le2', label: '2점 이하', test: (half) => half <= 4 },
];

/** 필터(value)에 해당하는지. half 가 비어 있으면(별점 없음) 'all' 에서만 true */
export function matchRating(value, half) {
  const filter = RATING_FILTERS.find((f) => f.value === value) ?? RATING_FILTERS[0];
  if (filter.value === 'all') return true;
  return half != null && filter.test(half);
}

/** 별점이 있는 기록만 필터에 맞게 골라, 별점 높은 순 → 최근 날짜 순으로 */
export function filterRated(logs, value = 'all') {
  return logs
    .filter((l) => l.rating_half != null && matchRating(value, l.rating_half))
    .sort((a, b) => b.rating_half - a.rating_half || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
