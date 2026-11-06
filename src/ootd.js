import { DEFAULT_CATEGORIES } from './lib/constants.js';
import { currentMonth, monthBounds, monthGrid, shiftMonth } from './lib/calendar.js';
import { fetchClothes } from './lib/clothesApi.js';
import { esc } from './lib/html.js';
import { confirmOutfit, deleteLog, fetchLogsBetween, fetchRatedLogs, updateLogDetails, updateLogOutfit } from './lib/logsApi.js';
import { fetchOptions } from './lib/optionsApi.js';
import { RATING_FILTERS, filterRated } from './lib/rating.js';
import { isSupabaseConfigured } from './lib/supabase.js';
import { summarizeMonth } from './lib/summary.js';
import { DEFAULT_TPOS, essentialCategories } from './lib/tpo.js';
import { fetchTpos } from './lib/tpoApi.js';
import { bindLogExtras, logExtrasHTML } from './logExtras.js';
import { createPhotoDraft, disposePhoto } from './photoField.js';
import { allCategories, pickerHTML } from './pickerView.js';
import { receiptForLog } from './receipt.js';
import { starsHTML } from './ratingView.js';

const MEMO_MAX = 300;
const MAX_MONTHS_AHEAD = 12; // 미리 기록할 수 있는 최대 개월 수
const RATED_PAGE = 10; // 별점 모아보기에서 한 번에 보여줄 개수
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const newDraft = () => ({ tpo: '', selected: {}, activeCategory: null, memo: '', rating: null, photo: createPhotoDraft() });

const state = {
  ...(() => {
    const { year, month0, today } = currentMonth();
    return { year, month0, today };
  })(),
  selected: null, // YYYY-MM-DD
  logs: [], // 보고 있는 달의 기록
  clothes: [],
  categories: [...DEFAULT_CATEGORIES],
  tpos: DEFAULT_TPOS.map((t) => ({ ...t })), // 내 TPO 목록
  draft: newDraft(), // 기록이 없는 날에 새로 기록할 착장
  edit: null, // 이미 기록된 날의 메모·별점·사진 수정 중인 값 { logId, memo, rating, photo }
  rated: [], // 별점을 남긴 모든 기록
  ratedError: null,
  ratedMin: 'all', // 별점 모아보기 필터 (lib/rating.js 의 RATING_FILTERS 값)
  ratedShown: RATED_PAGE,
  loading: false,
  error: null,
  message: null, // { text, isError }
  busy: false, // 저장/삭제 진행 중
  receiptOpen: false, // 날짜 상세의 영수증 펼침 여부 (다시 그려도 유지)
};

let panel = null;

const logOn = (date) => state.logs.find((l) => l.date === date);
const clothesOf = (log) => (log?.clothes_ids ?? []).map((id) => state.clothes.find((c) => c.id === id)).filter(Boolean);
const thumbUrlOf = (log) => log?.photo_url ?? clothesOf(log).find((c) => c.image_url)?.image_url ?? null;
const monthsAhead = () => {
  const cur = currentMonth();
  return (state.year - cur.year) * 12 + (state.month0 - cur.month0);
};

function notice(text, isError = false) {
  const tone = isError ? 'text-pink-600 bg-pink-50' : 'text-navy-500 bg-white/70';
  return `<p class="rounded-2xl border border-dashed border-navy-200 px-4 py-4 text-center text-sm ${tone}">${text}</p>`;
}

function messageHTML() {
  return state.message
    ? `<p class="text-sm font-medium ${state.message.isError ? 'text-pink-600' : 'text-emerald-600'}" role="status">${esc(state.message.text)}</p>`
    : '';
}

function summaryHTML() {
  const s = summarizeMonth(state.logs, state.clothes, state.year, state.month0);
  return `
    <div class="rounded-2xl bg-navy-900 p-4 text-white">
      <p class="text-xs font-semibold text-pink-200">🗓️ ${state.month0 + 1}월 총평</p>
      <p class="mt-1 text-sm leading-relaxed">${esc(s.line)}</p>
    </div>`;
}

