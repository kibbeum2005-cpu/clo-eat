import { localDateString } from './logs.js';

const pad = (n) => String(n).padStart(2, '0');

/** month0: 0~11. 해당 월의 첫날/마지막날 (YYYY-MM-DD) */
export function monthBounds(year, month0) {
  const last = new Date(year, month0 + 1, 0).getDate();
  return { first: `${year}-${pad(month0 + 1)}-01`, last: `${year}-${pad(month0 + 1)}-${pad(last)}` };
}

/** 일요일 시작 달력 격자. 각 칸은 YYYY-MM-DD 또는 null(빈 칸) */
export function monthGrid(year, month0) {
  const startDow = new Date(year, month0, 1).getDay();
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: days }, (_, i) => `${year}-${pad(month0 + 1)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 월 이동 (month0 + delta) */
export function shiftMonth(year, month0, delta) {
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export const currentMonth = () => {
  const d = new Date();
  return { year: d.getFullYear(), month0: d.getMonth(), today: localDateString(d) };
};
