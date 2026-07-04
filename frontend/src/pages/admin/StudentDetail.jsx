import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Phone,
  Loader2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';
import { useToast } from '../../components/Toast';
import StatusBadge from '../../components/StatusBadge';
import IntentLevelBadge from '../../components/IntentLevelBadge';
import StudentInfoCard from '../../components/StudentInfoCard';
import StudentTimeline from '../../components/StudentTimeline';
import AdmissionsFlowStrip from '../../components/admissions/AdmissionsFlowStrip';
import { formatDateTime, formatDuration, getApiErrorMessage } from '../../utils';

const ENROLLMENT_SUBSTAGES = ['定金待缴', '全款待缴', '已缴全款', '入学注册', '流失'];
const TABS = [
  { key: 'info', label: '基本信息' },
  { key: 'timeline', label: '完整时间线' },
  { key: 'intent', label: '意向轨迹' },
  { key: 'calls', label: '通话记录' },
];

const INTENT_TO_NUM = { A: 3, B: 2, C: 1, 无: 0 };
const NUM_TO_INTENT = { 3: 'A', 2: 'B', 1: 'C', 0: '无' };

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { dark } = useTheme();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [tab, setTab] = useState('info');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [substageSaving, setSubstageSaving] = useState(false);

  const isAdmin = user?.role === 'admin';

  const loadDetail = () => {
    setLoading(true);
    setError('');
    api
      .get(`/students/${id}/detail`)
      .then((res) => {
        setData(res.data.data || res.data);
      })
      .catch((e) => setError(getApiErrorMessage(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const student = data?.student;
  const calls = data?.calls || [];
  const notes = data?.notes || [];
  const followUps = data?.follow_ups || [];
  const visits = data?.visits || [];
  const intentTimeline = data?.intent_timeline || [];
  const admissionsTimeline = data?.admissions_timeline || [];

  const intentChartData = useMemo(() => {
    return intentTimeline.map((it) => {
      const lvl = it.intent_level || it.level || '无';
      return {
        date: formatDateTime(it.created_at || it.date),
        value: INTENT_TO_NUM[lvl] != null ? INTENT_TO_NUM[lvl] : 0,
        label: lvl,
        agent: it.agent_name || it.operator_name || '',
        source: it.source || 'ai',
      };
    });
  }, [intentTimeline]);

  const handleSubstageChange = async (value) => {
    setSubstageSaving(true);
    try {
      await api.put(`/students/${id}/enrollment-substage`, {
        enrollment_substage: value === '' ? null : value,
      });
      loadDetail();
    } catch (e) {
      toast?.error('更新报名后状态失败: ' + getApiErrorMessage(e));
    } finally {
      setSubstageSaving(false);
    }
  };

  const handleDial = async (contactKey = 'guardian') => {
    try {
      const res = await api.get(`/students/phone/${id}`);
      if (res.data.code !== 0) {
        toast?.error(res.data.msg || '获取电话失败');
        return;
      }
      const phone =
        contactKey === 'guardian2'
          ? res.data.data?.guardian2_phone || ''
          : res.data.data?.guardian_phone || '';
      if (!phone) {
        toast?.error('该联系人没有电话');
        return;
      }
      window.location.href = `tel:${phone}`;
    } catch (e) {
      toast?.error(getApiErrorMessage(e) || '获取电话失败');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-gray-900 px-4">
        <AlertTriangle className="w-10 h-10 text-red-500" />
        <div className="text-gray-600 dark:text-gray-300">{error || '未找到该学生'}</div>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
        >
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header
        className={`sticky top-0 z-10 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 flex gap-3 ${
          isMobile ? 'items-end pb-2' : 'h-14 items-center'
        }`}
        style={
          isMobile
            ? {
                paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                minHeight: 'calc(env(safe-area-inset-top, 0px) + 64px)',
              }
            : undefined
        }
      >
        <button
          onClick={() => navigate(-1)}
          className="inline-flex min-w-10 min-h-10 -ml-2 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="返回"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Link
          to="/admin/leads"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600"
        >
          学生管理
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{student.name}</h1>
          <StatusBadge status={student.status} />
          {student.status_detail && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300">
              {student.status === '无效' ? `原因：${student.status_detail}` : student.status_detail}
            </span>
          )}
          <IntentLevelBadge level={student.intent_level} />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
        {/* Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-x-auto">
          <div className="flex">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                  tab === t.key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tab === 'info' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-6 space-y-4">
            <StudentInfoCard student={student} onDial={handleDial} />
            <AdmissionsFlowStrip
              student={student}
              calls={calls}
              admissionsTimeline={admissionsTimeline}
            />

            {student.status === '已报名' && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2">
                <div className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  报名后状态
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    当前：
                    <b>{student.enrollment_substage || '未设置'}</b>
                  </span>
                  {isAdmin ? (
                    <select
                      value={student.enrollment_substage || ''}
                      onChange={(e) => handleSubstageChange(e.target.value)}
                      disabled={substageSaving}
                      className="px-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                    >
                      <option value="">(清空)</option>
                      {ENROLLMENT_SUBSTAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-400">仅管理员可修改</span>
                  )}
                  {substageSaving && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'timeline' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-6">
            <StudentTimeline
              student={student}
              calls={calls}
              notes={notes}
              followUps={followUps}
              visits={visits}
              intentTimeline={intentTimeline}
              admissionsTimeline={admissionsTimeline}
              emptyText="暂无记录"
            />
          </div>
        )}

        {tab === 'intent' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-6 space-y-4">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              意向变化趋势
            </div>
            {intentChartData.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">暂无意向轨迹</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={intentChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }}
                    />
                    <YAxis
                      domain={[0, 3]}
                      ticks={[0, 1, 2, 3]}
                      tickFormatter={(v) => NUM_TO_INTENT[v] || ''}
                      tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: dark ? '#1f2937' : '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        color: dark ? '#e5e7eb' : '#111827',
                      }}
                      formatter={(value) => [NUM_TO_INTENT[value] || '无', '意向等级']}
                    />
                    <Line
                      type="stepAfter"
                      dataKey="value"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>

                <div className="space-y-2">
                  {intentChartData.map((it, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 text-sm border-b border-gray-100 dark:border-gray-700 pb-2"
                    >
                      <IntentLevelBadge level={it.label} />
                      <span className="text-gray-700 dark:text-gray-300">{it.date}</span>
                      {it.agent && (
                        <span className="text-xs text-gray-400">
                          · {it.source === 'manual' ? `${it.agent}（手动）` : it.agent}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'calls' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 lg:p-6">
            {calls.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">暂无通话记录</div>
            ) : (
              <div className="space-y-4">
                {calls.map((c) => (
                  <div
                    key={c.id}
                    className="border dark:border-gray-700 rounded-lg p-4 space-y-2 bg-gray-50 dark:bg-gray-900/40"
                  >
                    <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
                      <Phone className="w-3.5 h-3.5 text-blue-500" />
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        {c.agent_name || '-'}
                      </span>
                      <span>· {formatDateTime(c.created_at || c.call_time)}</span>
                      <span>· 时长 {formatDuration(c.duration_seconds ?? c.duration)}</span>
                      {c.ai_confidence != null && (
                        <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">
                          <Sparkles className="w-3 h-3" />
                          置信度 {Math.round(c.ai_confidence * 100)}%
                        </span>
                      )}
                    </div>
                    {c.ai_summary && (
                      <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                        <div className="text-xs text-gray-400 mb-1">AI 摘要</div>
                        {c.ai_summary}
                      </div>
                    )}
                    {c.ai_reasons && (
                      <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                        <div className="text-xs text-gray-400 mb-1">判断依据</div>
                        {c.ai_reasons}
                      </div>
                    )}
                    {c.content && !c.ai_summary && (
                      <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                        {c.content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