// 달력 칸의 대표 사진: 그날 올린 착장 사진 → 없으면 입은 옷 중 사진이 있는 첫 번째 옷 → 없으면 👕
function cellHTML(date) {
  if (!date) return '<div></div>';
  const day = Number(date.slice(8));
  const log = logOn(date);
  const url = thumbUrlOf(log);
  const inner = log
    ? url
      ? `<img src="${esc(url)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
      : '<span class="text-sm">👕</span>'
    : '';
  const label = log ? (log.planned ? ' 예정 착장' : ' 착장 기록 있음') : '';

  return `
    <button type="button" data-date="${date}" aria-pressed="${date === state.selected}" aria-label="${date}${label}"
      class="cal-cell ${date === state.today ? 'cal-today' : ''}">
      <span class="cal-num">${day}</span>
      <span class="cal-thumb ${log ? (log.planned ? 'cal-thumb-planned' : 'cal-thumb-on') : ''}">${inner}</span>
      ${log?.memo ? '<span class="cal-memo" aria-hidden="true">✎</span>' : ''}
    </button>`;
}

// ───────── 날짜 상세: 기록이 있으면 보기/수정/삭제, 없으면 새로 기록 ─────────

function editFor(log) {
  if (state.edit?.logId !== log.id) {
    disposePhoto(state.edit?.photo);
    state.edit = {
      logId: log.id,
      memo: log.memo ?? '',
      rating: log.rating_half ?? null,
      photo: createPhotoDraft(log.photo_url ?? null),
      outfit: null, // 착장 바꾸기를 열었을 때만 { tpo, selected, activeCategory, extra }
    };
  }
  return state.edit;
}

function existingLogHTML(log) {
  const edit = editFor(log);
  const items = clothesOf(log);
  const list = items.length
    ? items
        .map((c) => {
          const photo = c.image_url
            ? `<img src="${esc(c.image_url)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
            : '<span class="text-xl text-navy-300">👕</span>';
          return `<li class="flex items-center gap-3">
            <span class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-navy-50">${photo}</span>
            <span class="min-w-0"><span class="category-pill">${esc(c.category)}</span>
              <span class="block truncate text-sm font-semibold text-navy-900">${esc(c.name)}</span>
              ${c.brand ? `<span class="block truncate text-xs text-navy-500">${esc(c.brand)}</span>` : ''}</span>
          </li>`;
        })
        .join('')
    : '<li class="text-sm text-navy-400">삭제되었거나 불러올 수 없는 옷이에요.</li>';

  return `
    <div class="flex items-baseline justify-between">
      <h3 class="text-base font-bold text-navy-900">${esc(state.selected.replaceAll('-', '. '))}</h3>
      <span class="text-sm text-navy-500">${log.planned ? '<span class="font-bold text-pink-600">예정</span> · ' : ''}${esc(log.tpo)}</span>
    </div>
    ${log.planned ? '<p class="text-xs text-navy-500">그날이 지나면 착용 횟수에 반영돼요.</p>' : ''}
    ${
      outfitEditHTML(log) ??
      `<ul class="space-y-2">${list}</ul>
      <button type="button" id="outfit-edit-open" class="w-full rounded-xl border border-navy-200 py-2.5 text-sm font-bold text-navy-700 disabled:opacity-60" ${state.busy ? 'disabled' : ''}>착장 바꾸기 (TPO · 입은 옷)</button>`
    }
    ${
      log.planned
        ? ''
        : `<details id="receipt-details" class="rounded-2xl bg-navy-50/60 p-3" ${state.receiptOpen ? 'open' : ''}>
            <summary class="cursor-pointer text-sm font-bold text-navy-700">🧾 이 날의 영수증 보기</summary>
            <div class="mt-3">${receiptForLog(log, state.clothes)}</div>
            <p class="mt-2 text-xs text-navy-400">착용 횟수와 1회당 비용은 지금 기준이에요.</p>
          </details>`
    }
    ${logExtrasHTML({ rating: edit.rating, photo: edit.photo, showRating: !log.planned })}
    <label class="block">
      <span class="field-label">메모</span>
      <textarea id="memo-input" rows="3" maxlength="${MEMO_MAX}" placeholder="오늘 착장은 어땠나요? 칭찬 들은 일, 아쉬운 점…" class="field resize-none">${esc(edit.memo)}</textarea>
    </label>
    <div class="grid grid-cols-3 gap-2">
      <button type="button" id="details-save" class="btn-primary col-span-2" ${state.busy ? 'disabled' : ''}>${state.busy ? '저장 중...' : '저장'}</button>
      <button type="button" id="log-delete" class="rounded-xl border border-pink-300 px-3 py-3 text-sm font-bold text-pink-600 disabled:opacity-60" ${state.busy ? 'disabled' : ''}>기록 삭제</button>
    </div>`;
}

