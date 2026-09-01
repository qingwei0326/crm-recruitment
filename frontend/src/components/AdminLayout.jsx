import AdminSidebar from './AdminSidebar';

export default function AdminLayout({ isMobile, sidebarOpen, onClose, children }) {
  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-gray-950">
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`${isMobile ? 'fixed inset-y-0 left-0 z-50 w-72 max-w-[86vw] shadow-2xl transition-transform ' + (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : 'relative'} flex shrink-0 flex-col bg-slate-950 text-white ${isMobile ? '' : 'w-64'}`}
      >
        <AdminSidebar onClose={onClose} />
      </aside>
      {children}
    </div>
  );
}
