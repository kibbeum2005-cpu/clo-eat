import { MAX_OPTION_LENGTH } from './constants.js';

/**
 * 사용자가 입력한 카테고리/태그 이름을 정리하고 검증한다.
 * @returns {{ ok: true, name: string } | { ok: false, message: string }}
 */
export function validateOptionName(raw, existing, label) {
  const name = String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, message: `${label} 이름을 입력해 주세요.` };
  if (name.length > MAX_OPTION_LENGTH) return { ok: false, message: `${label} 이름은 ${MAX_OPTION_LENGTH}자 이내로 입력해 주세요.` };
  if (existing.some((e) => e.toLowerCase() === name.toLowerCase())) {
    return { ok: false, message: `이미 있는 ${label}예요.` };
  }
  return { ok: true, name };
}