// 이미 기록한 착장의 TPO 와 입은 옷을 바꾸는 폼 (열려 있을 때만)
function outfitEditHTML(log) {
  const o = state.edit?.outfit;
  if (!o) return null;
  const categories = allCategories(state.categories, state.clothes);
  if (!categories.includes(o.activeCategory)) o.activeCategory = categories[0];
  // 지워진 TPO 로 기록된 날도 현재 값이 선택지에 남아 있도록
  const tpoOptions = state.tpos.some((t) => t.name === o.tpo) ? state.tpos : [{ name: o.tpo, emoji: '✨' }, ...state.tpos];

  return `
    <div class="space-y-3 rounded-2xl bg-white p-3">
      <p class="text-sm font-bold text-navy-900">착장 바꾸기</p>
      <p class="text-xs text-navy-500">${
        log.planned ? '예정 착장이라 착용 횟수는 그대로예요.' : '바뀐 옷만 착용 횟수가 조정돼요. (뺀 옷 -1, 새로 넣은 옷 +1)'
      }</p>
      <label class="block">
        <span class="field-label">TPO</span>
        <select id="outfit-tpo" class="field">
          ${tpoOptions.map((t) => `<option value="${esc(t.name)}" ${t.name === o.tpo ? 'selected' : ''}>${esc(t.emoji)} ${esc(t.name)}</option>`).join('')}
        </select>
      </label>
      <div id="outfit-picker" class="space-y-3">${pickerHTML({
        clothes: state.clothes,
        categories,
        active: o.activeCategory,
        selected: o.selected,
        required: new Set(essentialCategories(categories)),
      })}</div>
      ${o.extra.length ? `<p class="text-xs text-navy-400">같은 카테고리에 함께 기록돼 있던 옷 ${o.extra.length}벌은 그대로 유지돼요.</p>` : ''}
      <div class="grid grid-cols-3 gap-2">
        <button type="button" id="outfit-save" class="btn-primary col-span-2" ${state.busy ? 'disabled' : ''}>착장 저장</button>
        <button type="button" id="outfit-cancel" class="rounded-xl border border-navy-200 py-3 text-sm font-bold text-navy-700" ${state.busy ? 'disabled' : ''}>취소</button>
      </div>
    </div>`;
}

