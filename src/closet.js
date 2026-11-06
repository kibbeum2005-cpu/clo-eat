import { createIcons, Plus } from 'lucide';
import { DEFAULT_CATEGORIES, DEFAULT_TAGS } from './lib/constants.js';
import { costPerWear, formatWon, isBargain } from './lib/cost.js';
import { bulkUpdateClothes, deleteClothes, fetchClothes, fetchLastWorn, insertCloth, updateCloth } from './lib/clothesApi.js';
import {
  NO_BRAND,
  SORTS,
  brandsOf,
  filterClothes,
  pageNumbers,
  paginate,
  sortClothes,
} from './lib/closetView.js';
import { esc } from './lib/html.js';
import { prepareImage } from './lib/imageApi.js';
import { validateOptionName } from './lib/options.js';
import { addOption, deleteOption, fetchOptions, renameOption } from './lib/optionsApi.js';
import { isSupabaseConfigured } from './lib/supabase.js';

const newFilters = () => ({ category: '', tag: '', brand: '' });
// 일괄 수정 입력값. category '' / brand '' (+ clearBrand false) / tagMode 'none' 이면 그 항목은 바꾸지 않는다.
const newBulk = () => ({ category: '', brand: '', clearBrand: false, tagMode: 'none', tags: new Set() });
const TAG_MODES = {
  none: '변경 안 함',
  add: '선택한 태그 추가',
  remove: '선택한 태그 제거',
  replace: '선택한 태그로 교체 (기존 태그는 지워져요)',
};

const state = {
  clothes: [],
  lastWorn: new Map(), // 옷 id → 마지막으로 입은 날짜
  options: { categories: [...DEFAULT_CATEGORIES], tags: [...DEFAULT_TAGS] },
  selectedTags: new Set(),
  // 옷 수정 중이면 그 옷의 id
  editingId: null,
  // 사진: 'keep' 유지 / 'replace' 새 사진 / 'remove' 사진 빼기
  imageAction: 'keep',
  imageBlob: null,
  imagePreviewUrl: null,
  existingImageUrl: null,
  filters: newFilters(),
  sort: 'newest',
  page: 1,
  loading: false,
  loadError: null,
  manage: { editing: null, busy: false, message: null }, // editing: { kind, name }
  // 선택 수정 모드: 켜져 있을 때만 카드에 체크박스가 보이고 삭제/일괄 수정을 할 수 있다.
  select: { on: false, ids: new Set(), panel: false, busy: false, message: null },
  bulk: newBulk(),
};

const $ = (selector) => document.querySelector(selector);
const KIND_LABEL = { category: '카테고리', tag: '태그' };

function renderShell(root) {
  root.innerHTML = `
    <div>
      <section class="rounded-3xl bg-white/90 p-5 shadow-xl shadow-navy-900/5">
        <h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-navy-900">
          <i data-lucide="plus"></i> <span id="form-title">새 옷 등록</span>
        </h2>
        <form id="cloth-form" class="space-y-4" novalidate>
          <div>
            <span class="field-label">사진 (선택)</span>
            <div class="flex items-center gap-3">
              <div id="image-preview" class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-navy-50 text-2xl text-navy-300">👕</div>
              <div class="min-w-0 space-y-1">
                <input id="image-input" type="file" accept="image/jpeg,image/png,image/webp" class="block w-full text-sm text-navy-500 file:mr-3 file:rounded-full file:border-0 file:bg-pink-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-pink-600" />
                <button type="button" id="image-remove" class="hidden text-xs font-semibold text-navy-500 underline underline-offset-2">사진 빼기</button>
              </div>
            </div>
          </div>

          <label class="block">
            <span class="field-label">옷 이름</span>
            <input name="name" type="text" maxlength="40" placeholder="예) 베이지 오버핏 자켓" class="field" />
          </label>

          <label class="block">
            <span class="field-label">브랜드 (선택)</span>
            <input name="brand" type="text" maxlength="40" placeholder="예) 무신사 스탠다드" class="field" />
          </label>

          <label class="block">
            <span class="field-label">구매 가격 (원)</span>
            <input name="price" type="number" min="0" step="100" inputmode="numeric" placeholder="39000" class="field" />
          </label>

          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label for="category-select" class="text-sm font-semibold text-navy-700">카테고리</label>
              <button type="button" id="cat-add-toggle" class="text-xs font-semibold text-pink-600 underline underline-offset-2">+ 카테고리 추가</button>
            </div>
            <select id="category-select" name="category" class="field"></select>
            <div id="cat-add-row" class="mt-2 hidden gap-2">
              <input id="cat-add-input" type="text" maxlength="12" placeholder="예) 가방, 모자" class="field" />
              <button type="button" id="cat-add-btn" class="shrink-0 rounded-xl bg-pink-100 px-4 font-bold text-pink-600">추가</button>
            </div>
          </div>

          <fieldset>
            <div class="mb-1.5 flex items-center justify-between">
              <legend class="text-sm font-semibold text-navy-700">스타일 태그 (여러 개 선택)</legend>
              <button type="button" id="tag-add-toggle" class="text-xs font-semibold text-pink-600 underline underline-offset-2">+ 태그 추가</button>
            </div>
            <div id="tag-group" class="flex flex-wrap gap-2"></div>
            <div id="tag-add-row" class="mt-2 hidden gap-2">
              <input id="tag-add-input" type="text" maxlength="12" placeholder="예) 걸리시, 고프코어" class="field" />
              <button type="button" id="tag-add-btn" class="shrink-0 rounded-xl bg-pink-100 px-4 font-bold text-pink-600">추가</button>
            </div>
          </fieldset>

          <p id="form-message" class="min-h-5 text-sm font-medium text-pink-600" role="alert"></p>
          <div class="flex gap-2">
            <button type="submit" id="submit-btn" class="btn-primary flex-1">옷장에 넣기</button>
            <button type="button" id="cancel-edit" class="hidden shrink-0 rounded-xl border border-navy-200 px-4 font-bold text-navy-700">취소</button>
            <button type="button" id="delete-cloth" class="hidden shrink-0 rounded-xl border border-pink-300 px-4 font-bold text-pink-600">삭제</button>
          </div>
        </form>
      </section>

      <details class="mt-4 rounded-3xl bg-white/70 p-4">
        <summary class="cursor-pointer text-sm font-bold text-navy-700">카테고리 · 태그 관리</summary>
        <div id="manage-body" class="mt-3 space-y-4"></div>
      </details>

      <section class="mt-8">
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="text-lg font-bold text-navy-900">내 옷장</h2>
          <span class="flex items-baseline gap-3">
            <span id="cloth-count" class="text-sm text-navy-500"></span>
            <button type="button" id="select-toggle" aria-pressed="false" class="text-sm font-bold text-pink-600 underline underline-offset-2">선택 수정</button>
          </span>
        </div>
        <div id="filter-bar" class="mb-3 grid grid-cols-2 gap-2"></div>
        <div id="select-bar" class="mb-3 space-y-2"></div>
        <div id="cloth-list" class="space-y-3"></div>
        <nav id="pager" class="mt-4 flex flex-wrap items-center justify-center gap-1" aria-label="페이지 이동"></nav>
      </section>
    </div>
  `;
}

