import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useIsMobile from '../hooks/useIsMobile';
import {
  AlertCircle,
  BarChart3,
  CalendarClock,
  Eye,
  EyeOff,
  LogIn,
  Moon,
  PhoneCall,
  Sun,
  Users,
} from 'lucide-react';

const BRAND_POINTS = [
  { icon: PhoneCall, text: '拨打、备注和回访记在同一条线索上' },
  { icon: CalendarClock, text: '家访、到校参观和报名按流程推进' },
  { icon: Users, text: '分配、交接和团队进度一目了然' },
];

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
  backgroundSize: '40px 40px',
  maskImage: 'radial-gradient(120% 90% at 0% 0%, #000 30%, transparent 75%)',
  WebkitMaskImage: 'radial-gradient(120% 90% at 0% 0%, #000 30%, transparent 75%)',
};

const inputClass =
  'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500';
const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';

function BrandMark({ inverted = false }) {
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-panel ${inverted ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}
    >
      <BarChart3 className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return setError('请输入用户名和密码');
    setLoading(true);
    setError('');
    try {
      const user = await login(username, password);
      if (user.must_change_password) {
        navigate('/change-password');
      } else if (user.role === 'admin') {
        navigate('/admin');
      } else if (user.role === 'agent') {
        navigate(isMobile ? '/mobile' : '/agent');
      } else {
        navigate('/login');
      }
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white dark:bg-slate-950">
      {/* Brand side: desktop only. The phone layout carries the mark above the form. */}
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col justify-between overflow-hidden bg-blue-600 p-10 text-white lg:flex dark:bg-slate-900">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={GRID_STYLE}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark inverted />
          <span className="text-base font-bold">招生话务 CRM</span>
        </div>
        <div className="relative">
          <p className="text-3xl font-bold leading-snug">
            每一条线索，
            <br />
            跟进到有结果。
          </p>
          <ul className="mt-8 space-y-3 text-sm text-blue-50 dark:text-slate-300">
            {BRAND_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-blue-100/80 dark:text-slate-500">Admissions Call CRM</p>
      </aside>

      <main className="relative flex flex-1 flex-col items-center justify-center px-5 py-10">
        <button
          type="button"
          onClick={toggle}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label="切换主题"
          title={dark ? '亮色模式' : '暗色模式'}
        >
          {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              招生话务 CRM
            </span>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">登录</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            使用管理员分配的账号登录。
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
            <div>
              <label htmlFor="login-username" className={labelClass}>
                用户名
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder="请输入用户名"
                autoComplete="username"
                autoCapitalize="none"
              />
            </div>
            <div>
              <label htmlFor="login-password" className={labelClass}>
                密码
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-11`}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-base font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-slate-950"
            >
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden="true" />
              )}
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>

          <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
            忘记密码请联系管理员重置。
          </p>
        </div>
      </main>
    </div>
  );
}
