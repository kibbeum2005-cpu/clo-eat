import { BARGAIN_THRESHOLD } from './constants.js';

/**
 * 1회당 비용 = 구매가 / 착용 횟수
 * 착용 횟수가 0이면 null (아직 안 입음)
 */
export function costPerWear(price, wearCount) {
  if (!wearCount || wearCount <= 0) return null;
  return Math.round(price / wearCount);
}

/** 1회당 비용이 기준 이하이면 뽕뽑기 성공 */
export function isBargain(cost) {
  return cost !== null && cost <= BARGAIN_THRESHOLD;
}

/** 숫자를 "39,000원" 형태로 */
export function formatWon(amount) {
  return `${Number(amount).toLocaleString('ko-KR')}원`;
}
