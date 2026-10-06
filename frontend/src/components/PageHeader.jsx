import { Menu } from 'lucide-react'

/**
 * Reusable sticky page header for admin pages.
 *
 * @param {string} title - Page title
 * @param {boolean} isMobile - Whether to show hamburger menu
 * @param {function} onMenuClick - Sidebar toggle handler
 * @param {React.ReactNode} children - Right-side actions (buttons, etc.)
 */
export default function PageHeader({
  title,
  isMobile,
  onMenuClick,
  children,
  actionsClassName = 'flex items-center gap-1',
  useSafeArea = true,
  light = false,
}) {
  return (
    <header
      className={`sticky top-0 z-10 flex items-end justify-between border-b px-4 pb-2 backdrop-blur ${light ? 'border-slate-200/90 bg-white/95' : 'border-slate-200/90 bg-white/95 dark:border-gray-700 dark:bg-gray-800/95'}`}
      style={
        useSafeArea && isMobile
          ? {
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
              minHeight: 'calc(env(safe-area-inset-top, 0px) + 64px)',
            }
          : { minHeight: '56px' }
      }
    >
      <div className="flex min-h-10 items-center gap-3">
        {isMobile && (
          <button
            type="button"
            className="-ml-2 min-h-10 min-w-10 rounded-lg p-2 hover:bg-slate-100 active:bg-slate-200 dark:hover:bg-gray-700 dark:active:bg-gray-600"
            onClick={onMenuClick}
            aria-label="打开导航"
            style={{ touchAction: 'manipulation' }}
          >
            <Menu className={`h-5 w-5 ${light ? 'text-slate-600' : 'text-slate-600 dark:text-gray-300'}`} />
          </button>
        )}
        <div className="min-w-0">
          <div className={`truncate text-3xs font-bold uppercase tracking-[0.14em] ${light ? 'text-indigo-600' : 'text-indigo-600 dark:text-indigo-300'}`}>
            招生运营 / 管理后台
          </div>
          <h1 className={`truncate text-lg font-bold leading-5 ${light ? 'text-slate-900' : 'text-slate-900 dark:text-gray-100'}`}>{title}</h1>
        </div>
      </div>
      {children && (
        <div
          className={`${actionsClassName} min-h-10 items-center [&>button]:inline-flex [&>button]:min-h-10 [&>button]:min-w-10 [&>button]:items-center [&>button]:justify-center`}
        >
          {children}
        </div>
      )}
    </header>
  )
}
