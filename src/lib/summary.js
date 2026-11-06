import { isBargain, costPerWear } from './cost.js';
import { monthBounds } from './calendar.js';

/**
 * 해당 월(1월, 2월 …)의 총평 한 줄. 순수 JS 규칙 기반이며 외부 API 는 쓰지 않는다.
 * 아직 오지 않은 날의 "예정" 착장은 입은 기록으로 세지 않는다.
 * @param {Array<{date:string, tpo:string, clothes_ids:number[], planned?:boolean}>} logs
 * @param {Array<{id:number, name:string, price:number, wear_count:number}>} clothes
 * @param {number} year
 * @param {number} month0 0~11
 */
export function summarizeMonth(logs, clothes, year, month0) {
  const label = `${month0 + 1}월`;
  const { first, last } = monthBounds(year, month0);
  const inMonth = logs.filter((l) => l.date >= first && l.date <= last);
  const worn = inMonth.filter((l) => !l.planned);
  const planned = inMonth.filter((l) => l.planned);

  if (!worn.length) {
    return {
      recordedDays: 0,
      line: planned.length
        ? `${label}은 아직 ${planned.length}일의 착장이 예정되어 있어요. 기대되네요 🗓️`
        : `${label}엔 아직 기록이 없어요. 착장을 기록하면서 시작해 볼까요? ✨`,
    };
  }

  const wearById = new Map();
  const tpoCount = new Map();
  for (const log of worn) {
    tpoCount.set(log.tpo, (tpoCount.get(log.tpo) ?? 0) + 1);
    for (const id of new Set(log.clothes_ids ?? [])) wearById.set(id, (wearById.get(id) ?? 0) + 1);
  }

  const byId = new Map(clothes.map((c) => [c.id, c]));
  const topEntry = [...wearById.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const topTpo = [...tpoCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0];

  // 이 달에 입은 옷 중, 지금 기준으로 본전(1회당 2,000원 이하)을 뽑은 옷
  const bargainCount = [...wearById.keys()]
    .map((id) => byId.get(id))
    .filter((c) => c && isBargain(costPerWear(c.price, c.wear_count))).length;

  const recordedDays = new Set(worn.map((l) => l.date)).size;
  const parts = [`${recordedDays}일 기록`];
  if (topEntry) parts.push(`가장 아껴 입은 옷은 '${byId.get(topEntry[0]).name}'(${topEntry[1]}회)`);
  if (topTpo) parts.push(`제일 자주 나간 자리는 ${topTpo[0]}`);
  if (bargainCount) parts.push(`본전 뽑은 옷 ${bargainCount}벌 🏆`);
  if (planned.length) parts.push(`예정된 착장 ${planned.length}일`);

  return { recordedDays, line: `${label} ${parts.join(', ')}.` };
}
