import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import api from '../../api';
import useLatestRef from '../../hooks/useLatestRef';
import { useToast } from '../../components/Toast';
import { formatDateTime, getApiErrorMessage } from '../../utils';
import LeadsEnrollmentModal from './leads/LeadsEnrollmentModal';

const FINANCE_FIELDS = [
  'tuition_list_amount',
  'student_subsidy_amount',
  'student_paid_amount',
  'external_subsidy_amount',
  'commission_base_amount',
  'commission_subsidy_amount',
];

function emptyForm(report) {
  return {
    enrolled_program: report.enrolled_program || '',
    amount: '',
    enrolled_at: '',
    ...Object.fromEntries(FINANCE_FIELDS.map((field) => [field, ''])),
  };
}

function confirmPayload(form) {
  const payload = { enrolled_program: form.enrolled_program.trim() };
  ['amount', ...FINANCE_FIELDS].forEach((field) => {
    if (form[field] !== '' && form[field] != null) payload[field] = Number(form[field]);
  });
  if (form.enrolled_at) payload.enrolled_at = `${form.enrolled_at}T00:00:00`;
  return payload;
}

// Agents' 报名 reports waiting for an admin: confirming one registers the enrollment
// (and its settlement record); rejecting keeps the reason on the report.
export default function PendingEnrollmentReports({ onConfirmed }) {
  const toast = useToast();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [form, setForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/admissions/enrollment-reports', { params: { status: '待确认' } });
      setReports(res.data?.data?.list || []);
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadRef = useLatestRef(load);
  useEffect(() => {
    loadRef.current();
  }, [loadRef]);

  const startConfirm = (report) => {
    setConfirming(report);
    setForm(emptyForm(report));
  };

  const submitConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await api.post(
        `/admissions/enrollment-reports/${confirming.id}/confirm`,
        confirmPayload(form),
      );
      if (res.data?.code !== 0) {
        toast?.error(res.data?.msg || '确认失败');
        return;
      }
      toast?.success('已确认报名并生成结算依据');
      setConfirming(null);
      await load();
      onConfirmed?.();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReject = async (report) => {
    setSubmitting(true);
    try {
      const res = await api.post(`/admissions/enrollment-reports/${report.id}/reject`, {
        reason: rejectReason.trim(),
      });
      if (res.data?.code !== 0) {
        toast?.error(res.data?.msg || '驳回失败');
        return;
      }
      toast?.success('已驳回');
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <section className="flex items-center gap-2 rounded-lg border bg-white px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        <Loader2 className="h-4 w-4 animate-spin" />加载话务员上报...
      </section>
    );
  }
  if (reports.length === 0) return null;

  return (
    <section
      aria-label="待确认报名"
      className="rounded-lg border border-green-200 bg-white px-4 py-3 dark:border-green-900/50 dark:bg-gray-800"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <BadgeCheck className="h-4 w-4 text-green-600" />
        待确认报名 {reports.length} 条
      </h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        话务员上报的报名，确认后才生成报名记录和结算依据。
      </p>
      <ul className="mt-3 divide-y dark:divide-gray-700">
        {reports.map((report) => (
          <li key={report.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {report.student_name}
                <span className="ml-2 text-green-700 dark:text-green-300">{report.enrolled_program || '未填专业'}</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {report.region || '-'} · {report.school_name || '-'} · {report.reporter_name} 上报于 {formatDateTime(report.created_at)}
              </div>
              {report.notes && (
                <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{report.notes}</div>
              )}
            </div>
            {rejecting === report.id ? (
              <div className="flex gap-2">
                <input
                  aria-label={`驳回原因 ${report.id}`}
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
                  placeholder="驳回原因"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitReject(report)}
                  className="rounded-lg bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  确定驳回
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(null)}
                  className="rounded-lg border px-3 py-1 text-sm dark:border-gray-600"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startConfirm(report)}
                  className="rounded-lg bg-green-600 px-3 py-1 text-sm text-white"
                  aria-label={`确认报名 ${report.student_name}`}
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => { setRejecting(report.id); setRejectReason(''); }}
                  className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600 dark:border-red-800"
                  aria-label={`驳回上报 ${report.student_name}`}
                >
                  驳回
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {confirming && form && (
        <LeadsEnrollmentModal
          student={{
            name: confirming.student_name,
            region: confirming.region,
            assigned_to: confirming.assigned_to,
          }}
          form={form}
          agentName={confirming.reporter_name}
          submitting={submitting}
          onClose={() => setConfirming(null)}
          onFieldChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
          onSubmit={submitConfirm}
        />
      )}
    </section>
  );
}