function setFormMessage(text = '') {
  $('#form-message').textContent = text;
}

// ───────── 폼: 카테고리 / 태그 / 사진 / 수정 모드 ─────────

function renderCategorySelect(selected) {
  $('#category-select').innerHTML = state.options.categories
    .map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`)
    .join('');
}

function renderTagGroup() {
  $('#tag-group').innerHTML = state.options.tags.length
    ? state.options.tags
        .map(
          (t) =>
            `<button type="button" data-tag="${esc(t)}" aria-pressed="${state.selectedTags.has(t)}" class="tag-chip">${esc(t)}</button>`,
        )
        .join('')
    : '<span class="text-sm text-navy-400">태그가 없어요. "+ 태그 추가"로 만들어 보세요.</span>';
}

function renderImagePreview() {
  const url = state.imageBlob ? state.imagePreviewUrl : state.imageAction === 'keep' ? state.existingImageUrl : null;
  $('#image-preview').innerHTML = url
    ? `<img src="${esc(url)}" alt="옷 사진 미리보기" class="h-full w-full object-cover" />`
    : '👕';
  $('#image-remove').classList.toggle('hidden', !url);
}

function setNewImage(blob) {
  if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
  state.imageBlob = blob;
  state.imagePreviewUrl = blob ? URL.createObjectURL(blob) : null;
  state.imageAction = blob ? 'replace' : state.editingId ? 'remove' : 'keep';
  if (!blob) $('#image-input').value = '';
  renderImagePreview();
}

function resetForm() {
  $('#cloth-form').reset();
  state.editingId = null;
  state.existingImageUrl = null;
  state.selectedTags.clear();
  renderTagGroup();
  renderCategorySelect($('#category-select').value);
  if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
  state.imageBlob = null;
  state.imagePreviewUrl = null;
  state.imageAction = 'keep';
  $('#image-input').value = '';
  renderImagePreview();
  $('#form-title').textContent = '새 옷 등록';
  $('#submit-btn').textContent = '옷장에 넣기';
  $('#cancel-edit').classList.add('hidden');
  $('#delete-cloth').classList.add('hidden');
  setFormMessage();
}

function startEdit(id) {
  const cloth = state.clothes.find((c) => c.id === id);
  if (!cloth) return;
  resetForm();
  state.editingId = id;
  state.existingImageUrl = cloth.image_url ?? null;
  state.selectedTags = new Set(cloth.style_tags ?? []);

  const form = $('#cloth-form');
  form.elements.name.value = cloth.name;
  form.elements.brand.value = cloth.brand ?? '';
  form.elements.price.value = cloth.price;
  renderCategorySelect(cloth.category);
  renderTagGroup();
  renderImagePreview();

  $('#form-title').textContent = '옷 수정';
  $('#submit-btn').textContent = '수정 저장';
  $('#cancel-edit').classList.remove('hidden');
  $('#delete-cloth').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.name.focus({ preventScroll: true });
}

// ───────── 필터 · 정렬 · 목록 ─────────

function renderFilters() {
  const { categories, tags } = state.options;
  const brands = brandsOf(state.clothes);
  // 지워졌거나 더 이상 없는 값으로 필터가 남아 있지 않게 정리
  if (state.filters.category && !categories.includes(state.filters.category)) state.filters.category = '';
  if (state.filters.tag && !tags.includes(state.filters.tag)) state.filters.tag = '';
  if (state.filters.brand && state.filters.brand !== NO_BRAND && !brands.includes(state.filters.brand)) state.filters.brand = '';

  const count = (pred) => state.clothes.filter(pred).length;
  const select = (id, label, allLabel, options, current) => `
    <label class="block">
      <span class="sr-only">${label}</span>
      <select id="${id}" class="field !py-2 text-sm" aria-label="${label}">
        ${allLabel ? `<option value="">${allLabel}</option>` : ''}
        ${options.map(([value, text]) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(text)}</option>`).join('')}
      </select>
    </label>`;

  $('#filter-bar').innerHTML =
    select('f-category', '카테고리 필터', '카테고리 전체', categories.map((c) => [c, `${c} (${count((x) => x.category === c)})`]), state.filters.category) +
    select('f-tag', '태그 필터', '태그 전체', tags.map((t) => [t, `#${t} (${count((x) => (x.style_tags ?? []).includes(t))})`]), state.filters.tag) +
    select(
      'f-brand',
      '브랜드 필터',
      '브랜드 전체',
      [...brands.map((b) => [b, `${b} (${count((x) => x.brand === b)})`]), [NO_BRAND, `브랜드 없음 (${count((x) => !x.brand)})`]],
      state.filters.brand,
    ) +
    select('f-sort', '정렬', '', Object.entries(SORTS), state.sort);
}

function clothCardHTML(cloth) {
  const cost = costPerWear(cloth.price, cloth.wear_count);
  const costHTML =
    cost === null
      ? '<span class="text-navy-400">아직 안 입음</span>'
      : `<span class="font-bold text-navy-900">${formatWon(cost)}</span>`;
  const badge = isBargain(cost) ? '<span class="badge-success">뽕뽑기 성공 🏆</span>' : '';
  const tags = (cloth.style_tags ?? []).map((t) => `<span class="tag-pill">#${esc(t)}</span>`).join('');
  const meta = cloth.brand ? esc(cloth.brand) : '';
  const last = state.lastWorn.get(cloth.id);
  const selecting = state.select.on;
  const picked = state.select.ids.has(cloth.id);
  const photo = cloth.image_url
    ? `<img src="${esc(cloth.image_url)}" alt="${esc(cloth.name)}" loading="lazy" class="h-full w-full object-cover" />`
    : '<span class="text-2xl text-navy-300">👕</span>';

  return `
    <article data-card-id="${cloth.id}" class="rounded-2xl border bg-white p-4 shadow-md shadow-navy-900/5 ${
      picked ? 'border-pink-400 ring-2 ring-pink-300' : 'border-pink-100'
    } ${selecting ? 'cursor-pointer' : ''}">
      <div class="flex items-start gap-3">
        <div class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-navy-50">${photo}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <span class="category-pill">${esc(cloth.category)}</span>
            ${badge}
          </div>
          <h3 class="mt-1 truncate text-base font-bold text-navy-900">${esc(cloth.name)}</h3>
          ${meta ? `<p class="truncate text-xs text-navy-500">${meta}</p>` : ''}
          ${last ? `<p class="text-xs text-navy-400">마지막 착용 ${esc(last.slice(5).replace('-', '/'))}</p>` : ''}
        </div>
        ${
          selecting
            ? `<input type="checkbox" data-select-id="${cloth.id}" ${picked ? 'checked' : ''} class="mt-1 h-5 w-5 shrink-0 accent-pink-500" aria-label="${esc(cloth.name)} 선택" />`
            : `<button type="button" data-edit="${cloth.id}" class="shrink-0 text-xs font-semibold text-navy-700 underline underline-offset-2" aria-label="${esc(cloth.name)} 수정">수정</button>`
        }
      </div>

      <dl class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div class="rounded-xl bg-navy-50 p-2">
          <dt class="text-navy-500">구매가</dt>
          <dd class="mt-0.5 font-semibold text-navy-900">${formatWon(cloth.price)}</dd>
        </div>
        <div class="rounded-xl bg-navy-50 p-2">
          <dt class="text-navy-500">착용</dt>
          <dd class="mt-0.5 font-semibold text-navy-900">${Number(cloth.wear_count)}회</dd>
        </div>
        <div class="rounded-xl bg-navy-50 p-2">
          <dt class="text-navy-500">1회당</dt>
          <dd class="mt-0.5">${costHTML}</dd>
        </div>
      </dl>

      ${tags ? `<div class="mt-3 flex flex-wrap gap-1.5">${tags}</div>` : ''}
    </article>
  `;
}

function notice(text, isError = false) {
  const tone = isError ? 'text-pink-600 bg-pink-50' : 'text-navy-500 bg-white/70';
  return `<p class="rounded-2xl border border-dashed border-navy-200 px-4 py-6 text-center text-sm ${tone}">${text}</p>`;
}

function renderPager(page, totalPages) {
  const pager = $('#pager');
  if (totalPages <= 1) {
    pager.innerHTML = '';
    return;
  }
  const btn = (label, target, { current = false, disabled = false, aria } = {}) =>
    `<button type="button" data-page="${target}" ${disabled ? 'disabled' : ''} ${current ? 'aria-current="page"' : ''} ${aria ? `aria-label="${aria}"` : ''} class="pager-btn">${label}</button>`;
  pager.innerHTML =
    btn('‹', page - 1, { disabled: page === 1, aria: '이전 페이지' }) +
    pageNumbers(page, totalPages)
      .map((n) => (n === null ? '<span class="px-1 text-navy-400">…</span>' : btn(n, n, { current: n === page })))
      .join('') +
    btn('›', page + 1, { disabled: page === totalPages, aria: '다음 페이지' });
}

function renderList() {
  const list = $('#cloth-list');

  if (!isSupabaseConfigured) {
    list.innerHTML = notice('Supabase 설정이 없습니다. .env 파일에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 입력해 주세요.');
    $('#pager').innerHTML = '';
    return;
  }
  if (state.loading) {
    list.innerHTML = notice('옷장을 불러오는 중...');
    $('#pager').innerHTML = '';
    return;
  }
  if (state.loadError) {
    list.innerHTML = notice(`불러오기 실패: ${esc(state.loadError)}`, true);
    $('#pager').innerHTML = '';
    return;
  }

  const filtered = filterClothes(state.clothes, state.filters);
  const sorted = sortClothes(filtered, state.sort, state.lastWorn);
  const { items, page, totalPages } = paginate(sorted, state.page);
  state.page = page;

  const total = state.clothes.length;
  $('#cloth-count').textContent = !total ? '' : filtered.length === total ? `총 ${total}벌` : `${filtered.length}벌 / 총 ${total}벌`;

  if (!total) {
    list.innerHTML = notice('아직 등록된 옷이 없어요. 첫 번째 옷을 넣어 보세요!');
  } else if (!filtered.length) {
    list.innerHTML = notice('조건에 맞는 옷이 없어요. 필터를 바꿔 보세요.');
  } else {
    list.innerHTML = items.map(clothCardHTML).join('');
  }
  renderPager(page, totalPages);
  renderSelectBar();
}

const settle = (promise) =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );

