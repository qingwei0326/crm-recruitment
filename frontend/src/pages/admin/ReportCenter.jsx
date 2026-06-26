import { useState } from 'react';
import { BarChart3, TrendingUp, Phone } from 'lucide-react';
import Report from './Report';
import TrendReport from './TrendReport';
import CallVolumeQuery from './CallVolumeQuery';

const TABS = [
  { key: 'summary', label: '汇总报表', icon: BarChart3 },
  { key: 'trend', label: '趋势报表', icon: TrendingUp },
  { key: 'callVolume', label: '通电量查询', icon: Phone },
];

export default function ReportCenter() {
  const [tab, setTab] = useState('summary');

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b dark:border-gray-700 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'summary' && <Report />}
      {tab === 'trend' && <TrendReport />}
      {tab === 'callVolume' && <CallVolumeQuery />}
    </div>
  );
}
