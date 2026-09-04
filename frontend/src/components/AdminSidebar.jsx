import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  Archive,
  BarChart3,
  Bot,
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
    to: '/admin/handovers',
    label: '离职交接',
    icon: ArrowRightLeft,
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
  { to: '/admin/assistant', label: 'AI 助手', icon: Bot, superOnly: true },
  { to: '/admin/settings', label: '系统设置', icon: Settings, superOnly: true },
  { to: '/admin/season-archive', label: '招生季归档', icon: Archive, superOnly: true },
];

function isActivePath(pathname, item) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export default function AdminSidebar({ onClose, compact = false }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const location = useLocation();
  const visibleNavItems = ADMIN_NAV_ITEMS.filter(
    (item) => (!item.superOnly || user?.is_super_admin) && canAccessAdminPage(user, item.permission),
  );

  const navClass = (active) =>
    `group flex min-h-10 rounded-lg border-l-2 font-medium transition ${compact ? 'flex-col justify-center gap-1 border-l-0 px-1 py-1.5 text-center text-[10px]' : 'items-center gap-3 px-3 text-sm'} ${
      active
        ? compact ? 'border-blue-100 bg-white/18 text-white shadow-sm' : 'border-indigo-400 bg-indigo-600 text-white shadow-sm'
        : compact ? 'border-transparent text-blue-100/75 hover:bg-white/10 hover:text-white' : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100'
    }`;

  return (
    <>
      <div className={`flex items-center justify-between border-b ${compact ? 'border-blue-500/50 px-2 py-4 dark:border-slate-700' : 'border-slate-800/90 px-5 py-5'}`}>
        <div className={`flex min-w-0 items-center ${compact ? 'w-full flex-col gap-1.5 text-center' : 'gap-3'}`}>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${compact ? 'bg-white/15' : 'bg-indigo-600 shadow-lg shadow-indigo-950/30'}`}>
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div className={`min-w-0 ${compact ? 'w-full' : ''}`}>
            <div className={`truncate font-bold tracking-wide text-white ${compact ? 'text-[10px]' : 'text-sm'}`}>
              招生话务 CRM
            </div>
            <div className={`mt-0.5 truncate font-medium ${compact ? 'text-[8px] text-blue-100/75' : 'text-[10px] text-slate-500'}`}>
              运营管理工作台
            </div>
          </div>
        </div>
        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="关闭导航"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className={`min-h-0 flex-1 space-y-1 overflow-y-auto scroll-thin ${compact ? 'p-1.5' : 'p-3'}`}>
        <div className={`${compact ? 'px-1 pb-2 pt-1 text-center text-[8px] text-blue-100/65' : 'px-3 pb-2 pt-1 text-[10px] text-slate-600'} font-bold uppercase tracking-[0.16em]`}>
          运营导航
        </div>
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(location.pathname, item);
          return (
            <Link key={item.to} to={item.to} onClick={onClose} className={navClass(active)}>
              <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-indigo-100' : compact ? 'text-blue-100/70 group-hover:text-white' : 'text-slate-500 group-hover:text-slate-200'}`} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={`space-y-3 border-t ${compact ? 'border-blue-500/50 bg-blue-900/25 p-2 dark:border-slate-700 dark:bg-slate-950/45' : 'border-slate-800/90 bg-slate-950/60 p-4'}`}>
        <div className={`flex items-center ${compact ? 'justify-center' : 'gap-3'}`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-indigo-400/30 bg-indigo-500/20 text-xs font-bold text-indigo-200">
            {(user?.name || 'A').substring(0, 1)}
          </div>
          <div className={`min-w-0 flex-1 ${compact ? 'hidden' : ''}`}>
            <div className="truncate text-xs font-semibold text-white">{user?.name || '系统管理员'}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500">{user?.role || 'admin'} · 在线</div>
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          className={`flex w-full items-center rounded-lg py-2 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 ${compact ? 'justify-center px-1' : 'gap-2 px-3'}`}
        >
          {dark ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4" />}
          {!compact && (dark ? '亮色模式' : '暗色模式')}
        </button>
        <button
          type="button"
          onClick={logout}
          className={`flex w-full items-center rounded-lg py-2 text-xs font-medium text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300 ${compact ? 'justify-center px-1' : 'gap-2 px-3'}`}
        >
          <LogOut className="h-4 w-4" />
          {!compact && '退出登录'}
        </button>
      </div>
    </>
  );
}
