import { createIcons, Shirt } from 'lucide';
import { NICKNAME_MAX, authErrorMessage, sendPasswordReset, signIn, signUp, updatePassword, validateNickname } from './lib/auth.js';

const TITLES = {
  login: '로그인',
  signup: '회원가입',
  forgot: '비밀번호 찾기',
  recovery: '새 비밀번호 설정',
};

const SUBMIT_LABELS = {
  login: '로그인',
  signup: '가입하기',
  forgot: '재설정 메일 보내기',
  recovery: '비밀번호 변경',
};

const emailField = `
  <label class="block">
    <span class="field-label">이메일</span>
    <input name="email" type="email" autocomplete="email" placeholder="you@example.com" class="field" />
  </label>`;

const passwordField = (label, autocomplete) => `
  <label class="block">
    <span class="field-label">${label}</span>
    <input name="password" type="password" autocomplete="${autocomplete}" minlength="6" placeholder="6자 이상" class="field" />
  </label>`;

const nicknameField = `
  <label class="block">
    <span class="field-label">닉네임</span>
    <input name="nickname" type="text" maxlength="${NICKNAME_MAX * 2}" autocomplete="nickname" placeholder="화면에 보여줄 이름 (${NICKNAME_MAX}자 이내)" class="field" />
  </label>`;

function fieldsFor(mode) {
  if (mode === 'login') return emailField + passwordField('비밀번호', 'current-password');
  if (mode === 'signup') return nicknameField + emailField + passwordField('비밀번호', 'new-password');
  if (mode === 'forgot') return emailField;
  return passwordField('새 비밀번호', 'new-password');
}

function linksFor(mode) {
  const link = (to, text) => `<button type="button" data-mode="${to}" class="font-semibold text-navy-700 underline underline-offset-2">${text}</button>`;
  if (mode === 'login') {
    return `<div class="flex justify-between text-sm text-navy-500">${link('forgot', '비밀번호를 잊으셨나요?')}${link('signup', '회원가입')}</div>`;
  }
  if (mode === 'recovery') return '';
  return `<div class="text-center text-sm text-navy-500">${link('login', '로그인으로 돌아가기')}</div>`;
}

/**
 * 로그인/회원가입/비밀번호 찾기/새 비밀번호 설정 화면.
 * @param {HTMLElement} root
 * @param {{ initialMode?: 'login'|'recovery', onRecovered?: () => void }} options
 */
export function renderAuth(root, { initialMode = 'login', onRecovered } = {}) {
  let mode = initialMode;

  function draw(message = '', tone = 'error') {
    root.innerHTML = `
      <main class="mx-auto min-h-dvh max-w-md px-4 pb-16 pt-8">
        <header class="mb-6 flex items-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-pink-200 shadow-lg shadow-navy-900/20">
            <i data-lucide="shirt"></i>
          </div>
          <div>
            <h1 class="text-2xl font-bold text-navy-900">옷장 파먹기</h1>
            <p class="text-sm text-navy-500">내 옷장은 나만 볼 수 있어요</p>
          </div>
        </header>

        <section class="rounded-3xl bg-white/90 p-5 shadow-xl shadow-navy-900/5">
          <h2 class="mb-4 text-lg font-bold text-navy-900">${TITLES[mode]}</h2>
          ${mode === 'forgot' ? '<p class="mb-4 text-sm text-navy-500">가입한 이메일로 비밀번호 재설정 링크를 보내 드려요.</p>' : ''}
          <form id="auth-form" class="space-y-4" novalidate>
            ${fieldsFor(mode)}
            <p id="auth-message" class="min-h-5 text-sm font-medium ${tone === 'error' ? 'text-pink-600' : 'text-navy-700'}" role="alert">${message}</p>
            <button type="submit" id="auth-submit" class="btn-primary w-full">${SUBMIT_LABELS[mode]}</button>
          </form>
          <div class="mt-4">${linksFor(mode)}</div>
        </section>
      </main>
    `;
    createIcons({ icons: { Shirt } });

    root.querySelectorAll('[data-mode]').forEach((btn) =>
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        draw();
      }),
    );
    root.querySelector('#auth-form').addEventListener('submit', onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = root.querySelector('#auth-message');
    const btn = root.querySelector('#auth-submit');
    const email = String(new FormData(form).get('email') ?? '').trim();
    const password = String(new FormData(form).get('password') ?? '');
    const nick = mode === 'signup' ? validateNickname(new FormData(form).get('nickname')) : null;
    const fail = (text) => {
      msg.className = 'min-h-5 text-sm font-medium text-pink-600';
      msg.textContent = text;
    };

    if (nick && !nick.ok) return fail(nick.message);
    if (mode !== 'recovery' && !/^\S+@\S+\.\S+$/.test(email)) return fail('올바른 이메일을 입력해 주세요.');
    if (mode !== 'forgot' && password.length < 6) return fail('비밀번호는 6자 이상 입력해 주세요.');

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '처리 중...';
    try {
      if (mode === 'login') {
        await signIn(email, password); // 성공하면 main.js 의 onAuthStateChange 가 화면을 전환
        return;
      }
      if (mode === 'signup') {
        const data = await signUp(email, password, nick.name);
        if (data.session) return; // 이메일 인증이 꺼져 있으면 바로 로그인됨
        mode = 'login';
        return draw('가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.', 'info');
      }
      if (mode === 'forgot') {
        await sendPasswordReset(email);
        mode = 'login';
        return draw('재설정 메일을 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.', 'info');
      }
      await updatePassword(password);
      onRecovered?.();
    } catch (err) {
      fail(authErrorMessage(err));
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  draw();
}
