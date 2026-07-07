import { useState } from 'react';
import { Moon, RefreshCcw, Sun } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';

export default function SmartAssignment() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="智能分配"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          <button type="button" onClick={toggle} aria-label={dark ? '亮色模式' : '暗色模式'}>
            {dark ? (
              <Sun className="h-5 w-5 text-amber-400" />
            ) : (
              <Moon className="h-5 w-5 text-gray-500" />
            )}
          </button>
        </PageHeader>
        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <RefreshCcw className="h-4 w-4 text-blue-600" />
              智能分配预览
            </div>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              根据未分配线索和坐席负载生成公平分配建议，确认后再执行。
            </p>
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
