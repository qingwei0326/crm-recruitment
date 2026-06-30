import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, TrendingUp, Phone } from 'lucide-react';
import api from '../../api';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import useIsMobile from '../../hooks/useIsMobile';
import Report from './Report';
import TrendReport from './TrendReport';
import CallVolumeQuery from './CallVolumeQuery';
import { InsightStrip } from './AdminWorkflowComponents';
import { buildReportInsights } from './adminWorkflow';

const TABS = [
  { key: 'summary', label: '汇总报表', icon: BarChart3 },
  { key: 'trend', label: '趋势报表', icon: TrendingUp },
  { key: 'call-volume', label: '通电量查询', icon: Phone },
];

export default function ReportCenter() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [insightData, setInsightData] = useState({ trendData: null, ranking: [] });
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = useMemo(() => {
    const tab = searchParams.get('tab') || 'summary';
    return TABS.some((item) => item.key === tab) ? tab : 'summary';
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get('tab') !== currentTab) {
      setSearchParams({ tab: currentTab }, { replace: true });
    }
  }, [currentTab, searchParams, setSearchParams]);

  const selectTab = (key) => {
    setSearchParams({ tab: key });
  };

  useEffect(() => {
    Promise.allSettled([
      api.get('/stats/trend'),
      api.get('/stats/agent-ranking'),
    ]).then(([trendRes, rankingRes]) => {
      setInsightData({
        trendData: trendRes.status === 'fulfilled' ? trendRes.value.data.data : null,
        ranking:
          rankingRes.status === 'fulfilled'
            ? rankingRes.value.data.data?.ranking || []
            : [],
      });
    });
  }, []);

  const insights = useMemo(
    () => buildReportInsights(insightData),
    [insightData],
  );

  return (
    <AdminLayout
      isMobile={isMobile}
      sidebarOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
    >
      <main className="flex-1 min-w-0">
        <PageHeader
          title="报表中心"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-4">
          <InsightStrip items={insights} />

          <div className="flex gap-2 border-b dark:border-gray-700 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = currentTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {currentTab === 'summary' && <Report embedded />}
          {currentTab === 'trend' && <TrendReport embedded />}
          {currentTab === 'call-volume' && <CallVolumeQuery embedded />}
        </div>
      </main>
    </AdminLayout>
  );
}
