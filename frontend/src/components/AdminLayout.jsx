import { useState } from 'react';
import AdminSidebar from './AdminSidebar';

const COLLAPSED_KEY = 'crm:admin-nav-collapsed';
// On a small laptop the labelled sidebar takes too much from the tables, and the
// full menu is taller than the screen. Start with icons only there.
const AUTO_COLLAPSE_BELOW_WIDTH = 1360;
const AUTO_COLLAPSE_BELOW_HEIGHT = 800;

function readCollapsed() {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // Storage can be blocked; fall back to the width rule.
  }
  if (typeof window === 'undefined') return false;
  return (
    window.innerWidth < AUTO_COLLAPSE_BELOW_WIDTH || window.innerHeight < AUTO_COLLAPSE_BELOW_HEIGHT
  );
}

export default function AdminLayout({ isMobile, sidebarOpen, onClose, children }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, current ? '0' : '1');
      } catch {
        // The choice just won't be remembered.
      }
      return !current;
    });
  };
  const showCollapsed = collapsed && !isMobile;
  const placement = isMobile
    ? `fixed inset-y-0 left-0 z-50 w-72 max-w-[86vw] shadow-2xl transition-transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
    : `sticky top-0 h-screen border-r border-slate-200 dark:border-slate-800 ${showCollapsed ? 'w-14' : 'w-52'}`;

  return (
    <div className="flex min-h-screen bg-surface-page dark:bg-gray-950">
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside className={`${placement} flex shrink-0 flex-col bg-white dark:bg-slate-900`}>
        <AdminSidebar onClose={onClose} collapsed={showCollapsed} onToggleCollapse={toggleCollapsed} />
      </aside>
      {children}
    </div>
  );
}
