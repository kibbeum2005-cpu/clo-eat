import '@fontsource/gowun-dodum/400.css';
import '@fontsource/jua/400.css';
import './style.css';
import { initApp } from './app.js';
import { renderAuth } from './auth.js';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';

const root = document.querySelector('#app');

// 비밀번호 재설정 메일 링크로 들어온 경우, 새 비밀번호를 정하기 전까지 옷장을 보여주지 않는다.
let recoveryMode = location.hash.includes('type=recovery');
let currentView = null;

function show(viewKey, render) {
  if (currentView === viewKey) return; // 토큰 갱신 등으로 같은 화면이 다시 그려지는 것을 방지
  currentView = viewKey;
  render();
}

function showRecovery() {
  show('recovery', () =>
    renderAuth(root, {
      initialMode: 'recovery',
      onRecovered: () => {
        recoveryMode = false;
        history.replaceState(null, '', location.pathname);
        currentView = null;
        route();
      },
    }),
  );
}

let latestSession = null;

function route() {
  if (recoveryMode) return showRecovery();
  const user = latestSession?.user;
  if (user) {
    show(`closet:${user.id}`, () =>
      initApp(root, { user, onSignOut: () => supabase.auth.signOut() }),
    );
  } else {
    show('login', () => renderAuth(root));
  }
}

if (!isSupabaseConfigured) {
  initApp(root, { user: null });
} else {
  // 콜백 안에서 supabase 를 바로 호출하면 교착될 수 있어 다음 틱으로 미룬다.
  supabase.auth.onAuthStateChange((event, session) => {
    latestSession = session;
    if (event === 'PASSWORD_RECOVERY') recoveryMode = true;
    setTimeout(route, 0);
  });
}
