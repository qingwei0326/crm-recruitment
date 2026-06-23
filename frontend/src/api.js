import axios from 'axios';

const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('crm_user');
      // 静默处理 /auth/me 的 401 错误（未登录状态的正常检查）
      if (err.config?.url?.includes('/auth/me')) {
        return Promise.resolve({ data: { code: -1, data: null } });
      }
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export default api;
