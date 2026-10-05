import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { createIdempotencyKey } from '../../domain/handover';
import useIsMobile from '../../hooks/useIsMobile';
import {
  useActiveHandoverAgents,
  useExecuteHandoverTransfer,
  useHandoverDetail,
  useHandoverList,
  usePreviewHandoverTransfer,
} from '../../hooks/useHandovers';
import { getApiErrorMessage } from '../../utils';
import HandoverBatchDetail from './handover/HandoverBatchDetail';
import HandoverBatchList from './handover/HandoverBatchList';
import TransferPreviewDialog from './handover/TransferPreviewDialog';

const FILTER_KEYS = ['status', 'region', 'school', 'intent', 'kind', 'overdue', 'q'];

function filterValues(searchParams) {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) || '']));
}

export default function HandoverCenter() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const values = filterValues(searchParams);
  const page = Math.max(Number(searchParams.get('page')) || 1, 1);

  const listQuery = useHandoverList({ page: 1, page_size: 200 });
  const requestedBatchId = Number(searchParams.get('batch')) || 0;
  const batchId = requestedBatchId || listQuery.data?.list?.[0]?.id || 0;
  // searchParams 由 useSearchParams 按 location.search 记忆化，引用稳定；
  // 这里直接读 searchParams 而不是每次渲染新建的 values，避免 filters 反复重建。
  const detailFilters = useMemo(() => {
    const filters = { page, page_size: 50 };
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (!value) continue;
      filters[key] = key === 'overdue' ? value === 'true' : value;
    }
    return filters;
  }, [page, searchParams]);
  const detailQuery = useHandoverDetail(batchId, detailFilters);
  const agentsQuery = useActiveHandoverAgents();
  const previewMutation = usePreviewHandoverTransfer();
  const executeMutation = useExecuteHandoverTransfer();

  const [targetState, setTargetState] = useState({ batchId: 0, value: '' });
  const targetAgentId = targetState.batchId === batchId ? targetState.value : '';
  const selectionScope = `${batchId}:${FILTER_KEYS.map((key) => values[key]).join('|')}:${page}`;
  const [selectionState, setSelectionState] = useState({ scope: '', ids: new Set() });
  const selected = selectionState.scope === selectionScope ? selectionState.ids : new Set();
  const [previewState, setPreviewState] = useState(null);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [conflictMessage, setConflictMessage] = useState('');
  const [resultNotice, setResultNotice] = useState(null);

  const currentBatch = detailQuery.data?.batch;
  const targetAgents = (agentsQuery.data || []).filter(
    (agent) => agent.id !== currentBatch?.sourceAgent?.id,
  );
  const targetAgent = targetAgents.find((agent) => String(agent.id) === String(targetAgentId));

  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value == null) next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next);
  };

  const selectBatch = (id) => {
    setConflictMessage('');
    setResultNotice(null);
    updateParams({ batch: id, page: 1 });
  };

  const changeFilter = (key, value) => {
    setConflictMessage('');
    updateParams({ [key]: value, page: 1 });
  };

  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    FILTER_KEYS.forEach((key) => next.delete(key));
    next.delete('page');
    setSearchParams(next);
    setConflictMessage('');
  };

  const setSelectedIds = (updater) => {
    setSelectionState((previous) => {
      const base = previous.scope === selectionScope ? previous.ids : new Set();
      return { scope: selectionScope, ids: updater(new Set(base)) };
    });
  };

  const toggleStudent = (studentId) => {
    setSelectedIds((next) => {
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleAll = () => {
    const selectableIds = (detailQuery.data?.items || [])
      .filter((item) => item.handoverStatus === 'pending')
      .map((item) => item.studentId);
    setSelectedIds((next) => {
      if (selectableIds.every((id) => next.has(id))) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const openPreview = async (mode) => {
    if (!batchId || !targetAgent) return;
    const studentIds = mode === 'selected' ? [...selected] : [];
    if (mode === 'selected' && studentIds.length === 0) return;
    setConflictMessage('');
    setPreviewError('');
    try {
      const preview = await previewMutation.mutateAsync({ batchId, mode, studentIds });
      const selectedStudents = mode === 'selected'
        ? (detailQuery.data?.items || []).filter((item) => selected.has(item.studentId))
        : [];
      const request = {
        batchId,
        targetAgentId: Number(targetAgent.id),
        mode,
        studentIds,
        expectedVersion: preview.version,
        idempotencyKey: createIdempotencyKey(batchId),
      };
      setPendingRequest(request);
      setPreviewState({ ...preview, students: selectedStudents });
    } catch (error) {
      toast?.error(getApiErrorMessage(error));
    }
  };

  const closePreview = () => {
    if (executeMutation.isPending) return;
    setPreviewState(null);
    setPendingRequest(null);
    setPreviewError('');
  };

  const executeTransfer = async () => {
    if (!pendingRequest) return;
    setPreviewError('');
    try {
      const result = await executeMutation.mutateAsync(pendingRequest);
      setSelectionState({ scope: selectionScope, ids: new Set() });
      setPreviewState(null);
      setPendingRequest(null);
      setResultNotice({
        transferId: result.transferId,
        message: `交接完成 ${result.transferredIds.length} 条，跳过 ${result.skippedIds.length} 条${result.completed ? '，批次已完成' : ''}`,
      });
      toast?.success(result.completed ? '全部剩余学生已接手' : '所选学生已转派');
    } catch (error) {
      if (error.response?.status === 409) {
        setPreviewState(null);
        setPendingRequest(null);
        setSelectionState({ scope: selectionScope, ids: new Set() });
        setConflictMessage('交接数据已变化，请重新确认');
        await Promise.all([detailQuery.refetch(), listQuery.refetch()]);
        return;
      }
      if (!error.response) {
        setPreviewError('网络结果未知，重试将继续使用同一个请求，不会重复交接。');
        return;
      }
      setPreviewError(getApiErrorMessage(error));
    }
  };

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main className="min-w-0 flex-1 lg:h-screen lg:overflow-hidden">
        <PageHeader title="离职交接" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
          <button
            type="button"
            title="刷新交接数据"
            aria-label="刷新交接数据"
            aria-busy={listQuery.isFetching || detailQuery.isFetching}
            onClick={() => Promise.all([listQuery.refetch(), detailQuery.refetch()])}
            className="rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <RefreshCw
              className={`h-4 w-4 ${listQuery.isFetching || detailQuery.isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
        </PageHeader>

        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 bg-white dark:bg-gray-900 lg:h-[calc(100dvh-56px)] lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden lg:border-x lg:border-gray-200 dark:lg:border-gray-800">
          <aside className="flex min-w-0 flex-col border-b border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/60 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2.5 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">
              <span>交接批次</span>
              {listQuery.data && (
                <span className="rounded-md bg-gray-200 px-1.5 py-0.5 font-mono text-2xs font-medium tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {listQuery.data.total}
                </span>
              )}
            </div>
            <div className="max-h-[240px] min-h-0 overflow-y-auto overscroll-contain lg:max-h-none lg:flex-1">
              <HandoverBatchList
                batches={listQuery.data?.list || []}
                selectedId={batchId}
                loading={listQuery.isLoading}
                error={listQuery.isError}
                onSelect={selectBatch}
                onRetry={listQuery.refetch}
              />
            </div>
          </aside>

          <div className="min-w-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain">
            <HandoverBatchDetail
              batchId={batchId}
              detail={detailQuery.data}
              loading={detailQuery.isLoading}
              error={detailQuery.isError}
              conflictMessage={conflictMessage}
              resultNotice={resultNotice}
              filterValues={values}
              onFilterChange={changeFilter}
              onFilterReset={resetFilters}
              onRetry={detailQuery.refetch}
              selected={selected}
              onToggle={toggleStudent}
              onToggleAll={toggleAll}
              targetAgentId={targetAgentId}
              onTargetAgentChange={(value) => setTargetState({ batchId, value })}
              targetAgents={targetAgents}
              previewing={previewMutation.isPending}
              onPreviewSelected={() => openPreview('selected')}
              onPreviewAll={() => openPreview('all_remaining')}
              canTransferAll={Boolean(user?.is_super_admin)}
              onPageChange={(nextPage) => updateParams({ page: nextPage })}
            />
          </div>
        </div>
      </main>

      <TransferPreviewDialog
        preview={previewState}
        mode={pendingRequest?.mode}
        targetAgent={targetAgent}
        submitting={executeMutation.isPending}
        error={previewError}
        onCancel={closePreview}
        onConfirm={executeTransfer}
      />
    </AdminLayout>
  );
}
