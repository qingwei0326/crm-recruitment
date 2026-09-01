import { Target, CalendarClock, BarChart3, Plus, Sun, Moon, LogOut, X, Settings } from 'lucide-react';
// Note: Settings icon is from lucide-react

export default function AgentSidebar({
  viewTab, onTabChange, onAddStudent, onShowSettings,
  dark, onToggleTheme, onLogout, isMobile, onCloseMenu,
}) {
  return (
    <>
      {isMobile && (
        <div className="flex h-16 items-center justify-between border-b border-slate-800/90 px-5">
          <div>
            <div className="text-sm font-bold tracking-wide text-white">话务执行中心</div>
            <div className="mt-0.5 text-[10px] font-medium text-slate-500">运营工作台</div>
          </div>
          <button
            onClick={onCloseMenu}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="关闭导航"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="space-y-1 p-3">
        <div className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
          执行导航
        </div>
        <button
          onClick={() => { onCloseMenu?.(); onTabChange('today'); }}
          className={`group flex min-h-10 w-full items-center gap-3 rounded-lg border-l-2 px-3 text-sm font-medium transition ${
            viewTab === 'today'
              ? 'border-emerald-400 bg-emerald-600 text-white shadow-sm'
              : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100'
          }`}
        >
          <Target className={`h-4 w-4 ${viewTab === 'today' ? 'text-emerald-100' : 'text-slate-500 group-hover:text-slate-200'}`} />
          待拨打
        </button>
        <button
          onClick={() => { onCloseMenu?.(); onTabChange('handled'); }}
          className={`group flex min-h-10 w-full items-center gap-3 rounded-lg border-l-2 px-3 text-sm font-medium transition ${
            viewTab === 'handled'
              ? 'border-emerald-400 bg-emerald-600 text-white shadow-sm'
              : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100'
          }`}
        >
          <CalendarClock className={`h-4 w-4 ${viewTab === 'handled' ? 'text-emerald-100' : 'text-slate-500 group-hover:text-slate-200'}`} />
          待处理
        </button>
        <button
          onClick={() => { onCloseMenu?.(); onTabChange('following'); }}
          className={`group flex min-h-10 w-full items-center gap-3 rounded-lg border-l-2 px-3 text-sm font-medium transition ${
            viewTab === 'following'
              ? 'border-emerald-400 bg-emerald-600 text-white shadow-sm'
              : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100'
          }`}
        >
          <BarChart3 className={`h-4 w-4 ${viewTab === 'following' ? 'text-emerald-100' : 'text-slate-500 group-hover:text-slate-200'}`} />
          跟进中
        </button>
        <button
          onClick={() => { onCloseMenu?.(); onAddStudent(); }}
          className="group flex min-h-10 w-full items-center gap-3 rounded-lg border-l-2 border-transparent px-3 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          <Plus className="h-4 w-4 text-slate-500 group-hover:text-slate-200" />
          添加学生
        </button>
      </div>
      <div className="mt-auto space-y-1 border-t border-slate-800/90 bg-slate-950/60 p-4">
        <button
          onClick={onToggleTheme}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          {dark ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4" />}
          {dark ? '浅色模式' : '深色模式'}
        </button>
        <button
          onClick={() => { onCloseMenu?.(); onShowSettings(); }}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        >
          <Settings className="h-4 w-4" />
          推送设置
        </button>
        <button
          onClick={onLogout}
          className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-xs font-medium text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </>
  );
}
