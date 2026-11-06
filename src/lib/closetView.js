// 옷장 목록의 필터 · 정렬 · 페이지 나누기 (순수 JS)

export const NO_BRAND = '__none__'; // 브랜드를 입력하지 않은 옷

export const SORTS = {
  newest: '최근 등록순',
  name: '이름순',
  recent: '최근 입은 순',
  most: '많이 입은 순',
};

export const PAGE_SIZE = 10;

/** 카테고리 / 태그 / 브랜드 필터 (값이 비어 있으면 그 필터는 적용 안 함, 여러 개면 모두 만족해야 함) */
export function filterClothes(clothes, { category = '', tag = '', brand = '' } = {}) {
  return clothes.filter((c) => {
    if (category && c.category !== category) return false;
    if (tag && !(c.style_tags ?? []).includes(tag)) return false;
    if (brand === NO_BRAND && c.brand) return false;
    if (brand && brand !== NO_BRAND && c.brand !== brand) return false;
    return true;
  });
}

const byName = (a, b) => a.name.localeCompare(b.name, 'ko') || a.id - b.id;

/**
 * @param {Map<number,string>} lastWorn 옷 id → 마지막으로 입은 날짜 (YYYY-MM-DD)
 * 입은 적 없는 옷은 '최근 입은 순'에서 맨 뒤로 간다.
 */
export function sortClothes(clothes, sortKey, lastWorn = new Map()) {
  const list = [...clothes];
  const last = (c) => lastWorn.get(c.id) ?? '';
  switch (sortKey) {
    case 'name':
      return list.sort(byName);
    case 'recent':
      return list.sort((a, b) => (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : byName(a, b)));
    case 'most':
      return list.sort(
        (a, b) => b.wear_count - a.wear_count || (last(b) > last(a) ? 1 : last(b) < last(a) ? -1 : byName(a, b)),
      );
    default: // newest
      return list.sort((a, b) => (b.created_at > a.created_at ? 1 : b.created_at < a.created_at ? -1 : b.id - a.id));
  }
}

/** page 는 1부터. 범위를 벗어나면 가장 가까운 페이지로 보정한다. */
export function paginate(items, page, size = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((current - 1) * size, current * size), page: current, totalPages };
}

/** 페이지 번호 버튼에 보여줄 번호들 (현재 기준 앞뒤 2개 + 처음/끝). 건너뛴 곳은 null(…) */
export function pageNumbers(current, total) {
  const set = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2].filter((n) => n >= 1 && n <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/** 필터 선택지: 옷에 실제 쓰인 브랜드(가나다순) */
export const brandsOf = (clothes) =>
  [...new Set(clothes.map((c) => c.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
