import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ListFilter, Menu, RefreshCcw, School, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import AdminLayout from '../../components/AdminLayout';

const workflows = [
  {
    title: '学生管理与分配',
    description: '新增、筛选、批量选择线索，并进行手动分配、自动分配和学校分发。',
    to: '/admin/leads',
    icon: ListFilter,
    tone: 'blue',
  },
  {
    title: '无效线索回收',
    description: '按学校汇总无效线索，批量回收后重新进入未分配池。',
    to: '/admin/invalid-reclaim',
    icon: RefreshCcw,
    tone: 'red',
  },
  {
    title: '多学校分发',
    description: '按学校批量选择未分配学员，自动均摊或指定分发给话务员。',
    to: '/admin/distribute',
    icon: School,
    tone: 'green',
  },
];

const toneClasses = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

export default function LeadGovernance() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                type="button"
                className="p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            )}
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">线索治理</h1>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {dark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-gray-500" />}
          </button>
        </header>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm p-4 lg:p-5">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              统一处理线索分配、无效回收和学校分发。
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {workflows.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm p-5 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${toneClasses[item.tone]}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {item.title}
                        </h2>
                        <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </AdminLayout>
  );
}