async function loadAll() {
  if (!isSupabaseConfigured) {
    renderList();
    return;
  }
  state.loading = true;
  state.loadError = null;
  renderList();
  // 옵션 조회가 실패해도(예: SQL 미실행) 기본 카테고리/태그로 계속 사용할 수 있게 한다.
  const [optionsResult, clothesResult, lastWorn] = await Promise.all([settle(fetchOptions()), settle(fetchClothes()), fetchLastWorn()]);
  if (optionsResult.status === 'fulfilled') {
    state.options = optionsResult.value;
    // 삭제·이름 변경으로 사라진 태그가 선택 상태에 남지 않게 정리
    for (const t of [...state.selectedTags]) if (!state.options.tags.includes(t)) state.selectedTags.delete(t);
    renderCategorySelect($('#category-select')?.value);
    renderTagGroup();
  }
  state.lastWorn = lastWorn;
  if (clothesResult.status === 'fulfilled') state.clothes = clothesResult.value;
  else state.loadError = clothesResult.reason?.message ?? '알 수 없는 오류';
  state.loading = false;
  pruneSelection();
  renderManage();
  renderFilters();
  renderList();
}

// ───────── 카테고리 / 태그 관리 (기본 항목 포함 전부 수정·삭제 가능) ─────────

function usageCount(kind, name) {
  return kind === 'category'
    ? state.clothes.filter((c) => c.category === name).length
    : state.clothes.filter((c) => (c.style_tags ?? []).includes(name)).length;
}

