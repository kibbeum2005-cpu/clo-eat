// TPO(Time/Place/Occasion) 기본값과 핏체크 알고리즘 (순수 JS, 외부 API 없음)
// TPO 는 사용자가 추가·수정·삭제할 수 있고 DB(tpos 테이블)에 저장된다.
// 아래 DEFAULT_TPOS 는 DB 를 아직 쓸 수 없을 때의 대체값이다. (DB 시드는 schema.sql 의 ensure_defaults)

/** @typedef {{ id?: number, name: string, emoji: string, prefer: string[], avoid: string[], hint: string }} Tpo */

/** @type {Tpo[]} */
export const DEFAULT_TPOS = [
  { name: '9시 전공수업', emoji: '📚', prefer: ['캐주얼', '미니멀', '스포티'], avoid: ['로맨틱', '포멀'], hint: '편하고 단정한 차림이 좋아요.' },
  { name: '도서관 밤샘', emoji: '🌙', prefer: ['캐주얼', '스포티', '미니멀'], avoid: ['포멀', '로맨틱', '댄디'], hint: '밤새 앉아 있어도 편한 옷이 최고예요.' },
  { name: '소개팅', emoji: '💘', prefer: ['로맨틱', '댄디', '미니멀', '포멀'], avoid: ['스포티', '스트릿'], hint: '깔끔하고 호감 가는 인상이 중요해요.' },
  { name: '과 동아리 모임', emoji: '🍻', prefer: ['캐주얼', '스트릿', '빈티지'], avoid: ['포멀'], hint: '편하면서 센스 있게!' },
  { name: '홍대 클럽', emoji: '🪩', prefer: ['스트릿', '빈티지', '로맨틱'], avoid: ['포멀', '댄디'], hint: '개성을 확실히 드러내 보세요.' },
];

// 점수 규칙
const BASE_SCORE = 50;
const PREFER_BONUS = 12; // 권장 태그를 가진 옷 1벌당 가점
const AVOID_PENALTY = 15; // 피해야 할 태그를 가진 옷 1벌당 감점
const PREFERRED_ESSENTIALS = ['상의', '하의'];

/**
 * 점수를 내기 위해 꼭 골라야 하는 카테고리.
 * 상의·하의가 (이름을 바꾸거나 지우지 않고) 있으면 그 둘, 없으면 필수 없음(옷 1벌 이상).
 */
export const essentialCategories = (categories) => PREFERRED_ESSENTIALS.filter((c) => categories.includes(c));

/**
 * @param {Tpo|undefined} tpo 선택한 TPO
 * @param {Array<{name:string, category:string, style_tags?:string[]}>} items 선택한 옷들
 * @param {string[]} categories 현재 카테고리 목록 (필수 카테고리 판단용)
 * @returns {{ ready: boolean, score: number|null, grade: string, comment: string, reasons: Array<{text:string, delta:number}> }}
 */
export function fitCheck(tpo, items, categories = PREFERRED_ESSENTIALS) {
  if (!tpo) return notReady('TPO를 먼저 선택해 주세요.');

  const essentials = essentialCategories(categories);
  const missing = essentials.filter((c) => !items.some((i) => i.category === c));
  if (missing.length) return notReady(`${missing.join('·')}를 골라야 점수를 낼 수 있어요.`);
  if (!items.length) return notReady('옷을 하나 이상 골라 주세요.');

  const reasons = [];
  let score = BASE_SCORE;

  for (const item of items) {
    const tags = item.style_tags ?? [];
    const liked = tags.filter((t) => tpo.prefer.includes(t));
    const disliked = tags.filter((t) => tpo.avoid.includes(t));

    if (liked.length) {
      score += PREFER_BONUS;
      reasons.push({ text: `${item.name}: ${tpo.name}에 어울리는 ${liked.map((t) => `#${t}`).join(' ')}`, delta: PREFER_BONUS });
    }
    if (disliked.length) {
      score -= AVOID_PENALTY;
      reasons.push({
        text: `${item.name}: ${tpo.name}인데 ${disliked.map((t) => `#${t}`).join(' ')} 스타일이에요`,
        delta: -AVOID_PENALTY,
      });
    }
    if (!liked.length && !disliked.length) {
      reasons.push({
        text: tags.length ? `${item.name}: ${tpo.name}과 크게 상관없는 스타일이에요` : `${item.name}: 스타일 태그가 없어 판단하기 어려워요`,
        delta: 0,
      });
    }
  }

  score = Math.max(0, Math.min(100, score));
  const { grade, comment } = verdict(score, tpo);
  return { ready: true, score, grade, comment, reasons };
}

function verdict(score, tpo) {
  const hint = tpo.hint ? ` ${tpo.hint}` : '';
  if (score >= 90) return { grade: '완벽해요 ✨', comment: `${tpo.name} 정석 착장! 그대로 나가셔도 됩니다.` };
  if (score >= 70) return { grade: '좋아요 👍', comment: `${tpo.name}에 잘 어울려요.${hint}` };
  if (score >= 50) return { grade: '무난해요 🙂', comment: `나쁘지 않지만 한 끗이 아쉬워요.${hint}` };
  if (score >= 30) return { grade: '아쉬워요 🤔', comment: `${tpo.name}엔 조금 안 어울려요.${hint}` };
  return { grade: '다시 골라봐요 🚨', comment: `${tpo.name}인데 이 조합은 위험해요!${hint}` };
}

function notReady(comment) {
  return { ready: false, score: null, grade: '', comment, reasons: [] };
}
