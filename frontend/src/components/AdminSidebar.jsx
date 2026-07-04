import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Gauge,
  Home,
  LayoutDashboard,
  ListFilter,
  LogOut,
  MapPin,
  Moon,
  Receipt,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useIsMobile from '../hooks/useIsMobile';
import { ADMIN_PAGE_PERMISSIONS, canAccessAdminPage } from '../adminPermissions';

export const ADMIN_NAV_ITEMS = [
  { to: '/admin', label: '仪表盘', icon: LayoutDashboard, end: true },
  {
    to: '/admin/work-center',
    label: '工作中心',
    icon: CalendarClock,
    permission: ADMIN_PAGE_PERMISSIONS.workCenter,
  },
  {
    to: '/admin/home-visits',
    label: '家访任务',
    icon: Home,
    permission: ADMIN_PAGE_PERMISSIONS.homeVisits,
  },
  {
    to: '/admin/campus-visits',
    label: '到校参观',
    icon: MapPin,
    permission: ADMIN_PAGE_PERMISSIONS.campusVisits,
  },
  {
    to: '/admin/enrollment-settlement',
    label: '报名结算',
    icon: Receipt,
    permission: ADMIN_PAGE_PERMISSIONS.enrollmentSettlement,
  },
  {
    to: '/admin/score-preview',
    label: '评分预览',
    icon: Gauge,
    permission: ADMIN_PAGE_PERMISSIONS.scorePreview,
  },
  {
    to: '/admin/search',
    label: '全局搜索',
    icon: Search,
    permission: ADMIN_PAGE_PERMISSIONS.leadsManage,
  },
  {
    to: '/admin/leads',
    label: '学生管理',
    icon: ListFilter,
    permission: ADMIN_PAGE_PERMISSIONS.leadsManage,
  },
  {
    to: '/admin/governance',
    label: '线索治理',
    icon: ArrowRightLeft,
    permission: ADMIN_PAGE_PERMISSIONS.leadGovernance,
  },
  {
    to: '/admin/agents',
    label: '账号管理',
    icon: Users,
    permission: ADMIN_PAGE_PERMISSIONS.accountManage,
  },
  {
    to: '/admin/report-center',
    label: '报表中心',
    icon: BarChart3,
    permission: ADMIN_PAGE_PERMISSIONS.reportCenter,
  },
  {
    to: '/admin/audit-logs',
    label: '操作记录',
    icon: ClipboardList,
    permission: ADMIN_PAGE_PERMISSIONS.auditLogs,
  },
  { to: '/admin/settings', label: '系统设置', icon: Settings, superOnly: true },
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
  const visibleNavItems = ADMIN_NAV_ITEMS.filter(
    (item) => (!item.superOnly || user?.is_super_admin) && canAccessAdminPage(user, item.permission),
  );

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
            <BarChart3 className="w-4 h-4 text-white" />
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
        {visibleNavItems.map((item) => {
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