function manageRowHTML(kind, name) {
  const editing = state.manage.editing?.kind === kind && state.manage.editing.name === name;
  const attrs = `data-kind="${kind}" data-name="${esc(name)}"`;
  if (editing) {
    return `<li class="flex gap-2">
      <input data-edit-input ${attrs} type="text" maxlength="12" value="${esc(name)}" aria-label="${KIND_LABEL[kind]} 새 이름" class="field" />
      <button type="button" data-action="save" ${attrs} class="shrink-0 rounded-xl bg-pink-100 px-3 text-sm font-bold text-pink-600">저장</button>
      <button type="button" data-action="cancel" class="shrink-0 px-1 text-sm font-semibold text-navy-500">취소</button>
    </li>`;
  }
  return `<li class="flex items-center justify-between gap-2 rounded-xl bg-navy-50 px-3 py-2 text-sm">
    <span class="min-w-0 truncate text-navy-900">${kind === 'tag' ? '#' : ''}${esc(name)} <span class="text-xs text-navy-400">${usageCount(kind, name)}벌</span></span>
    <span class="flex shrink-0 gap-3">
      <button type="button" data-action="edit" ${attrs} class="font-semibold text-navy-700">수정</button>
      <button type="button" data-action="delete" ${attrs} class="font-semibold text-pink-600">삭제</button>
    </span>
  </li>`;
}

