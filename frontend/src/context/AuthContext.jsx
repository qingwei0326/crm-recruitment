import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    const saved = localStorage.getItem('crm_user');
    if (token && saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        localStorage.removeItem('crm_token');
        localStorage.removeItem('crm_user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const data = res.data;
    if (data.code === 0) {
      const u = data.data.user;
      const token = data.data.access_token;
      localStorage.setItem('crm_token', token);
      localStorage.setItem('crm_user', JSON.stringify(u));
      setUser(u);
      return u;
    }
    throw new Error(data.msg || '登录失败');
  };

  const logout = () => {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
