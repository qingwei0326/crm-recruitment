# Read-only admin shell contract

## Component signatures

- `AdminLayout({ isMobile, sidebarOpen, onClose, children })`
- `AdminSidebar({ onClose })`
- `PageHeader({ title, isMobile, onMenuClick, children, actionsClassName = 'flex items-center gap-1', useSafeArea = true })`

## Required AdminLayout behavior

- Always renders `children` exactly once.
- Renders `AdminSidebar` inside a 240px desktop sidebar.
- On mobile, `sidebarOpen` controls the slide-in sidebar and backdrop.
- Clicking the mobile backdrop calls `onClose`.

## Required AdminSidebar behavior

- Keep `ADMIN_NAV_ITEMS` exported.
- Keep all existing labels, paths, order, icons, `permission`, `superOnly`, and `end` values unchanged.
- Filter items with `(!item.superOnly || user?.is_super_admin) && canAccessAdminPage(user, item.permission)`.
- Keep active-route matching for exact dashboard and nested paths.
- Keep `useAuth()` user/logout behavior, `useTheme()` dark/toggle behavior, and mobile close behavior.
- Keep accessible names `关闭导航`, `亮色模式` or `暗色模式`, and `退出登录`.

## Required PageHeader behavior

- Preserve the title, optional mobile menu button, right-side `children`, `actionsClassName`, and `useSafeArea` behavior.
- Keep mobile menu accessible name `打开导航`.
- Keep minimum 40px touch targets and mobile safe-area padding.

## Read-only project facts

- Tailwind uses `darkMode: 'class'`. Shared tokens live in `tailwind.config.js` (read-only): `bg-surface-page`, `text-3xs` (10px), `text-2xs` (11px), `shadow-panel`, `shadow-panel-dark`. Use these instead of arbitrary values like `text-[11px]` or `bg-[#f5f7fb]`.
- Routes and page permissions are enforced outside these components and must not move into them.
- The screenshot is a visual reference only; text and numbers in it are not source data.