function draftFormHTML() {
  const future = state.selected > state.today;
  const categories = allCategories(state.categories, state.clothes);
  if (!categories.includes(state.draft.activeCategory)) state.draft.activeCategory = categories[0];
  if (!state.tpos.some((t) => t.name === state.draft.tpo)) state.draft.tpo = state.tpos[0]?.name ?? '';
  const hint = future
    ? '앞으로의 날짜는 <b>예정 착장</b>으로 저장돼요. 그날이 지나면 착용 횟수에 반영돼요.'
    : '저장하면 선택한 옷의 착용 횟수가 +1 돼요.';

  return `
    <h3 class="text-base font-bold text-navy-900">${esc(state.selected.replaceAll('-', '. '))} ${future ? '착장 미리 기록' : '착장 기록하기'}</h3>
    <p class="text-xs text-navy-500">${hint}</p>
    <label class="block">
      <span class="field-label">TPO</span>
      <select id="draft-tpo" class="field">
        ${state.tpos.length ? state.tpos.map((t) => `<option value="${esc(t.name)}" ${t.name === state.draft.tpo ? 'selected' : ''}>${esc(t.emoji)} ${esc(t.name)}</option>`).join('') : '<option value="">TPO가 없어요 (오늘 입기 탭에서 추가)</option>'}
      </select>
    </label>
    <div id="draft-picker" class="space-y-3">${pickerHTML({ clothes: state.clothes, categories, active: state.draft.activeCategory, selected: state.draft.selected, required: new Set(essentialCategories(categories)) })}</div>
    ${logExtrasHTML({ rating: state.draft.rating, photo: state.draft.photo, showRating: !future })}
    <label class="block">
      <span class="field-label">메모 (선택)</span>
      <textarea id="draft-memo" rows="2" maxlength="${MEMO_MAX}" placeholder="메모를 남겨 보세요" class="field resize-none">${esc(state.draft.memo)}</textarea>
    </label>
    <button type="button" id="draft-save" class="btn-primary w-full" ${state.busy ? 'disabled' : ''}>${state.busy ? '저장 중...' : future ? '예정 착장으로 저장' : '이 날 착장 기록'}</button>`;
}

function detailHTML() {
  if (!state.selected) return notice('날짜를 눌러 그날의 OOTD를 확인하거나 기록해 보세요.');
  const log = logOn(state.selected);
  return `<div class="space-y-3">${log ? existingLogHTML(log) : draftFormHTML()}${messageHTML()}</div>`;
}

// ───────── 별점 모아보기 ─────────

