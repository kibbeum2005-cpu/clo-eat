import { esc } from './lib/html.js';

/** 기본+추가 카테고리와 옷에 실제로 쓰인 카테고리를 합친 목록 */
export const allCategories = (categories, clothes) => [...new Set([...categories, ...clothes.map((c) => c.category)])];

export function itemButtonHTML(c, category, on) {
  const tags = (c.style_tags ?? []).map((t) => `#${esc(t)}`).join(' ');
  const meta = c.brand ? esc(c.brand) : '';
  const photo = c.image_url
    ? `<img src="${esc(c.image_url)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
    : '<span class="text-xl text-navy-300">👕</span>';
  return `<button type="button" data-pick="${esc(category)}" data-id="${c.id}" aria-pressed="${on}" class="tag-chip flex items-center gap-3 !rounded-2xl text-left">
    <span class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-navy-50">${photo}</span>
    <span class="min-w-0">
      <span class="block truncate font-semibold">${esc(c.name)}</span>
      ${meta ? `<span class="block truncate text-xs opacity-70">${meta}</span>` : ''}
      ${tags ? `<span class="block truncate text-xs opacity-70">${tags}</span>` : ''}
    </span>
  </button>`;
}

/**
 * 카테고리 탭 + 선택된 카테고리의 옷 목록 + 선택 요약
 * 클릭은 호출하는 쪽에서 위임 처리한다: [data-cat-tab] (탭), [data-pick][data-id] (옷)
 * @param {{ clothes: any[], categories: string[], active: string, selected: Record<string, number>, required?: Set<string> }} p
 *   required: 핏체크 점수를 내려면 꼭 골라야 하는 카테고리 (나머지는 '(선택)' 표시)
 */
export function pickerHTML({ clothes, categories, active, selected, required = new Set() }) {
  if (!categories.length) {
    return `<p class="rounded-2xl border border-dashed border-navy-200 px-4 py-4 text-center text-sm text-navy-400">카테고리가 없어요. '내 옷장' 탭에서 카테고리를 만들어 주세요.</p>`;
  }
  const tabs = categories
    .map((c) => {
      const picked = selected[c] ? ' ✓' : '';
      const n = clothes.filter((x) => x.category === c).length;
      return `<button type="button" data-cat-tab="${esc(c)}" aria-pressed="${c === active}" class="tag-chip">${esc(c)}${required.has(c) ? '' : ' <span class="opacity-60">(선택)</span>'} <span class="opacity-60">${n}</span>${picked}</button>`;
    })
    .join('');

  const items = clothes.filter((c) => c.category === active);
  const list = items.length
    ? `<div class="grid gap-2">${items.map((c) => itemButtonHTML(c, active, selected[active] === c.id)).join('')}</div>`
    : `<p class="rounded-2xl border border-dashed border-navy-200 px-4 py-4 text-center text-sm text-navy-400">'내 옷장' 탭에서 ${esc(active)}을(를) 먼저 등록해 주세요.</p>`;

  const picks = Object.entries(selected)
    .map(([cat, id]) => [cat, clothes.find((c) => c.id === id)])
    .filter(([, c]) => c)
    .map(([cat, c]) => `<span class="tag-pill">${esc(cat)}: ${esc(c.name)}</span>`)
    .join('');

  return `
    <div class="flex flex-wrap gap-2" role="tablist" aria-label="카테고리별 보기">${tabs}</div>
    ${list}
    <div class="flex flex-wrap items-center gap-1.5 text-xs text-navy-500"><span class="font-semibold">선택한 옷</span>${picks || '<span>아직 없어요</span>'}</div>`;
}
