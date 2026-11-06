import { DEFAULT_CATEGORIES, DEFAULT_TAGS } from './lib/constants.js';
import { fetchClothes } from './lib/clothesApi.js';
import { esc } from './lib/html.js';
import { allCategories, pickerHTML } from './pickerView.js';
import { fetchOptions } from './lib/optionsApi.js';
import { confirmOutfit, fetchLogsSince } from './lib/logsApi.js';
import { DUPLICATE_WINDOW_DAYS, findRecentDuplicates, localDateString, minusDays } from './lib/logs.js';
import { isSupabaseConfigured } from './lib/supabase.js';
import { fetchTpos } from './lib/tpoApi.js';
import { bindLogExtras, logExtrasHTML } from './logExtras.js';
import { createPhotoDraft, disposePhoto } from './photoField.js';
import { DEFAULT_TPOS, essentialCategories, fitCheck } from './lib/tpo.js';
import { mountTpoManager } from './tpoManager.js';

// 탭을 오가도 선택이 유지되도록 모듈 단위로 보관한다.
const state = {
  clothes: [],
  tpos: [], // 내 TPO 목록 (추가·수정·삭제 가능)
  tpoFallback: false, // DB 에서 못 불러와 기본값을 보여주는 중
  tpoName: null, // 선택한 TPO 이름
  categories: [...DEFAULT_CATEGORIES], // 내 카테고리
  tags: [...DEFAULT_TAGS], // 내 태그 (TPO 설정에서 고를 수 있는 목록)
  activeCategory: null, // 지금 목록을 보고 있는 카테고리
  selected: {}, // { 카테고리: cloth id }
  logs: [], // 최근 착장 기록
  error: null,
  saving: false,
  rating: null, // 오늘 별점 (반 개 단위 1~10, 선택)
  photo: createPhotoDraft(), // 오늘 착장 사진 (선택)
  onReceipt: null,
  message: null, // { text, isError }
};

let panel = null;
let tpoManager = null;

const currentTpo = () => state.tpos.find((t) => t.name === state.tpoName);

const selectedItems = () =>
  Object.values(state.selected)
    .map((id) => state.clothes.find((c) => c.id === id))
    .filter(Boolean);

function notice(text, isError = false) {
  const tone = isError ? 'text-pink-600 bg-pink-50' : 'text-navy-500 bg-white/70';
  return `<p class="rounded-2xl border border-dashed border-navy-200 px-4 py-4 text-center text-sm ${tone}">${text}</p>`;
}

function pickerView() {
  const categories = allCategories(state.categories, state.clothes);
  if (!categories.includes(state.activeCategory)) state.activeCategory = categories[0];
  return pickerHTML({
    clothes: state.clothes,
    categories,
    active: state.activeCategory,
    selected: state.selected,
    required: new Set(essentialCategories(categories)),
  });
}

const today = () => localDateString();
const shortDate = (d) => d.slice(5).replace('-', '/');

function duplicates() {
  const ids = selectedItems().map((c) => c.id);
  return findRecentDuplicates(state.logs, ids, today()).map((d) => ({
    ...d,
    name: state.clothes.find((c) => c.id === d.id)?.name ?? '이름 없는 옷',
  }));
}

function duplicateListHTML(dups) {
  return dups
    .map((d) => `<li>• ${esc(d.name)} <span class="opacity-70">(${shortDate(d.date)} · ${esc(d.tpo)})</span></li>`)
    .join('');
}

function confirmAreaHTML() {
  const items = selectedItems();
  if (!items.length) {
    // 확정 직후처럼 선택이 비어 있어도 결과 메시지는 보여준다.
    return state.message
      ? `<p class="mt-3 text-sm font-medium ${state.message.isError ? 'text-pink-600' : 'text-emerald-600'}" role="status">${esc(state.message.text)}</p>${
          state.message.isError || !state.onReceipt
            ? ''
            : '<button type="button" id="receipt-btn" class="btn-primary mt-3 w-full">🧾 영수증 보러 가기</button>'
        }`
      : '';
  }
  const done = state.logs.some((l) => l.date === today());
  const dups = duplicates();
  const warn = dups.length
    ? `<div class="rounded-2xl border border-pink-300 bg-pink-50 p-3 text-sm text-pink-600" role="alert">
        <p class="font-bold">🚨 짱구 옷장 경고!</p>
        <p class="mt-0.5">최근 ${DUPLICATE_WINDOW_DAYS}일 내에 입었던 옷이 있어요.</p>
        <ul class="mt-1.5 space-y-0.5 text-xs">${duplicateListHTML(dups)}</ul>
      </div>`
    : '';
  const msg = state.message
    ? `<p class="text-sm font-medium ${state.message.isError ? 'text-pink-600' : 'text-emerald-600'}" role="status">${esc(state.message.text)}</p>`
    : '';
  return `
    <div class="mt-4 space-y-3">
      ${warn}
      ${done ? '<p class="text-sm text-navy-500">오늘 착장은 이미 확정했어요. 내일 또 만나요!</p>' : logExtrasHTML({ rating: state.rating, photo: state.photo })}
      <button type="button" id="confirm-btn" class="btn-primary w-full" ${done || state.saving ? 'disabled' : ''}>
        ${state.saving ? '저장 중...' : '오늘의 착장 확정'}
      </button>
      ${msg}
    </div>`;
}

