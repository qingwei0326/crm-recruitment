import { Target, BarChart3, Plus, Sun, Moon, LogOut, X, Settings } from 'lucide-react';
// Note: Settings icon is from lucide-react

export default function AgentSidebar({
  viewTab, onTabChange, onAddStudent, onShowSettings,
  dark, onToggleTheme, onLogout, isMobile, onCloseMenu,
}) {
  return (
    <>
      {isMobile && (
        <div className="flex items-center justify-between px-4 h-14 border-b dark:border-gray-700">
          <span className="font-semibold text-gray-800 dark:text-gray-100">菜单</span>
          <button
            onClick={onCloseMenu}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      )}
      <div className="p-3 space-y-1">
        <button
          onClick={() => { onCloseMenu?.(); onTabChange('today'); }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
            viewTab === 'today'
              ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <Target className="w-4 h-4" /> 今日任务
        </button>
        <button
          onClick={() => { onCloseMenu?.(); onTabChange('following'); }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${
            viewTab === 'following'
              ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> 跟进中
        </button>
        <button
          onClick={() => { onCloseMenu?.(); onAddStudent(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Plus className="w-4 h-4" /> 添加学生
        </button>
      </div>
      <div className="mt-auto p-3 border-t dark:border-gray-700 space-y-1">
        <button
          onClick={onToggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {dark ? '浅色模式' : '深色模式'}
        </button>
        <button
          onClick={onShowSettings}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Settings className="w-4 h-4" /> 推送设置
        </button>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <LogOut className="w-4 h-4" /> 退出登录
        </button>
      </div>
    </>
  );
}
