/**
 * 默认请求走相对路径 `/api`（本地 Vite 代理或已正确反代的 SWA）。
 * 若线上「知识库对话失败」且 Network 里 /api 返回 HTML 或非流式，可在构建时设置：
 *   VITE_API_ORIGIN=https://你的-backend.azurewebsites.net
 * （无尾部斜杠；不要带 /api，axios 会自行拼 /api）
 */
export function getApiOrigin(): string {
  const v = import.meta.env.VITE_API_ORIGIN;
  if (typeof v === 'string' && v.trim()) return v.replace(/\/$/, '').trim();
  // fallback to backend host when SWA /api rewrite does not forward POST correctly
  return 'https://gongdan-b5fzbtgteqd5gzfb.eastasia-01.azurewebsites.net';
}

/** 浏览器侧完整 URL，例如 /api/foo 或 https://host/api/foo */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const o = getApiOrigin();
  return o ? `${o}${p}` : p;
}
