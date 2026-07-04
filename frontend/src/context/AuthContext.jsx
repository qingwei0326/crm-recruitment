import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('crm_user');
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        localStorage.removeItem('crm_user');
      }
    }

    api
      .get('/auth/me')
      .then((res) => {
        if (res.data.code === 0) {
          const u = res.data.data;
          localStorage.setItem('crm_user', JSON.stringify(u));
          setUser(u);
        } else {
          localStorage.removeItem('crm_user');
          setUser(null);
        }
      })
      .catch(() => {
        localStorage.removeItem('crm_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const data = res.data;
    if (data.code === 0) {
      const u = data.data.user;
      localStorage.setItem('crm_user', JSON.stringify(u));
      setUser(u);
      return u;
    }
    throw new Error(data.msg || '登录失败');
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Local logout should still complete if the network request fails.
    }
    localStorage.removeItem('crm_user');
    setUser(null);
  };

  // 改密成功后更新本地 user（清除 must_change_password 标记）
  const updateUser = (patch) => {
    setUser((prev) => {
      const next = { ...(prev || {}), ...patch };
      localStorage.setItem('crm_user', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
