import axios from 'axios';
import { apiUrl, getApiOrigin } from '../config/apiBase';
import { clearAuthStorage, getLoginPathByUser, getStoredUser } from '../services/authSession';

const apiOrigin = getApiOrigin();
const api = axios.create({
  baseURL: apiOrigin ? `${apiOrigin}/api` : '/api',
  timeout: 20000,
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let refreshInFlight: Promise<any> | null = null;
async function refreshAccessToken(refreshToken: string) {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(apiUrl('/api/auth/refresh'), { refreshToken })
      .then((res) => res.data)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function handleAuthExpiredRedirect() {
  const user = getStoredUser();
  clearAuthStorage();
  window.location.href = getLoginPathByUser(user);
}

// 请求拦截器：自动附加 Token（登录/刷新接口不加，避免干扰）
api.interceptors.request.use((config) => {
  const url = String(config.url || '');
  const isAuthEndpoint = url.includes('/auth/staff-login') ||
    url.includes('/auth/customer-login') ||
    url.includes('/auth/refresh') ||
    url.includes('/auth/logout');
  if (!isAuthEndpoint) {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401 时尝试刷新 Token
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // 网络抖动/超时：对关键请求做有限重试（避免一次超时导致“登录失败”）
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const code = (error as any)?.code as string | undefined;
    const isNetworkLike = !error.response || code === 'ECONNABORTED';
    const url: string = String(original?.url || '');
    const method: string = String(original?.method || 'get').toLowerCase();
    const shouldRetry =
      isNetworkLike &&
      !original?._retry_network &&
      url.includes('/public/bing-background');

    if (shouldRetry) {
      original._retry_network = 0;
    }
    if (isNetworkLike && typeof original?._retry_network === 'number' && original._retry_network < 2) {
      original._retry_network += 1;
      const backoffMs = 400 * Math.pow(2, original._retry_network - 1);
      await sleep(backoffMs);
      return api(original);
    }

    // 登录/刷新接口本身不走 token 自动刷新逻辑，直接抛出原始错误让业务层处理
    const isAuthEndpoint = url.includes('/auth/staff-login') ||
      url.includes('/auth/customer-login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/logout');

    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const data = await refreshAccessToken(refreshToken);
          localStorage.setItem('accessToken', data.accessToken);
          if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
          if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(original);
        } catch {
          handleAuthExpiredRedirect();
        }
      }
      handleAuthExpiredRedirect();
    }

    // 登录接口：把“无响应”显示为更明确的网络问题
    if (isNetworkLike && method === 'post' && (url.includes('/auth/customer-login') || url.includes('/auth/staff-login'))) {
      error.message = '网络连接不稳定或后端暂时不可用，请稍后重试';
    }
    return Promise.reject(error);
  }
);

export default api;
