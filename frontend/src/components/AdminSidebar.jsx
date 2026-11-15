import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  Archive,
  BarChart3,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
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
  ShieldCheck,
  Sun,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useIsMobile from '../hooks/useIsMobile';
import { ADMIN_PAGE_PERMISSIONS, canAccessAdminPage } from '../adminPermissions';

// Grouped by what an admin is doing, in the order of a working day.
export const ADMIN_NAV_GROUPS = [
  {
    title: '今日',
    items: [
      { to: '/admin', label: '仪表盘', icon: LayoutDashboard, end: true },
      {
        to: '/admin/work-center',
        label: '工作中心',
        icon: CalendarClock,
        permission: ADMIN_PAGE_PERMISSIONS.workCenter,
      },
    ],
  },
  {
    title: '线索',
    items: [
      {
        to: '/admin/leads',
        label: '学生管理',
        icon: ListFilter,
        permission: ADMIN_PAGE_PERMISSIONS.leadsManage,
      },
      {
        to: '/admin/search',
        label: '全局搜索',
        icon: Search,
        permission: ADMIN_PAGE_PERMISSIONS.leadsManage,
      },
      {
        to: '/admin/governance',
        label: '线索治理',
        icon: ShieldCheck,
        permission: ADMIN_PAGE_PERMISSIONS.leadGovernance,
      },
    ],
  },
  {
    title: '招生流程',
    items: [
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
    ],
  },
  {
    title: '团队',
    items: [
      {
        to: '/admin/agents',
        label: '账号管理',
        icon: Users,
        permission: ADMIN_PAGE_PERMISSIONS.accountManage,
      },
      {
        to: '/admin/handovers',
        label: '离职交接',
        icon: UserMinus,
        permission: ADMIN_PAGE_PERMISSIONS.accountManage,
      },
      {
        to: '/admin/score-preview',
        label: '评分预览',
        icon: Gauge,
        permission: ADMIN_PAGE_PERMISSIONS.scorePreview,
      },
    ],
  },
  {
    title: '数据',
    items: [
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
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/admin/settings', label: '系统设置', icon: Settings, superOnly: true },
      { to: '/admin/season-archive', label: '招生季归档', icon: Archive, superOnly: true },
    ],
  },
];

export const ADMIN_NAV_ITEMS = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

function isActivePath(pathname, item) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

const iconButtonClass =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100';

export default function AdminSidebar({ onClose, collapsed = false, onToggleCollapse }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const location = useLocation();
  const canSee = (item) =>
    (!item.superOnly || user?.is_super_admin) && canAccessAdminPage(user, item.permission);
  const groups = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);
  const themeLabel = dark ? '亮色模式' : '暗色模式';
  const canCollapse = !isMobile && Boolean(onToggleCollapse);
  const collapseButton = (
    <button
      type="button"
      onClick={onToggleCollapse}
      className={iconButtonClass}
      aria-label={collapsed ? '展开导航' : '收起导航'}
      title={collapsed ? '展开导航' : '收起导航'}
    >
      {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
    </button>
  );

  return (
    <>
      <div
        className={`flex h-14 shrink-0 items-center border-b border-slate-200 dark:border-slate-800 ${collapsed ? 'justify-center px-2' : 'gap-2.5 pl-4 pr-2'}`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-slate-100">
            招生话务 CRM
          </div>
        )}
        {canCollapse && !collapsed && collapseButton}
        {isMobile && (
          <button type="button" onClick={onClose} className={iconButtonClass} aria-label="关闭导航">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav
        aria-label="管理后台导航"
        className={`min-h-0 flex-1 overflow-y-auto scroll-thin ${collapsed ? 'px-2 py-2' : 'px-3 py-2'}`}
      >
        {groups.map((group, index) => (
          <div key={group.title} className={index > 0 ? (collapsed ? 'mt-2 border-t border-slate-200 pt-2 dark:border-slate-800' : 'mt-3') : ''}>
            {!collapsed && (
              <div className="px-3 pb-1 text-2xs font-semibold tracking-wide text-slate-400 dark:text-slate-500">
                {group.title}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(location.pathname, item);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`group flex h-[34px] items-center rounded-lg text-sm transition ${collapsed ? 'justify-center' : 'gap-3 px-3'} ${
                      active
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-blue-600 dark:text-blue-300' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'}`}
                      aria-hidden="true"
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div
        className={`shrink-0 border-t border-slate-200 dark:border-slate-800 ${collapsed ? 'flex flex-col items-center gap-1 p-2' : 'flex items-center gap-1 px-3 py-2'}`}
      >
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 pl-1">
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                {user?.name || '管理员'}
              </div>
              <div className="truncate text-2xs text-slate-400 dark:text-slate-500">
                {user?.is_super_admin ? '超级管理员' : '管理员'}
              </div>
            </div>
          </>
        )}
        <button type="button" onClick={toggle} className={iconButtonClass} aria-label={themeLabel} title={themeLabel}>
          {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={logout}
          className={`${iconButtonClass} hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-300`}
          aria-label="退出登录"
          title="退出登录"
        >
          <LogOut className="h-4 w-4" />
        </button>
        {canCollapse && collapsed && collapseButton}
      </div>
    </>
  );
}
