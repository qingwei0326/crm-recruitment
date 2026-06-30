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
}) {
  return (
    <header
      className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 flex items-end justify-between pb-2"
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
            className="min-w-10 min-h-10 p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600"
            onClick={onMenuClick}
            aria-label="打开导航"
            style={{ touchAction: 'manipulation' }}
          >
            <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{title}</h1>
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
