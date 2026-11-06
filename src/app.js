import { CalendarDays, createIcons, Receipt, Shirt, Sparkles } from 'lucide';
import { resetOotd, showOotd } from './ootd.js';
import { showReceipt } from './receipt.js';
import { initCloset } from './closet.js';
import { resetToday, showToday } from './today.js';
import { esc } from './lib/html.js';
import { NICKNAME_MAX, nicknameOf, updateNickname, validateNickname } from './lib/auth.js';
import { settlePlannedLogs } from './lib/logsApi.js';
import { ensureDefaults, resetOptionsState } from './lib/optionsApi.js';
import { isSupabaseConfigured } from './lib/supabase.js';

const TABS = [
  { id: 'closet', label: '내 옷장', icon: 'shirt' },
  { id: 'today', label: '오늘 입기', icon: 'sparkles' },
  { id: 'ootd', label: '달력', icon: 'calendar-days' },
  { id: 'receipt', label: '영수증', icon: 'receipt' },
];

/**
 * 로그인 후 보이는 메인 화면: 헤더 + 탭 + 탭 내용
 * @param {HTMLElement} root
 * @param {{ user: {email?: string}|null, onSignOut?: () => void }} options
 */
export function initApp(root, { user, onSignOut } = {}) {
  resetToday();
  resetOotd();

  // 날짜가 지난 예정 착장을 착용 횟수에 반영한다. 실패해도 앱은 계속 쓸 수 있게 무시한다.
  resetOptionsState();
  const settled =
    user && isSupabaseConfigured
      ? Promise.allSettled([
          // 기본 카테고리/태그/TPO 를 내 데이터로 한 번 넣어 둔다 (이후 전부 편집 가능). 실패하면 기본값으로 계속 동작.
          ensureDefaults(),
          settlePlannedLogs(),
        ])
      : Promise.resolve([]);
  let selectToken = 0;

  root.innerHTML = `
    <main class="mx-auto min-h-dvh max-w-md px-4 pb-16 pt-8">
      <header class="mb-5 flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-pink-200 shadow-lg shadow-navy-900/20">
          <i data-lucide="shirt"></i>
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-bold text-navy-900">옷장 파먹기</h1>
          <div id="nickname-area" class="min-w-0"></div>
        </div>
        ${user ? '<button type="button" id="logout-btn" class="shrink-0 text-sm font-semibold text-navy-700 underline underline-offset-2">로그아웃</button>' : ''}
      </header>

      <nav class="mb-5 grid grid-cols-4 gap-1 rounded-2xl bg-white/70 p-1" role="tablist">
        ${TABS.map(
          (t) => `<button type="button" role="tab" data-tab="${t.id}" class="tab-btn flex flex-col items-center justify-center gap-0.5">
            <i data-lucide="${t.icon}" class="h-4 w-4"></i>${t.label}</button>`,
        ).join('')}
      </nav>

      <div id="tab-panel"></div>
    </main>
  `;
  createIcons({ icons: { CalendarDays, Receipt, Shirt, Sparkles } });

  // ── 닉네임 (이메일은 화면에 보여주지 않는다) ──
  const nickArea = root.querySelector('#nickname-area');
  let nickname = user ? nicknameOf(user) : '';
  let editingNick = false;
  let nickMessage = '';
  let nickBusy = false;

  function renderNickname() {
    if (!user) {
      nickArea.innerHTML = '<p class="truncate text-sm text-navy-500">옷 한 벌의 1회당 비용을 계산해 드려요</p>';
      return;
    }
    if (!editingNick) {
      nickArea.innerHTML = `<p class="flex items-baseline gap-2 text-sm text-navy-500">
        <span class="truncate">${nickname ? `${esc(nickname)}님` : '닉네임이 아직 없어요'}</span>
        <button type="button" id="nick-edit" class="shrink-0 text-xs font-semibold text-pink-600 underline underline-offset-2">${nickname ? '변경' : '설정하기'}</button>
      </p>`;
      nickArea.querySelector('#nick-edit').addEventListener('click', () => {
        editingNick = true;
        nickMessage = '';
        renderNickname();
      });
      return;
    }
    nickArea.innerHTML = `<form id="nick-form" class="flex items-center gap-1.5" novalidate>
        <input name="nickname" type="text" maxlength="${NICKNAME_MAX * 2}" value="${esc(nickname)}" aria-label="닉네임" placeholder="닉네임" class="field !py-1 text-sm" />
        <button type="submit" class="shrink-0 text-xs font-bold text-pink-600" ${nickBusy ? 'disabled' : ''}>저장</button>
        <button type="button" id="nick-cancel" class="shrink-0 text-xs font-semibold text-navy-500">취소</button>
      </form>
      <p class="min-h-4 text-xs text-pink-600" role="alert">${esc(nickMessage)}</p>`;
    const input = nickArea.querySelector('input');
    input.focus();
    input.select();
    nickArea.querySelector('#nick-cancel').addEventListener('click', () => {
      editingNick = false;
      renderNickname();
    });
    nickArea.querySelector('#nick-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const result = validateNickname(input.value);
      if (!result.ok) {
        nickMessage = result.message;
        return renderNickname();
      }
      nickBusy = true;
      nickMessage = '';
      try {
        nickname = await updateNickname(result.name);
        editingNick = false;
      } catch (err) {
        nickMessage = `저장 실패: ${err.message}`;
      } finally {
        nickBusy = false;
        renderNickname();
      }
    });
  }
  renderNickname();

  const panel = root.querySelector('#tab-panel');
  const tabButtons = root.querySelectorAll('[data-tab]');

  async function select(tabId) {
    tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tabId)));
    const token = ++selectToken;
    await settled; // 반영이 끝난 뒤의 착용 횟수로 화면을 그린다
    if (token !== selectToken || !root.isConnected) return; // 그 사이 다른 탭을 눌렀다면 중단
    // 탭 내용은 매번 새로 그려서 다른 탭에서 바뀐 옷장 데이터가 반영되게 한다.
    if (tabId === 'closet') initCloset(panel);
    else if (tabId === 'today') showToday(panel, { onReceipt: () => select('receipt') });
    else if (tabId === 'ootd') showOotd(panel);
    else showReceipt(panel);
  }

  tabButtons.forEach((b) => b.addEventListener('click', () => select(b.dataset.tab)));
  root.querySelector('#logout-btn')?.addEventListener('click', () => onSignOut?.());
  select('closet');
}