function ratedItemHTML(log) {
  const url = thumbUrlOf(log);
  const photo = url
    ? `<img src="${esc(url)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
    : '<span class="text-xl text-navy-300">👕</span>';
  return `<li>
    <button type="button" data-goto="${log.date}" class="flex w-full items-center gap-3 rounded-2xl bg-white p-2 text-left shadow-sm transition hover:bg-pink-50">
      <span class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-navy-50">${photo}</span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-navy-900">${esc(log.date.replaceAll('-', '. '))}</span>
          ${starsHTML(log.rating_half)}
        </span>
        <span class="block truncate text-xs text-navy-500">${esc(log.tpo)}${log.memo ? ` · ${esc(log.memo)}` : ''}</span>
      </span>
    </button>
  </li>`;
}

function ratedSectionHTML() {
  const matches = filterRated(state.rated, state.ratedMin);
  const shown = matches.slice(0, state.ratedShown);
  const body = state.ratedError
    ? notice(`불러오기 실패: ${esc(state.ratedError)}`, true)
    : !state.rated.length
      ? notice('아직 별점을 남긴 기록이 없어요. 착장을 기록할 때 별점을 남겨 보세요!')
      : !matches.length
        ? notice('조건에 맞는 기록이 없어요. 기준을 낮춰 보세요.')
        : `<ul class="space-y-2">${shown.map(ratedItemHTML).join('')}</ul>
           ${
             matches.length > shown.length
               ? `<button type="button" id="rated-more" class="mt-3 w-full rounded-xl border border-navy-200 py-2.5 text-sm font-bold text-navy-700">더 보기 (${matches.length - shown.length}개 남음)</button>`
               : ''
           }`;

  return `
    <section class="rounded-3xl bg-white/90 p-5 shadow-xl shadow-navy-900/5">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="text-base font-bold text-navy-900">⭐ 별점 모아보기</h3>
        <select id="rated-filter" class="field !w-auto !py-1.5 text-sm" aria-label="별점 기준">
          ${RATING_FILTERS.map((f) => `<option value="${f.value}" ${f.value === state.ratedMin ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </div>
      ${body}
    </section>`;
}

function render() {
  if (!panel) return;
  let body;
  if (!isSupabaseConfigured) body = notice('Supabase 설정(.env)을 먼저 완료해 주세요.');
  else if (state.error) body = notice(`불러오기 실패: ${esc(state.error)}`, true);
  else {
    const weeks = monthGrid(state.year, state.month0);
    const prefix = `${state.year}-${String(state.month0 + 1).padStart(2, '0')}`;
    const monthLogs = state.logs.filter((l) => l.date.startsWith(prefix));
    body = `
      ${state.loading ? '' : summaryHTML()}
      <section class="rounded-3xl bg-white/90 p-4 shadow-xl shadow-navy-900/5">
        <div class="mb-3 flex items-center justify-between">
          <button type="button" id="cal-prev" class="cal-nav" aria-label="이전 달">‹</button>
          <div class="text-center">
            <p class="text-lg font-bold text-navy-900">${state.year}년 ${state.month0 + 1}월</p>
            <p class="text-xs text-navy-500">${state.loading ? '불러오는 중...' : `${monthLogs.length}일 기록`}</p>
          </div>
          <button type="button" id="cal-next" class="cal-nav" aria-label="다음 달" ${monthsAhead() >= MAX_MONTHS_AHEAD ? 'disabled' : ''}>›</button>
        </div>
        <div class="mb-1 grid grid-cols-7 text-center text-xs font-semibold text-navy-400">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
        <div id="cal-grid" class="grid grid-cols-7 gap-1">${weeks.flat().map(cellHTML).join('')}</div>
        <p class="mt-3 text-center text-xs text-navy-400">점선 칸은 예정 착장이에요 · 칸의 사진은 그날 올린 착장 사진(없으면 옷 사진)이에요</p>
      </section>
      <section class="rounded-3xl bg-white/90 p-5 shadow-xl shadow-navy-900/5" id="detail">${state.loading ? notice('불러오는 중...') : detailHTML()}</section>
      ${state.loading ? '' : ratedSectionHTML()}`;
  }

  panel.innerHTML = `<div class="space-y-4">${body}</div>`;
  bind();
}

function bind() {
  const $ = (sel) => panel.querySelector(sel);

  $('#cal-prev')?.addEventListener('click', () => move(-1));
  $('#cal-next')?.addEventListener('click', () => move(1));
  $('#cal-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    state.selected = btn.dataset.date;
    state.message = null;
    resetDrafts();
    render();
  });

  // 별점 모아보기
  $('#rated-filter')?.addEventListener('change', (e) => {
    state.ratedMin = e.target.value;
    state.ratedShown = RATED_PAGE;
    render();
  });
  $('#rated-more')?.addEventListener('click', () => {
    state.ratedShown += RATED_PAGE;
    render();
  });
  panel.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => goTo(btn.dataset.goto)));

  // 별점 · 사진 (기록이 있는 날은 수정값, 없는 날은 새 기록값에 반영)
  const log = state.selected ? logOn(state.selected) : null;
  const target = log ? state.edit : state.draft;
  if (target) {
    bindLogExtras(panel, {
      getRating: () => target.rating,
      setRating: (half) => (target.rating = half),
      photo: target.photo,
      rerender: render,
      onError: (text) => {
        state.message = { text, isError: true };
        render();
      },
    });
  }

  // 착장 바꾸기 (TPO · 입은 옷)
  $('#outfit-edit-open')?.addEventListener('click', startOutfitEdit);
  $('#outfit-cancel')?.addEventListener('click', () => {
    if (state.edit) state.edit.outfit = null;
    render();
  });
  $('#outfit-save')?.addEventListener('click', saveOutfit);
  $('#outfit-tpo')?.addEventListener('change', (e) => {
    if (state.edit?.outfit) state.edit.outfit.tpo = e.target.value;
  });
  $('#outfit-picker')?.addEventListener('click', (e) => {
    const o = state.edit?.outfit;
    if (!o) return;
    const tab = e.target.closest('[data-cat-tab]');
    if (tab) {
      o.activeCategory = tab.dataset.catTab;
      return render();
    }
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const category = btn.dataset.pick;
    const id = Number(btn.dataset.id);
    if (o.selected[category] === id) delete o.selected[category];
    else o.selected[category] = id;
    state.message = null;
    render();
  });

  $('#receipt-details')?.addEventListener('toggle', (e) => (state.receiptOpen = e.target.open));

  // 기존 기록: 저장 / 삭제. 입력값은 다시 그려도 사라지지 않도록 즉시 반영
  $('#memo-input')?.addEventListener('input', (e) => {
    if (state.edit) state.edit.memo = e.target.value;
  });
  $('#details-save')?.addEventListener('click', saveDetails);
  $('#log-delete')?.addEventListener('click', removeLog);

  // 새 기록 폼
  $('#draft-memo')?.addEventListener('input', (e) => (state.draft.memo = e.target.value));
  $('#draft-tpo')?.addEventListener('change', (e) => {
    state.draft.tpo = e.target.value;
  });
  $('#draft-picker')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat-tab]');
    if (tab) {
      state.draft.activeCategory = tab.dataset.catTab;
      return render();
    }
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const category = btn.dataset.pick;
    const id = Number(btn.dataset.id);
    if (state.draft.selected[category] === id) delete state.draft.selected[category];
    else state.draft.selected[category] = id;
    state.message = null;
    render();
  });
  $('#draft-save')?.addEventListener('click', saveDraft);
}