function resultHTML() {
  const r = fitCheck(currentTpo(), selectedItems(), allCategories(state.categories, state.clothes));
  if (!r.ready) return notice(r.comment) + (state.message ? confirmAreaHTML() : '');

  const bar = r.score >= 70 ? 'bg-emerald-400' : r.score >= 50 ? 'bg-pink-300' : 'bg-pink-500';
  const reasons = r.reasons
    .map((x) => {
      const tone = x.delta > 0 ? 'text-emerald-600' : x.delta < 0 ? 'text-pink-600' : 'text-navy-400';
      const sign = x.delta > 0 ? `+${x.delta}` : x.delta < 0 ? `${x.delta}` : '±0';
      return `<li class="flex justify-between gap-3"><span class="text-navy-700">${esc(x.text)}</span><span class="shrink-0 font-bold ${tone}">${sign}점</span></li>`;
    })
    .join('');

  return `
    <div class="rounded-2xl bg-navy-900 p-4 text-white">
      <p class="text-sm text-pink-200">${esc(state.tpoName)} 핏체크</p>
      <p class="mt-1 flex items-baseline gap-2"><span class="text-4xl font-extrabold">${r.score}</span><span class="text-sm">/ 100점</span><span class="ml-auto font-bold">${esc(r.grade)}</span></p>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/20"><div class="h-full rounded-full ${bar}" style="width:${r.score}%"></div></div>
      <p class="mt-3 text-sm">${esc(r.comment)}</p>
    </div>
    <ul class="mt-3 space-y-1.5 text-xs">${reasons}</ul>
    ${confirmAreaHTML()}`;
}

function render() {
  const tpoInfo = currentTpo();
  const body = !isSupabaseConfigured
    ? notice('Supabase 설정(.env)을 먼저 완료해 주세요.')
    : state.error
      ? notice(`불러오기 실패: ${esc(state.error)}`, true)
      : `
        <label class="block">
          <span class="field-label">오늘의 TPO</span>
          <select id="tpo-select" class="field">
            ${state.tpos.map((t) => `<option value="${esc(t.name)}" ${t.name === state.tpoName ? 'selected' : ''}>${esc(t.emoji)} ${esc(t.name)}</option>`).join('')}
          </select>
        </label>
        ${
          tpoInfo
            ? `<p class="text-xs text-navy-500">추천 스타일: ${tpoInfo.prefer.length ? tpoInfo.prefer.map((t) => `#${esc(t)}`).join(' ') : '없음'}</p>`
            : notice("TPO가 없어요. 아래 'TPO 관리'에서 추가해 주세요.")
        }
        <div id="pick-area" class="space-y-3">${pickerView()}</div>
        <div id="fit-result">${resultHTML()}</div>`;

  panel.innerHTML = `
    <section class="space-y-4 rounded-3xl bg-white/90 p-5 shadow-xl shadow-navy-900/5">
      <h2 class="text-lg font-bold text-navy-900">오늘 뭐 입지?</h2>
      ${body}
    </section>`;

  panel.querySelector('#tpo-select')?.addEventListener('change', (e) => {
    state.tpoName = e.target.value;
    render();
  });

  panel.querySelector('#confirm-btn')?.addEventListener('click', onConfirm);
  bindLogExtras(panel, {
    getRating: () => state.rating,
    setRating: (half) => (state.rating = half),
    photo: state.photo,
    rerender: render,
    onError: (text) => {
      state.message = { text, isError: true };
      render();
    },
  });
  panel.querySelector('#receipt-btn')?.addEventListener('click', () => state.onReceipt?.());

  panel.querySelector('#pick-area')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cat-tab]');
    if (tab) {
      state.activeCategory = tab.dataset.catTab;
      render();
      return;
    }
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const category = btn.dataset.pick;
    const id = Number(btn.dataset.id);
    // 같은 옷을 다시 누르면 해제
    if (state.selected[category] === id) delete state.selected[category];
    else state.selected[category] = id;
    state.message = null;
    render();
  });
}

