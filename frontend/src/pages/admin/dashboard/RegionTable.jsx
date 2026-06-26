import { MapPin } from 'lucide-react';

export default function RegionTable({ stats, loading }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
      <div className="px-4 py-4 border-b dark:border-gray-700">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <MapPin className="w-4 h-4" /> 各地域转化率
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[400px]">
          <thead>
            <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-400">
              <th className="px-3 py-3 font-medium">地域</th>
              <th className="px-3 py-3 font-medium text-center">学生总数</th>
              <th className="px-3 py-3 font-medium text-center">有意向</th>
              <th className="px-3 py-3 font-medium text-center">A级数</th>
              <th className="px-3 py-3 font-medium text-center">转化率</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-400">加载中...</td>
              </tr>
            ) : stats.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-400">暂无数据</td>
              </tr>
            ) : (
              stats.map((s, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-3 py-3 font-medium text-gray-900 dark:text-gray-100">{s.source}</td>
                  <td className="px-3 py-3 text-center">{s.total}</td>
                  <td className="px-3 py-3 text-center">{s.contacted}</td>
                  <td className="px-3 py-3 text-center">{s.a_count}</td>
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.conversion_rate >= 50 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : s.conversion_rate >= 20 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
                    >
                      {s.conversion_rate}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