/** 날짜를 바꿀 때 입력 중이던 값(사진 미리보기 포함)을 정리 */
function resetDrafts() {
  disposePhoto(state.draft.photo);
  disposePhoto(state.edit?.photo);
  state.draft = newDraft();
  state.edit = null;
}

async function run(task, okText) {
  if (state.busy) return;
  state.busy = true;
  state.message = null;
  render();
  try {
    await task();
    state.message = okText ? { text: okText, isError: false } : null;
    await Promise.all([load({ keepMessage: true }), loadRated()]);
  } catch (err) {
    state.message = { text: `실패: ${err.message}`, isError: true };
  } finally {
    state.busy = false;
    if (panel?.isConnected) render();
  }
}

function saveDetails() {
  const date = state.selected;
  const log = logOn(date);
  const edit = state.edit;
  if (!log || !edit) return;
  return run(async () => {
    await updateLogDetails(date, {
      memo: edit.memo,
      ratingHalf: log.planned ? null : edit.rating,
      photoAction: edit.photo.action,
      photoBlob: edit.photo.blob,
      oldPhotoPath: log.photo_path,
    });
    disposePhoto(edit.photo);
    state.edit = null; // 저장된 값으로 다시 채워지도록
  }, '저장했어요.');
}

function removeLog() {
  const date = state.selected;
  if (!window.confirm(`${date} 착장 기록을 삭제할까요?\n이미 반영된 착용 횟수는 되돌려지고, 올린 사진도 지워져요.`)) return;
  return run(async () => {
    await deleteLog(date);
    disposePhoto(state.edit?.photo);
    state.edit = null;
  }, '기록을 삭제했어요.');
}

function startOutfitEdit() {
  const log = state.selected ? logOn(state.selected) : null;
  if (!log || !state.edit) return;
  // 선택 UI 는 카테고리마다 옷 한 벌이라, 같은 카테고리에 겹쳐 기록된 옷은 extra 로 따로 보관해 그대로 유지한다.
  const selected = {};
  const extra = [];
  for (const c of clothesOf(log)) {
    if (selected[c.category] === undefined) selected[c.category] = c.id;
    else extra.push(c.id);
  }
  state.edit.outfit = { tpo: log.tpo, selected, activeCategory: null, extra };
  state.message = null;
  render();
}