function askDuplicateModal(dups) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 px-4';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <p class="text-xl font-extrabold text-pink-600">🚨 짱구 옷장 경고!</p>
        <p class="mt-2 text-sm font-semibold text-navy-900">이 옷은 최근 ${DUPLICATE_WINDOW_DAYS}일 내에 입었던 옷입니다!</p>
        <ul class="mt-3 space-y-1 rounded-2xl bg-pink-50 p-3 text-sm text-navy-700">${duplicateListHTML(dups)}</ul>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button type="button" data-answer="no" class="rounded-xl border border-navy-200 px-4 py-3 font-bold text-navy-700">다시 고를래요</button>
          <button type="button" data-answer="yes" class="btn-primary">그래도 입을래요</button>
        </div>
      </div>`;
    const close = (answer) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (e) => e.key === 'Escape' && close(false);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
      const btn = e.target.closest('[data-answer]');
      if (btn) close(btn.dataset.answer === 'yes');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-answer="no"]').focus();
  });
}

async function onConfirm() {
  if (state.saving) return;
  const items = selectedItems();
  if (!items.length) return;

  const dups = duplicates();
  if (dups.length && !(await askDuplicateModal(dups))) return;

  state.saving = true;
  state.message = null;
  render();
  try {
    const tpo = currentTpo();
    if (!tpo) throw new Error('TPO를 먼저 선택해 주세요.');
    await confirmOutfit({
      date: today(),
      tpo: tpo.name,
      clothesIds: items.map((c) => c.id),
      ratingHalf: state.rating,
      photoBlob: state.photo.blob,
    });
    state.selected = {};
    state.rating = null;
    disposePhoto(state.photo);
    state.photo = createPhotoDraft();
    state.message = { text: '오늘의 착장을 확정했어요! 착용 횟수가 +1 되었습니다 🎉', isError: false };
    await reload();
  } catch (err) {
    state.message = { text: `저장 실패: ${err.message}`, isError: true };
  } finally {
    state.saving = false;
    if (panel?.isConnected) render();
  }
}

async function reloadTpos() {
  applyTpos(await fetchTpos().catch(() => null));
  if (panel?.isConnected) render();
}

function applyTpos(result) {
  const { tpos, fromFallback } = result ?? { tpos: DEFAULT_TPOS.map((t) => ({ ...t })), fromFallback: true };
  state.tpos = tpos;
  state.tpoFallback = fromFallback;
  // 선택해 둔 TPO 가 삭제되었거나 이름이 바뀌었으면 첫 번째로
  if (!tpos.some((t) => t.name === state.tpoName)) state.tpoName = tpos[0]?.name ?? null;
}

async function reload() {
  const [clothes, logs, options, tpoResult] = await Promise.all([
    fetchClothes(),
    fetchLogsSince(minusDays(today(), DUPLICATE_WINDOW_DAYS)),
    fetchOptions().catch(() => null), // 실패해도 기본 카테고리로 계속 사용
    fetchTpos().catch(() => null), // 실패해도 기본 TPO 로 계속 사용
  ]);
  if (options) {
    state.categories = options.categories;
    state.tags = options.tags;
  }
  applyTpos(tpoResult);
  state.clothes = clothes;
  state.logs = logs;
  state.error = null;
}

export async function showToday(root, { onReceipt } = {}) {
  // 메인 영역은 자주 다시 그려지므로, TPO 관리(입력 중인 폼 포함)는 별도 영역에 둔다.
  root.innerHTML = '<div id="today-main"></div><div id="tpo-manager" class="mt-4"></div>';
  panel = root.querySelector('#today-main');
  state.onReceipt = onReceipt ?? null;
  if (isSupabaseConfigured) {
    tpoManager = mountTpoManager(root.querySelector('#tpo-manager'), {
      getTpos: () => ({ tpos: state.tpos, fromFallback: state.tpoFallback }),
      getTags: () => state.tags,
      onChanged: reloadTpos,
    });
  }
  const mainPanel = panel;
  render();
  if (!isSupabaseConfigured) return;
  try {
    await reload();
    // 삭제되었거나 다른 계정의 옷 선택은 정리
    for (const [cat, id] of Object.entries(state.selected)) {
      if (!state.clothes.some((c) => c.id === id && c.category === cat)) delete state.selected[cat];
    }
  } catch (err) {
    state.error = err.message;
  }
  if (panel === mainPanel && mainPanel.isConnected) {
    render();
    tpoManager?.refresh();
  }
}

/** 로그아웃/계정 전환 시 선택 초기화 */
export function resetToday() {
  state.clothes = [];
  state.categories = [...DEFAULT_CATEGORIES];
  state.tags = [...DEFAULT_TAGS];
  state.tpos = [];
  state.tpoFallback = false;
  state.tpoName = null;
  state.activeCategory = null;
  state.logs = [];
  state.selected = {};
  state.rating = null;
  disposePhoto(state.photo);
  state.photo = createPhotoDraft();
  state.error = null;
  state.message = null;
}