function renderManage() {
  const body = $('#manage-body');
  if (!body) return;
  const group = (kind, names) =>
    `<div><p class="field-label">${KIND_LABEL[kind]}</p>${
      names.length
        ? `<ul class="space-y-2">${names.map((n) => manageRowHTML(kind, n)).join('')}</ul>`
        : `<p class="text-sm text-navy-400">${KIND_LABEL[kind]}가 없어요. 위 폼에서 추가해 주세요.</p>`
    }</div>`;
  const m = state.manage.message;
  body.innerHTML = `
    ${group('category', state.options.categories)}
    ${group('tag', state.options.tags)}
    <p class="text-xs text-navy-400">이름을 바꾸면 옷과 TPO에 들어 있는 같은 이름도 함께 바뀌어요. 태그를 삭제하면 모든 옷과 TPO에서 빠지고, 옷이 있는 카테고리는 삭제할 수 없어요. 카테고리 이름이 '상의'·'하의'가 아니면 핏체크에서 필수로 보지 않아요.</p>
    <p class="min-h-5 text-sm font-medium ${m?.isError ? 'text-pink-600' : 'text-emerald-600'}" role="status">${m ? esc(m.text) : ''}</p>`;
  body.querySelector('[data-edit-input]')?.focus();
}

async function runManage(task, okText) {
  if (state.manage.busy) return;
  state.manage.busy = true;
  state.manage.message = null;
  try {
    await task();
    state.manage.editing = null;
    state.manage.message = { text: okText, isError: false };
    await loadAll(); // 옷/옵션을 다시 불러와 화면을 갱신
  } catch (err) {
    state.manage.message = { text: err.message, isError: true };
  } finally {
    state.manage.busy = false;
    renderManage();
  }
}

function manageRename(kind, oldName, rawNew) {
  const pool = kind === 'category' ? state.options.categories : state.options.tags;
  const result = validateOptionName(rawNew, pool.filter((n) => n !== oldName), KIND_LABEL[kind]);
  if (!result.ok) {
    state.manage.message = { text: result.message, isError: true };
    return renderManage();
  }
  if (result.name === oldName) {
    state.manage.editing = null;
    return renderManage();
  }
  const newName = result.name;
  return runManage(async () => {
    await renameOption(kind, oldName, newName);
    // 선택·필터 중이던 값도 새 이름을 따라가게 한다
    if (kind === 'tag' && state.selectedTags.delete(oldName)) state.selectedTags.add(newName);
    if (kind === 'category' && state.filters.category === oldName) state.filters.category = newName;
    if (kind === 'tag' && state.filters.tag === oldName) state.filters.tag = newName;
  }, `${KIND_LABEL[kind]} 이름을 '${newName}'(으)로 바꿨어요.`);
}

function manageDelete(kind, name) {
  const used = usageCount(kind, name);
  const warn =
    kind === 'tag' && used
      ? `'${name}' 태그를 삭제할까요?\n붙어 있는 옷 ${used}벌에서도 빠져요.`
      : `'${name}' ${KIND_LABEL[kind]}를 삭제할까요?`;
  if (!window.confirm(warn)) return;
  return runManage(async () => {
    await deleteOption(kind, name);
    if (kind === 'tag') state.selectedTags.delete(name);
  }, `${KIND_LABEL[kind]} '${name}'을(를) 삭제했어요.`);
}

function bindManage() {
  const body = $('#manage-body');
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, kind, name } = btn.dataset;
    if (action === 'edit') {
      state.manage.editing = { kind, name };
      state.manage.message = null;
      renderManage();
    } else if (action === 'cancel') {
      state.manage.editing = null;
      renderManage();
    } else if (action === 'save') {
      manageRename(kind, name, body.querySelector('[data-edit-input]').value);
    } else if (action === 'delete') {
      manageDelete(kind, name);
    }
  });
  body.addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-edit-input]');
    if (!input) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      manageRename(input.dataset.kind, input.dataset.name, input.value);
    } else if (e.key === 'Escape') {
      state.manage.editing = null;
      renderManage();
    }
  });
}

// ───────── 선택 수정 · 삭제 · 일괄 수정 ─────────

const visibleIds = () => filterClothes(state.clothes, state.filters).map((c) => c.id);

/** 지금 보이는(필터를 통과한) 옷만 선택 상태로 남긴다 */
function pruneSelection() {
  const visible = new Set(visibleIds());
  for (const id of [...state.select.ids]) if (!visible.has(id)) state.select.ids.delete(id);
}

function toggleSelectMode() {
  state.select.on = !state.select.on;
  state.select.ids.clear();
  state.select.panel = false;
  state.select.message = null;
  state.bulk = newBulk();
  renderList();
}

