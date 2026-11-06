/** HTML 이스케이프 (innerHTML 에 사용자 입력을 넣을 때 필수) */
export const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
