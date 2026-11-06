import { esc } from './lib/html.js';
import { createTpo, deleteTpo, updateTpo } from './lib/tpoApi.js';

const NAME_MAX = 20;
const HINT_MAX = 60;
const EMOJI_MAX = 4; // 이모지 글자 수 (조합형 이모지는 여러 글자로 셈)

const blankDraft = () => ({ name: '', emoji: '', hint: '', prefer: new Set(), avoid: new Set() });

/**
 * "TPO 관리" 영역: TPO 추가 · 수정 · 삭제.
 * 오늘 입기 화면이 자주 다시 그려져도 입력 중인 폼이 사라지지 않도록, 자기 컨테이너만 직접 그린다.
 *
 * @param {HTMLElement} container
 * @param {{ getTpos: () => { tpos: any[], fromFallback: boolean }, getTags: () => string[], onChanged: () => Promise<void> }} deps
 */
export function mountTpoManager(container, { getTpos, getTags, onChanged }) {
  const local = {
    editing: null, // null | 'new' | TPO id
    draft: blankDraft(),
    busy: false,
    message: null, // { text, isError }
  };

  container.innerHTML = `
    <details class="rounded-3xl bg-white/70 p-4">
      <summary class="cursor-pointer text-sm font-bold text-navy-700">TPO 관리 (추가 · 수정 · 삭제)</summary>
      <div data-body class="mt-3 space-y-4"></div>
    </details>`;
  const body = container.querySelector('[data-body]');

  const tagChips = (kind) =>
    getTags().length
      ? getTags()
          .map((t) => {
            const on = local.draft[kind].has(t);
            return `<button type="button" data-chip="${kind}" data-tag="${esc(t)}" aria-pressed="${on}" class="tag-chip">${esc(t)}</button>`;
          })
          .join('')
      : '<span class="text-sm text-navy-400">태그가 없어요. 「내 옷장」에서 태그를 먼저 만들어 주세요.</span>';

  function formHTML() {
    const d = local.draft;
    return `
      <form data-form class="space-y-3 rounded-2xl bg-white p-4" novalidate>
        <p class="text-sm font-bold text-navy-900">${local.editing === 'new' ? '새 TPO 추가' : 'TPO 수정'}</p>
        <div class="grid grid-cols-4 gap-2">
          <label class="col-span-1 block">
            <span class="field-label">이모지</span>
            <input data-field="emoji" type="text" maxlength="8" value="${esc(d.emoji)}" placeholder="✨" class="field text-center" />
          </label>
          <label class="col-span-3 block">
            <span class="field-label">이름</span>
            <input data-field="name" type="text" maxlength="${NAME_MAX}" value="${esc(d.name)}" placeholder="예) 면접, 카페 알바" class="field" />
          </label>
        </div>
        <label class="block">
          <span class="field-label">한마디 (선택)</span>
          <input data-field="hint" type="text" maxlength="${HINT_MAX}" value="${esc(d.hint)}" placeholder="핏체크 결과에 같이 보여줄 말" class="field" />
        </label>
        <div>
          <span class="field-label">어울리는 스타일 (+12점)</span>
          <div class="flex flex-wrap gap-2">${tagChips('prefer')}</div>
        </div>
        <div>
          <span class="field-label">피해야 할 스타일 (-15점)</span>
          <div class="flex flex-wrap gap-2">${tagChips('avoid')}</div>
        </div>
        <div class="flex gap-2">
          <button type="submit" class="btn-primary flex-1" ${local.busy ? 'disabled' : ''}>${local.busy ? '저장 중...' : '저장'}</button>
          <button type="button" data-action="cancel" class="shrink-0 rounded-xl border border-navy-200 px-4 font-bold text-navy-700">취소</button>
        </div>
      </form>`;
  }

  function rowHTML(t) {
    const list = (arr) => (arr.length ? arr.map((x) => `#${esc(x)}`).join(' ') : '없음');
    return `
      <li class="rounded-xl bg-navy-50 px-3 py-2 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate font-semibold text-navy-900">${esc(t.emoji)} ${esc(t.name)}</span>
          <span class="flex shrink-0 gap-3">
            <button type="button" data-action="edit" data-id="${t.id}" class="font-semibold text-navy-700" ${local.busy ? 'disabled' : ''}>수정</button>
            <button type="button" data-action="delete" data-id="${t.id}" class="font-semibold text-pink-600" ${local.busy ? 'disabled' : ''}>삭제</button>
          </span>
        </div>
        <p class="mt-0.5 truncate text-xs text-navy-500">👍 ${list(t.prefer)} · 👎 ${list(t.avoid)}</p>
      </li>`;
  }

  function render() {
    const { tpos, fromFallback } = getTpos();
    const m = local.message;
    body.innerHTML = `
      ${
        fromFallback
          ? '<p class="rounded-2xl bg-pink-50 px-3 py-2 text-xs text-pink-600">기본 TPO를 임시로 보여주고 있어요. 수정하려면 Supabase에서 schema.sql을 실행한 뒤 새로고침해 주세요.</p>'
          : ''
      }
      ${tpos.length ? `<ul class="space-y-2">${tpos.map(rowHTML).join('')}</ul>` : '<p class="text-sm text-navy-400">TPO가 없어요. 새로 추가해 보세요.</p>'}
      ${local.editing === null ? `<button type="button" data-action="new" class="w-full rounded-xl border border-dashed border-navy-300 py-2.5 text-sm font-bold text-navy-700" ${fromFallback || local.busy ? 'disabled' : ''}>+ TPO 추가</button>` : formHTML()}
      <p class="min-h-5 text-sm font-medium ${m?.isError ? 'text-pink-600' : 'text-emerald-600'}" role="status">${m ? esc(m.text) : ''}</p>`;
    if (local.editing !== null) body.querySelector('[data-field="name"]')?.focus({ preventScroll: true });
  }

  function startEdit(id) {
    const t = getTpos().tpos.find((x) => x.id === id);
    if (!t) return;
    local.editing = id;
    local.draft = { name: t.name, emoji: t.emoji, hint: t.hint ?? '', prefer: new Set(t.prefer), avoid: new Set(t.avoid) };
    local.message = null;
    render();
  }

  async function run(task, okText) {
    if (local.busy) return;
    local.busy = true;
    local.message = null;
    render();
    try {
      await task();
      await onChanged();
      local.editing = null;
      local.draft = blankDraft();
      local.message = { text: okText, isError: false };
    } catch (err) {
      local.message = { text: `실패: ${err.message}`, isError: true };
    } finally {
      local.busy = false;
      render();
    }
  }

  function save() {
    const d = local.draft;
    const name = d.name.trim();
    if (!name) {
      local.message = { text: 'TPO 이름을 입력해 주세요.', isError: true };
      return render();
    }
    if (name.length > NAME_MAX) {
      local.message = { text: `TPO 이름은 ${NAME_MAX}자 이내로 입력해 주세요.`, isError: true };
      return render();
    }
    const others = getTpos().tpos.filter((t) => t.id !== local.editing).map((t) => t.name.toLowerCase());
    if (others.includes(name.toLowerCase())) {
      local.message = { text: '이미 있는 TPO 이름이에요.', isError: true };
      return render();
    }
    const emoji = Array.from(d.emoji.trim()).slice(0, EMOJI_MAX).join('') || '✨';
    const tags = new Set(getTags());
    const payload = {
      name,
      emoji,
      hint: d.hint.trim().slice(0, HINT_MAX),
      // 없어진 태그가 남아 있지 않게 걸러서 저장
      prefer: [...d.prefer].filter((t) => tags.has(t)),
      avoid: [...d.avoid].filter((t) => tags.has(t)),
    };
    const id = local.editing;
    return run(
      () => (id === 'new' ? createTpo(payload) : updateTpo(id, payload)),
      id === 'new' ? `'${name}' TPO를 추가했어요.` : `'${name}' TPO를 수정했어요.`,
    );
  }

  function remove(id) {
    const t = getTpos().tpos.find((x) => x.id === id);
    if (!t) return;
    if (!window.confirm(`'${t.name}' TPO를 삭제할까요?\n지난 착장 기록은 그대로 남아요.`)) return;
    return run(() => deleteTpo(id), `'${t.name}' TPO를 삭제했어요.`);
  }

  body.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const kind = chip.dataset.chip;
      const other = kind === 'prefer' ? 'avoid' : 'prefer';
      const tag = chip.dataset.tag;
      const set = local.draft[kind];
      if (set.has(tag)) set.delete(tag);
      else {
        set.add(tag);
        local.draft[other].delete(tag); // 어울리는 스타일이면서 피할 스타일일 수는 없다
      }
      return render();
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;
    const id = Number(btn.dataset.id);
    if (action === 'new') {
      local.editing = 'new';
      local.draft = blankDraft();
      local.message = null;
      render();
    } else if (action === 'cancel') {
      local.editing = null;
      local.message = null;
      render();
    } else if (action === 'edit') startEdit(id);
    else if (action === 'delete') remove(id);
  });

  // 입력값은 칩을 눌러 다시 그려도 사라지지 않도록 즉시 draft 에 반영
  body.addEventListener('input', (e) => {
    const field = e.target.closest('[data-field]')?.dataset.field;
    if (field) local.draft[field] = e.target.value;
  });
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  render();
  return { refresh: render };
}