function bulkFormHTML() {
  const b = state.bulk;
  const n = state.select.ids.size;
  const chips = state.options.tags.length
    ? state.options.tags
        .map((t) => `<button type="button" data-bulk-tag="${esc(t)}" aria-pressed="${b.tags.has(t)}" class="tag-chip">${esc(t)}</button>`)
        .join('')
    : '<span class="text-sm text-navy-400">태그가 없어요.</span>';
  return `
    <form id="bulk-form" class="space-y-3 rounded-2xl bg-white p-4 shadow-md shadow-navy-900/5" novalidate>
      <p class="text-sm font-bold text-navy-900">선택한 ${n}벌을 한 번에 바꾸기</p>
      <p class="text-xs text-navy-500">바꾸고 싶은 항목만 고르세요. "변경 안 함"인 항목은 그대로 둬요.</p>
      <label class="block">
        <span class="field-label">카테고리</span>
        <select data-bulk="category" class="field">
          <option value="">변경 안 함</option>
          ${state.options.categories.map((c) => `<option value="${esc(c)}" ${c === b.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </label>
      <div>
        <label class="block">
          <span class="field-label">브랜드</span>
          <input data-bulk="brand" type="text" maxlength="40" value="${esc(b.brand)}" ${b.clearBrand ? 'disabled' : ''} placeholder="변경 안 함 (입력하면 모두 이 브랜드로)" class="field" />
        </label>
        <label class="mt-1.5 flex items-center gap-2 text-sm text-navy-700">
          <input data-bulk="clearBrand" type="checkbox" ${b.clearBrand ? 'checked' : ''} class="h-4 w-4 accent-pink-500" /> 브랜드 비우기
        </label>
      </div>
      <div>
        <label class="block">
          <span class="field-label">태그</span>
          <select data-bulk="tagMode" class="field">
            ${Object.entries(TAG_MODES).map(([v, label]) => `<option value="${v}" ${v === b.tagMode ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        ${b.tagMode === 'none' ? '' : `<div class="mt-2 flex flex-wrap gap-2">${chips}</div>`}
      </div>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary flex-1" ${state.select.busy ? 'disabled' : ''}>${state.select.busy ? '적용 중...' : '적용'}</button>
        <button type="button" data-sel="cancel-bulk" class="shrink-0 rounded-xl border border-navy-200 px-4 font-bold text-navy-700">취소</button>
      </div>
    </form>`;
}

function renderSelectBar() {
  const toggle = $('#select-toggle');
  const bar = $('#select-bar');
  if (!toggle || !bar) return;
  const { on, busy, message } = state.select;
  toggle.textContent = on ? '선택 끝내기' : '선택 수정';
  toggle.setAttribute('aria-pressed', String(on));

  const msg = message
    ? `<p class="text-sm font-medium ${message.isError ? 'text-pink-600' : 'text-emerald-600'}" role="status">${esc(message.text)}</p>`
    : '';
  if (!on) {
    bar.innerHTML = msg;
    return;
  }
  const n = state.select.ids.size;
  const btn = 'rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-40';
  bar.innerHTML = `
    <div class="space-y-2 rounded-2xl bg-navy-900 p-3 text-white">
      <p class="text-sm"><b>${n}벌</b> 선택됨 <span class="opacity-70">· 카드를 눌러 고르세요</span></p>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-sel="all" class="${btn} bg-white/15" ${busy ? 'disabled' : ''}>목록 전체 선택 (${visibleIds().length})</button>
        <button type="button" data-sel="none" class="${btn} bg-white/15" ${busy || !n ? 'disabled' : ''}>선택 해제</button>
        <button type="button" data-sel="edit" class="${btn} bg-pink-200 text-navy-900" ${busy || !n ? 'disabled' : ''}>일괄 수정</button>
        <button type="button" data-sel="delete" class="${btn} bg-pink-500" ${busy || !n ? 'disabled' : ''}>삭제</button>
      </div>
    </div>
    ${state.select.panel && n ? bulkFormHTML() : ''}
    ${msg}`;
}

function setSelectMessage(text, isError = false) {
  state.select.message = text ? { text, isError } : null;
}

async function deleteSelected() {
  const ids = [...state.select.ids];
  if (!ids.length || state.select.busy) return;
  if (!window.confirm(`선택한 ${ids.length}벌을 삭제할까요?\n되돌릴 수 없고, 지난 착장 기록에서는 이 옷 정보가 보이지 않게 돼요.`)) return;
  state.select.busy = true;
  setSelectMessage();
  renderSelectBar();
  try {
    await deleteClothes(ids);
    const gone = new Set(ids);
    state.clothes = state.clothes.filter((c) => !gone.has(c.id));
    state.select.ids.clear();
    state.select.panel = false;
    if (state.editingId && gone.has(state.editingId)) resetForm();
    setSelectMessage(`${ids.length}벌을 삭제했어요.`);
  } catch (err) {
    setSelectMessage(`삭제 실패: ${err.message}`, true);
  } finally {
    state.select.busy = false;
    renderFilters();
    renderManage();
    renderList();
  }
}

function describeBulk(changes, n) {
  const parts = [];
  if (changes.category) parts.push(`카테고리 → '${changes.category}'`);
  if (changes.brand !== undefined) parts.push(changes.brand ? `브랜드 → '${changes.brand}'` : '브랜드 비우기');
  if (changes.tagMode && changes.tagMode !== 'none') {
    const list = changes.tags.map((t) => `#${t}`).join(' ') || '(없음)';
    parts.push(`태그 ${{ add: '추가', remove: '제거', replace: '교체' }[changes.tagMode]}: ${list}`);
  }
  return `선택한 ${n}벌을 이렇게 바꿀까요?\n\n${parts.join('\n')}`;
}

async function applyBulk() {
  const ids = [...state.select.ids];
  const b = state.bulk;
  if (!ids.length || state.select.busy) return;

  const changes = {};
  if (b.category) changes.category = b.category;
  if (b.clearBrand) changes.brand = '';
  else if (b.brand.trim()) changes.brand = b.brand.trim();
  if (b.tagMode !== 'none') {
    changes.tagMode = b.tagMode;
    changes.tags = [...b.tags];
    if (b.tagMode !== 'replace' && !changes.tags.length) {
      setSelectMessage('추가하거나 제거할 태그를 하나 이상 골라 주세요.', true);
      return renderSelectBar();
    }
  }
  if (changes.category === undefined && changes.brand === undefined && !changes.tagMode) {
    setSelectMessage('바꿀 항목을 하나 이상 골라 주세요.', true);
    return renderSelectBar();
  }
  if (!window.confirm(describeBulk(changes, ids.length))) return;

  state.select.busy = true;
  setSelectMessage();
  renderSelectBar();
  try {
    const count = await bulkUpdateClothes(ids, changes);
    state.select.ids.clear();
    state.select.panel = false;
    state.bulk = newBulk();
    setSelectMessage(`${count}벌을 수정했어요.`);
    await loadAll(); // 바뀐 카테고리·브랜드·태그를 목록과 필터에 반영
  } catch (err) {
    setSelectMessage(`수정 실패: ${err.message}`, true);
  } finally {
    state.select.busy = false;
    renderSelectBar();
  }
}

function toggleSelected(id) {
  if (state.select.ids.has(id)) state.select.ids.delete(id);
  else state.select.ids.add(id);
  setSelectMessage();
  renderList();
}

function bindSelect() {
  $('#select-toggle').addEventListener('click', toggleSelectMode);

  // 선택 모드에서는 카드 어디를 눌러도 선택/해제 (체크박스 클릭은 아래 change 로 한 번만 처리)
  $('#cloth-list').addEventListener('click', (e) => {
    if (!state.select.on || e.target.matches('[data-select-id]')) return;
    const card = e.target.closest('[data-card-id]');
    if (card) toggleSelected(Number(card.dataset.cardId));
  });
  $('#cloth-list').addEventListener('change', (e) => {
    const box = e.target.closest('[data-select-id]');
    if (box) toggleSelected(Number(box.dataset.selectId));
  });

  const bar = $('#select-bar');
  bar.addEventListener('click', (e) => {
    const tag = e.target.closest('[data-bulk-tag]');
    if (tag) {
      const t = tag.dataset.bulkTag;
      if (state.bulk.tags.has(t)) state.bulk.tags.delete(t);
      else state.bulk.tags.add(t);
      return renderSelectBar();
    }
    const btn = e.target.closest('[data-sel]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.sel;
    if (action === 'all') {
      visibleIds().forEach((id) => state.select.ids.add(id));
      setSelectMessage();
      renderList();
    } else if (action === 'none') {
      state.select.ids.clear();
      state.select.panel = false;
      renderList();
    } else if (action === 'edit') {
      state.select.panel = !state.select.panel;
      setSelectMessage();
      renderSelectBar();
    } else if (action === 'cancel-bulk') {
      state.select.panel = false;
      state.bulk = newBulk();
      renderSelectBar();
    } else if (action === 'delete') {
      deleteSelected();
    }
  });
  // 입력값은 즉시 state.bulk 에 반영 (다시 그려도 사라지지 않게)
  bar.addEventListener('input', (e) => {
    if (e.target.matches('[data-bulk="brand"]')) state.bulk.brand = e.target.value;
  });
  bar.addEventListener('change', (e) => {
    const field = e.target.closest('[data-bulk]')?.dataset.bulk;
    if (field === 'category') state.bulk.category = e.target.value;
    else if (field === 'tagMode') {
      state.bulk.tagMode = e.target.value;
      renderSelectBar();
    } else if (field === 'clearBrand') {
      state.bulk.clearBrand = e.target.checked;
      renderSelectBar();
    }
  });
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    applyBulk();
  });

  // 수정 폼에서 옷 한 벌 삭제
  $('#delete-cloth').addEventListener('click', async () => {
    const cloth = state.clothes.find((c) => c.id === state.editingId);
    if (!cloth) return;
    if (!window.confirm(`'${cloth.name}'을(를) 삭제할까요?\n되돌릴 수 없고, 지난 착장 기록에서는 이 옷 정보가 보이지 않게 돼요.`)) return;
    const btn = $('#delete-cloth');
    btn.disabled = true;
    try {
      await deleteClothes([cloth.id]);
      state.clothes = state.clothes.filter((c) => c.id !== cloth.id);
      state.select.ids.delete(cloth.id);
      resetForm();
      renderFilters();
      renderManage();
      renderList();
    } catch (err) {
      setFormMessage(`삭제 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
}

// ───────── 이벤트 ─────────

function bindOptionAdder({ kind, label, rowSel, toggleSel, inputSel, btnSel, getList, onAdded }) {
  const row = $(rowSel);
  const input = $(inputSel);
  const toggle = () => {
    const open = row.classList.toggle('hidden') === false;
    row.classList.toggle('flex', open);
    if (open) input.focus();
  };
  const submit = async () => {
    const result = validateOptionName(input.value, getList(), label);
    if (!result.ok) return setFormMessage(result.message);
    setFormMessage();
    const btn = $(btnSel);
    btn.disabled = true;
    try {
      await addOption(kind, result.name);
      onAdded(result.name);
      input.value = '';
      toggle();
    } catch (err) {
      setFormMessage(`${label} 추가 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  };
  $(toggleSel).addEventListener('click', toggle);
  $(btnSel).addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // 폼 전체가 제출되지 않도록
      submit();
    }
  });
}

function bindEvents() {
  const form = $('#cloth-form');
  const submitBtn = $('#submit-btn');

  // 스타일 태그 다중 선택 (aria-pressed 로 상태 관리)
  $('#tag-group').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    const tag = btn.dataset.tag;
    const selected = !state.selectedTags.has(tag);
    if (selected) state.selectedTags.add(tag);
    else state.selectedTags.delete(tag);
    btn.setAttribute('aria-pressed', String(selected));
  });

  // 필터 · 정렬 (바뀔 때마다 1페이지부터)
  $('#filter-bar').addEventListener('change', (e) => {
    const { id, value } = e.target;
    if (id === 'f-category') state.filters.category = value;
    else if (id === 'f-tag') state.filters.tag = value;
    else if (id === 'f-brand') state.filters.brand = value;
    else if (id === 'f-sort') state.sort = value;
    else return;
    state.page = 1;
    pruneSelection();
    renderList();
  });

  $('#pager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    renderList();
    $('#filter-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#cloth-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) startEdit(Number(btn.dataset.edit));
  });

  bindOptionAdder({
    kind: 'category',
    label: '카테고리',
    rowSel: '#cat-add-row',
    toggleSel: '#cat-add-toggle',
    inputSel: '#cat-add-input',
    btnSel: '#cat-add-btn',
    getList: () => state.options.categories,
    onAdded: (name) => {
      state.options.categories = [...state.options.categories, name];
      renderCategorySelect(name); // 방금 추가한 카테고리를 바로 선택
      renderManage();
      renderFilters();
    },
  });

  bindOptionAdder({
    kind: 'tag',
    label: '태그',
    rowSel: '#tag-add-row',
    toggleSel: '#tag-add-toggle',
    inputSel: '#tag-add-input',
    btnSel: '#tag-add-btn',
    getList: () => state.options.tags,
    onAdded: (name) => {
      state.options.tags = [...state.options.tags, name];
      state.selectedTags.add(name); // 방금 추가한 태그를 바로 선택
      renderTagGroup();
      renderManage();
      renderFilters();
    },
  });

  $('#image-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormMessage();
    try {
      setNewImage(await prepareImage(file));
    } catch (err) {
      e.target.value = '';
      setFormMessage(err.message);
    }
  });
  $('#image-remove').addEventListener('click', () => setNewImage(null));
  $('#cancel-edit').addEventListener('click', resetForm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormMessage();

    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const brand = String(data.get('brand') ?? '').trim();
    const priceRaw = String(data.get('price') ?? '').trim();
    const price = Number(priceRaw);
    const category = String(data.get('category') ?? '');

    if (!name) return setFormMessage('옷 이름을 입력해 주세요.');
    if (priceRaw === '' || !Number.isInteger(price) || price < 0) {
      return setFormMessage('구매 가격은 0 이상의 정수로 입력해 주세요.');
    }
    if (!state.options.categories.includes(category)) {
      return setFormMessage('카테고리를 선택해 주세요. 없으면 "+ 카테고리 추가"로 만들어 주세요.');
    }
    if (!isSupabaseConfigured) return setFormMessage('Supabase 설정(.env)을 먼저 완료해 주세요.');

    const editing = state.clothes.find((c) => c.id === state.editingId);
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중...';
    try {
      const fields = { name, price, category, brand, style_tags: [...state.selectedTags] };
      if (editing) {
        const saved = await updateCloth(editing.id, {
          ...fields,
          imageAction: state.imageAction,
          imageBlob: state.imageBlob,
          oldImagePath: editing.image_path,
        });
        state.clothes = state.clothes.map((c) => (c.id === saved.id ? saved : c));
        resetForm();
      } else {
        const saved = await insertCloth({ ...fields, imageBlob: state.imageBlob });
        state.clothes = [saved, ...state.clothes];
        resetForm();
        renderCategorySelect(category); // 연속 등록할 때 편하도록 직전 카테고리 유지
      }
      state.page = 1;
      renderManage();
      renderFilters();
      renderList();
    } catch (err) {
      setFormMessage(`저장 실패: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = state.editingId ? '수정 저장' : '옷장에 넣기';
    }
  });
}

export function initCloset(root) {
  // 다른 계정으로 바꿔 로그인했을 때 이전 사용자의 데이터가 남지 않도록 초기화
  if (state.imagePreviewUrl) URL.revokeObjectURL(state.imagePreviewUrl);
  state.clothes = [];
  state.lastWorn = new Map();
  state.options = { categories: [...DEFAULT_CATEGORIES], tags: [...DEFAULT_TAGS] };
  state.selectedTags = new Set();
  state.editingId = null;
  state.imageAction = 'keep';
  state.imageBlob = null;
  state.imagePreviewUrl = null;
  state.existingImageUrl = null;
  state.filters = newFilters();
  state.sort = 'newest';
  state.page = 1;
  state.loadError = null;
  state.manage = { editing: null, busy: false, message: null };
  state.select = { on: false, ids: new Set(), panel: false, busy: false, message: null };
  state.bulk = newBulk();

  renderShell(root);
  renderCategorySelect();
  renderTagGroup();
  renderFilters();
  createIcons({ icons: { Plus } });
  bindEvents();
  bindManage();
  bindSelect();
  renderManage();
  loadAll();
}
