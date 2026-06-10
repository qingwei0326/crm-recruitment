import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  BarChart3,
  CalendarClock,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Moon,
  Search,
  Settings,
  Sun,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useIsMobile from '../hooks/useIsMobile';

export const ADMIN_NAV_ITEMS = [
  { to: '/admin', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/admin/work-center', label: '工作中心', icon: CalendarClock },
  { to: '/admin/leads', label: '学生管理', icon: ListFilter },
  { to: '/admin/governance', label: '线索治理', icon: ArrowRightLeft },
  { to: '/admin/agents', label: '话务员管理', icon: Users },
  { to: '/admin/report', label: '汇总报表', icon: BarChart3 },
  { to: '/admin/trend', label: '趋势报表', icon: TrendingUp },
  { to: '/admin/call-volume', label: '通电量查询', icon: Search },
  { to: '/admin/settings', label: '系统设置', icon: Settings },
];

function isActivePath(pathname, item) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export default function AdminSidebar({ onClose }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const location = useLocation();

  const navClass = (active) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
      active
        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`;

  return (
    <>
      <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
              CRM 管理后台
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.name}</div>
          </div>
        </div>
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="关闭导航"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>

      <nav className="p-3 space-y-1">
        {ADMIN_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(location.pathname, item);
          return (
            <Link key={item.to} to={item.to} onClick={onClose} className={navClass(active)}>
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-3 border-t dark:border-gray-700 space-y-1">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg"
        >
          {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          {dark ? '亮色模式' : '暗色模式'}
        </button>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <LogOut className="w-4 h-4" /> 退出登录
        </button>
      </div>
    </>
  );
}
