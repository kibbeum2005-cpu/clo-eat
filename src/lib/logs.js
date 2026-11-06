// 착장 기록 관련 순수 로직 (날짜 계산, 중복 착장 탐지)

export const DUPLICATE_WINDOW_DAYS = 3;

/** 로컬 시간 기준 YYYY-MM-DD (toISOString 은 UTC 라 한국 새벽에 하루 어긋남) */
export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD 에서 n일 뺀 날짜 문자열 */
export function minusDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d - n));
}

/**
 * 선택한 옷 중 최근 N일(오늘 포함 N일 전까지) 안에 입었던 옷을 찾는다.
 * @param {Array<{date:string, tpo:string, clothes_ids:number[]}>} logs
 * @param {number[]} selectedIds
 * @returns {Array<{ id:number, date:string, tpo:string }>} 옷마다 가장 최근 착용 기록 1건
 */
export function findRecentDuplicates(logs, selectedIds, today, days = DUPLICATE_WINDOW_DAYS) {
  const since = minusDays(today, days);
  const latest = new Map();
  for (const log of logs) {
    if (log.date < since || log.date > today) continue;
    for (const id of log.clothes_ids ?? []) {
      if (!selectedIds.includes(id)) continue;
      const prev = latest.get(id);
      if (!prev || log.date > prev.date) latest.set(id, { id, date: log.date, tpo: log.tpo });
    }
  }
  return [...latest.values()];
}
