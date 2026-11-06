import { fetchClothes } from './lib/clothesApi.js';
import { formatWon } from './lib/cost.js';
import { esc } from './lib/html.js';
import { fetchLogsSince } from './lib/logsApi.js';
import { localDateString } from './lib/logs.js';
import { buildReceipt } from './lib/receipt.js';
import { isSupabaseConfigured } from './lib/supabase.js';

function notice(text, isError = false) {
  const tone = isError ? 'text-pink-600 bg-pink-50' : 'text-navy-500 bg-white/70';
  return `<p class="rounded-2xl border border-dashed border-navy-200 px-4 py-6 text-center text-sm ${tone}">${text}</p>`;
}

const row = (left, right, cls = '') =>
  `<div class="flex items-baseline justify-between gap-3 ${cls}"><span class="min-w-0 truncate">${left}</span><span class="shrink-0 tabular-nums">${right}</span></div>`;

// 로그 id 로 만드는 장식용 바코드 (같은 id 면 항상 같은 모양)
function barcodeHTML(seed) {
  let x = (seed * 2654435761) % 4294967296 || 12345;
  const bars = Array.from({ length: 36 }, () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return `<span style="width:${1 + (x % 3)}px"></span>`;
  });
  return `<div class="receipt-barcode" aria-hidden="true">${bars.join('')}</div>`;
}

function receiptHTML(log, r) {
  const items = r.lines
    .map(
      (l) => `
      <div class="py-1.5">
        ${row(`<span class="text-navy-400">[${esc(l.category)}]</span> ${esc(l.name)}`, formatWon(l.price))}
        <div class="flex items-center justify-between pl-3 text-xs text-navy-500">
          <span>${l.wear}회 착용 · 1회당 ${l.cost === null ? '-' : formatWon(l.cost)}</span>
          ${l.bargain ? '<span class="font-bold text-emerald-600">뽕뽑기 성공 ✓</span>' : ''}
        </div>
      </div>`,
    )
    .join('');

  const badge = r.title
    ? `<div class="mt-4 rounded-2xl bg-pink-100 px-4 py-3 text-center">
         <p class="text-xs font-semibold text-pink-600">오늘의 칭호</p>
         <p class="mt-0.5 text-xl font-extrabold text-navy-900">${r.title.emoji} ${esc(r.title.name)}</p>
         <p class="mt-1 text-xs text-navy-600">${esc(r.title.desc)}</p>
       </div>`
    : '';

  return `
    <article class="receipt-paper" aria-label="옷장 파먹기 영수증">
      <div class="text-center">
        <p class="text-lg font-extrabold tracking-widest text-navy-900">옷장 파먹기 마트</p>
        <p class="text-xs text-navy-500">CLOSET EAT-UP MART</p>
      </div>
      <div class="receipt-rule"></div>
      <div class="space-y-0.5 text-xs text-navy-600">
        ${row('영수증 No.', String(log.id).padStart(6, '0'))}
        ${row('날짜', esc(log.date))}
        ${row('TPO', esc(log.tpo))}
      </div>
      <div class="receipt-rule"></div>
      <div class="text-xs font-bold text-navy-500">${row('상품명', '금액')}</div>
      <div class="divide-y divide-dashed divide-navy-100 text-sm text-navy-900">${items}</div>
      <div class="receipt-rule"></div>
      <div class="space-y-1 text-sm text-navy-900">
        ${row('착장 총 가치', formatWon(r.total), 'font-bold')}
        ${row('평균 1회당 비용', r.avgCost === null ? '-' : formatWon(r.avgCost), 'text-base font-extrabold')}
        ${row('뽕뽑기 성공', `${r.bargainCount} / ${r.lines.length}벌`)}
      </div>
      ${badge}
      <div class="receipt-rule"></div>
      <p class="text-center text-xs text-navy-500">오늘도 알뜰하게 입어주셔서 감사합니다 ♥</p>
      ${barcodeHTML(log.id)}
    </article>
    <div class="receipt-zigzag" aria-hidden="true"></div>`;
}

/** 특정 날짜의 착장 기록으로 영수증 HTML 을 만든다 (달력에서도 사용) */
export function receiptForLog(log, clothes) {
  const receipt = buildReceipt(log, clothes);
  return receipt ? receiptHTML(log, receipt) : notice('착장에 포함된 옷을 찾을 수 없어요. (삭제된 옷일 수 있어요)');
}

export async function showReceipt(root) {
  root.innerHTML = notice('영수증을 출력하는 중...');
  if (!isSupabaseConfigured) {
    root.innerHTML = notice('Supabase 설정(.env)을 먼저 완료해 주세요.');
    return;
  }
  try {
    const today = localDateString();
    const [logs, clothes] = await Promise.all([fetchLogsSince(today), fetchClothes()]);
    if (!root.isConnected) return;
    const log = logs.find((l) => l.date === today);
    if (!log) {
      root.innerHTML = notice("오늘 확정한 착장이 아직 없어요.<br />'오늘 입기' 탭에서 착장을 확정하면 영수증이 나와요!");
      return;
    }
    root.innerHTML = receiptForLog(log, clothes);
  } catch (err) {
    if (root.isConnected) root.innerHTML = notice(`불러오기 실패: ${esc(err.message)}`, true);
  }
}