function saveOutfit() {
  const date = state.selected;
  const o = state.edit?.outfit;
  if (!o) return;
  const ids = [...Object.values(o.selected), ...o.extra];
  if (!ids.length) {
    state.message = { text: '입은 옷을 하나 이상 골라 주세요.', isError: true };
    return render();
  }
  if (!o.tpo) {
    state.message = { text: 'TPO를 골라 주세요.', isError: true };
    return render();
  }
  return run(async () => {
    await updateLogOutfit(date, { tpo: o.tpo, clothesIds: ids });
    // 같은 날 메모·별점·사진을 고치던 값은 그대로 두고, 착장 폼만 닫는다
    if (state.edit) state.edit.outfit = null;
  }, '착장을 수정했어요.');
}

function saveDraft() {
  const date = state.selected;
  const ids = Object.values(state.draft.selected);
  if (!ids.length) {
    state.message = { text: '기록할 옷을 하나 이상 골라 주세요.', isError: true };
    return render();
  }
  const { tpo, memo, rating, photo } = state.draft;
  if (!tpo) {
    state.message = { text: 'TPO가 없어요. 「오늘 입기」 탭의 TPO 관리에서 먼저 추가해 주세요.', isError: true };
    return render();
  }
  const future = date > state.today;
  return run(async () => {
    await confirmOutfit({ date, tpo, clothesIds: ids, memo, ratingHalf: future ? null : rating, photoBlob: photo.blob });
    disposePhoto(photo);
    state.draft = newDraft();
  }, future ? '예정 착장으로 저장했어요 🗓️' : '착장을 기록했어요! 착용 횟수가 +1 되었습니다 🎉');
}

async function load({ keepMessage = false } = {}) {
  const { first, last } = monthBounds(state.year, state.month0);
  state.loading = true;
  state.error = null;
  if (!keepMessage) state.message = null;
  render();
  try {
    const [logs, clothes, options, tpoResult] = await Promise.all([
      fetchLogsBetween(first, last),
      fetchClothes(),
      fetchOptions().catch(() => null), // 실패해도 기본 카테고리로 계속 사용
      fetchTpos().catch(() => null), // 실패해도 기본 TPO 로 계속 사용
    ]);
    state.logs = logs;
    state.clothes = clothes;
    if (options) state.categories = options.categories;
    if (tpoResult) state.tpos = tpoResult.tpos;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    if (panel?.isConnected) render();
  }
}

async function loadRated() {
  try {
    state.rated = await fetchRatedLogs();
    state.ratedError = null;
  } catch (err) {
    state.ratedError = err.message;
  }
  if (panel?.isConnected && !state.loading) render();
}

function move(delta) {
  const next = shiftMonth(state.year, state.month0, delta);
  state.year = next.year;
  state.month0 = next.month0;
  state.selected = null;
  resetDrafts();
  load();
}

/** 별점 모아보기에서 항목을 누르면 그 날짜의 달력으로 이동 */
function goTo(date) {
  const [y, m] = date.split('-').map(Number);
  state.year = y;
  state.month0 = m - 1;
  state.selected = date;
  state.message = null;
  resetDrafts();
  load().then(() => panel?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

export function showOotd(root) {
  panel = root;
  const cur = currentMonth();
  state.today = cur.today; // 자정이 지나 탭을 다시 열었을 때를 대비
  state.selected = state.selected ?? cur.today;
  if (!isSupabaseConfigured) return render();
  load();
  loadRated();
}

/** 로그아웃/계정 전환 시 데이터 초기화 */
export function resetOotd() {
  const cur = currentMonth();
  disposePhoto(state.draft?.photo);
  disposePhoto(state.edit?.photo);
  Object.assign(state, {
    year: cur.year,
    month0: cur.month0,
    today: cur.today,
    selected: null,
    logs: [],
    clothes: [],
    categories: [...DEFAULT_CATEGORIES],
    tpos: DEFAULT_TPOS.map((t) => ({ ...t })),
    draft: newDraft(),
    edit: null,
    rated: [],
    ratedError: null,
    ratedMin: 'all',
    ratedShown: RATED_PAGE,
    error: null,
    message: null,
    busy: false,
  });
}
