import { supabase } from './supabase.js';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password }).then(unwrap);

/** 이메일 인증이 켜져 있으면 session 이 null 로 돌아옵니다. */
export const signUp = (email, password, nickname) =>
  supabase.auth
    .signUp({ email, password, options: { emailRedirectTo: window.location.origin, data: { nickname } } })
    .then(unwrap);

export const sendPasswordReset = (email) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }).then(unwrap);

export const updatePassword = (password) => supabase.auth.updateUser({ password }).then(unwrap);

export const signOut = () => supabase.auth.signOut().then(({ error }) => {
  if (error) throw error;
});

/** 에러 메시지를 한국어로 */
export function authErrorMessage(err) {
  const msg = String(err?.message ?? err);
  if (/invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/email not confirmed/i.test(msg)) return '이메일 인증이 아직 완료되지 않았습니다. 메일함을 확인해 주세요.';
  if (/already registered|already been registered/i.test(msg)) return '이미 가입된 이메일입니다.';
  if (/password should be at least/i.test(msg)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/rate limit|too many/i.test(msg)) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (/same password|different from the old/i.test(msg)) return '이전과 다른 비밀번호를 입력해 주세요.';
  return msg;
}

export const NICKNAME_MAX = 12;

/** 닉네임 정리·검증 (앞뒤 공백 제거, 연속 공백 하나로, 1~12자) */
export function validateNickname(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const length = Array.from(name).length; // 이모지·한글도 한 글자로 센다
  if (!length) return { ok: false, message: '닉네임을 입력해 주세요.' };
  if (length > NICKNAME_MAX) return { ok: false, message: `닉네임은 ${NICKNAME_MAX}자 이내로 입력해 주세요.` };
  return { ok: true, name };
}

/** 로그인한 사용자의 닉네임 (없으면 빈 문자열). 이메일은 화면에 보여주지 않는다. */
export const nicknameOf = (user) => String(user?.user_metadata?.nickname ?? '').trim();

export async function updateNickname(nickname) {
  const data = await supabase.auth.updateUser({ data: { nickname } }).then(unwrap);
  return nicknameOf(data.user);
}
