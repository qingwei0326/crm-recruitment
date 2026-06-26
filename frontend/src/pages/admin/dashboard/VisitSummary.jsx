import { MapPin, Home, Calendar } from 'lucide-react';

export default function VisitSummary({ data }) {
  if (!data) return null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm">
      <div className="px-4 py-4 border-b dark:border-gray-700">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <MapPin className="w-4 h-4" /> 到访汇总
        </h3>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {(data.by_type?.['来校参观'] || 0) + (data.by_type?.['家访'] || 0)}
            </div>
            <div className="text-xs text-gray-500">到访总数</div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{data.by_type?.['来校参观'] || 0}</div>
            <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
              <Home className="w-3 h-3" /> 来校参观
            </div>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{data.by_type?.['家访'] || 0}</div>
            <div className="text-xs text-gray-500">
              <MapPin className="w-3 h-3 inline" /> 家访
            </div>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-600">{data.by_status?.['待确认'] || 0}</div>
            <div className="text-xs text-gray-500">待确认</div>
          </div>
        </div>
        {data.upcoming?.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> 近期到访安排
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {data.upcoming.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${v.visit_type === '来校参观' ? 'bg-green-500' : 'bg-amber-500'}`} />
                  <span className="font-medium">{v.student_name}</span>
                  <span className="text-xs text-gray-500">{v.visit_type}</span>
                  <span className="ml-auto text-xs text-gray-400">{v.scheduled_date?.split('T')[0]}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${v.status === '已确认' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {v.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
