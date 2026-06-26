import { Link } from 'react-router-dom';
import { Users, PhoneCall, TrendingUp, BarChart3 } from 'lucide-react';

const CARDS = [
  { label: '学生总数', key: 'totalStudents', icon: Users, color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', link: '/admin/leads' },
  { label: '有意向', key: 'contacted', icon: PhoneCall, color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400', link: '/admin/leads' },
  { label: 'A 级意向', key: 'totalA', icon: TrendingUp, color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400', link: '/admin/leads?intent=A' },
  { label: '今日呼出', key: 'todayCalls', icon: BarChart3, color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', link: '/admin/leads' },
];

export default function StatCards({ totalStudents, contacted, totalA, todayCalls, loading }) {
  const values = { totalStudents, contacted, totalA, todayCalls };
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {CARDS.map((s, i) => (
        <Link
          to={s.link}
          key={i}
          className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-5 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? '-' : values[s.key]}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{s.label}</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
