import axios from 'axios';

const api = axios.create({ baseURL: '/api', withCredentials: true });

// 全局错误提示 toast（延迟引用避免循环依赖）
let showToast = null;
export const setGlobalToast = (fn) => { showToast = fn; };

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const body = err.response?.data;

    // 业务失败信封 {code,data,msg}（后端 Response.error，HTTP 4xx）：保持原有调用约定，
    // 以 resolve 交给调用方按 data.code 处理。HTTPException 的响应带 detail，仍按 reject 走 catch。
    if (
      status >= 400 && status < 500 && status !== 401 &&
      body && typeof body === 'object' && 'code' in body && !('detail' in body)
    ) {
      return Promise.resolve(err.response);
    }

    // 401: 未认证
    if (status === 401) {
      localStorage.removeItem('crm_user');
      // 静默处理 /auth/me 的 401 错误（未登录状态的正常检查）
      if (err.config?.url?.includes('/auth/me')) {
        return Promise.resolve({ data: { code: -1, data: null } });
      }
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    // 5xx: 服务器错误，显示全局提示
    if (status >= 500 && showToast) {
      showToast('服务器异常，请稍后重试');
    }

    // 网络错误
    if (!err.response && err.code === 'ERR_NETWORK' && showToast) {
      showToast('网络连接失败，请检查网络');
    }

    return Promise.reject(err);
  },
);

export default api;
