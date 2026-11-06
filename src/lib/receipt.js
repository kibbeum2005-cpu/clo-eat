import { costPerWear, isBargain } from './cost.js';

const CATEGORY_ORDER = ['아우터', '상의', '하의', '신발'];
// 사용자가 추가한 카테고리는 기본 카테고리 뒤에 둔다
const orderOf = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);

/** 평균 1회당 비용에 따른 칭호 (낮을수록 알뜰) */
const TITLES = [
  { max: 2000, name: '뽕뽑기 마스터', emoji: '👑', desc: '이 정도면 옷이 돈을 벌어다 주는 수준!' },
  { max: 5000, name: '알뜰 대학생', emoji: '💰', desc: '가성비 있게 잘 입고 있어요.' },
  { max: 10000, name: '성장하는 알뜰러', emoji: '🌱', desc: '조금만 더 입으면 본전이에요.' },
  { max: Infinity, name: '새 옷 모시는 중', emoji: '🛍️', desc: '아직 본전 뽑기 전이에요. 더 자주 입어 주세요!' },
];

export function titleFor(avgCost) {
  return TITLES.find((t) => avgCost <= t.max);
}

/**
 * 오늘 착장 로그 → 영수증 데이터
 * @param {{id:number, date:string, tpo:string, clothes_ids:number[]}} log
 * @param {Array<{id:number, name:string, category:string, price:number, wear_count:number}>} clothes
 */
export function buildReceipt(log, clothes) {
  const lines = (log.clothes_ids ?? [])
    .map((id) => clothes.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => {
      const cost = costPerWear(c.price, c.wear_count);
      return { id: c.id, name: c.name, category: c.category, price: c.price, wear: c.wear_count, cost, bargain: isBargain(cost) };
    })
    .sort((a, b) => orderOf(a.category) - orderOf(b.category));

  if (!lines.length) return null;

  const total = lines.reduce((sum, l) => sum + l.price, 0);
  // 착용 횟수가 1 이상인 옷만 평균에 포함 (확정 직후라면 전부 해당)
  const worn = lines.filter((l) => l.cost !== null);
  const avgCost = worn.length ? Math.round(worn.reduce((sum, l) => sum + l.cost, 0) / worn.length) : null;

  return {
    lines,
    total,
    avgCost,
    bargainCount: lines.filter((l) => l.bargain).length,
    title: avgCost === null ? null : titleFor(avgCost),
  };
}
