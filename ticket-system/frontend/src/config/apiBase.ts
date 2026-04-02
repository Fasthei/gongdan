/**
 * 请求基址。本地开发走 Vite 代理，生产走 SWA rewrite 或 VITE_API_ORIGIN 环境变量。
 */
export function getApiOrigin(): string {
  const v = import.meta.env.VITE_API_ORIGIN;
  if (typeof v === 'string' && v.trim()) return v.replace(/\/$/, '').trim();
  // fallback: SWA /api rewrite 不可用时直连 App Service
  return 'https://gongdan-b5fzbtgteqd5gzfb.eastasia-01.azurewebsites.net';
}

/** 浏览器侧完整 URL，例如 /api/foo 或 https://host/api/foo */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const o = getApiOrigin();
  return o ? `${o}${p}` : p;
}
