import axios from 'axios';

const api = axios.create({ baseURL: '/api', withCredentials: true });

// 全局错误提示 toast（延迟引用避免循环依赖）
let showToast = null;
export const setGlobalToast = (fn) => { showToast = fn; };

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;

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
