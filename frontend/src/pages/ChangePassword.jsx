import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useIsMobile from '../hooks/useIsMobile';
import api from '../api';
import { KeyRound, Sun, Moon, LogOut } from 'lucide-react';

function defaultRouteFor(user, isMobile) {
  if (!user) return '/login';
  if (user.role === 'admin') return '/admin';
  if (user.role === 'agent') return isMobile ? '/mobile' : '/agent';
  return '/login';
}

export default function ChangePassword() {
  const { user, updateUser, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 是否首次登录强制改密（决定文案 + 是否允许「以后再说」）
  const forced = !!user?.must_change_password;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) return setError('请填写当前密码和新密码');
    if (newPassword.length < 6) return setError('新密码至少 6 位');
    if (newPassword !== confirm) return setError('两次输入的新密码不一致');
    if (newPassword === oldPassword) return setError('新密码不能与当前密码相同');
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      if (res.data.code === 0) {
        updateUser({ must_change_password: false });
        navigate(defaultRouteFor(user, isMobile), { replace: true });
      } else {
        setError(res.data.msg || '修改失败');
      }
    } catch (err) {
      setError(err?.response?.data?.msg || err?.response?.data?.detail || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-800 dark:from-gray-900 dark:to-gray-800 px-4 relative">
      <button
        onClick={toggle}
        className="absolute top-4 right-4 p-2.5 rounded-full bg-white/20 text-white hover:bg-white/30 transition"
        aria-label="切换主题"
      >
        {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-4">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">设置新密码</h1>
          <p className="text-blue-200 dark:text-gray-400 mt-1 text-sm">
            {forced ? '首次登录请先设置你自己的密码' : '修改登录密码'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              当前密码
            </label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-base bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
              placeholder="管理员给你的初始密码"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              新密码
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-base bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
              placeholder="至少 6 位"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              确认新密码
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-base bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
              placeholder="再次输入新密码"
              autoComplete="new-password"
            />
          </div>
          {error && (
            <div className="text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-base"
          >
            {loading ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <KeyRound className="w-4 h-4" />
            )}
            {loading ? '提交中...' : '保存新密码'}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </form>
      </div>
    </div>
  );
}
