function nonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.trunc(numeric);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function textList(value) {
  return list(value).filter((item) => typeof item === 'string');
}

export function normalizeHandoverBatch(value = {}) {
  const source = value?.source_agent || {};
  return {
    id: nonNegativeInteger(value?.id),
    sourceAgent: {
      id: nonNegativeInteger(source.id),
      name: text(source.name),
    },
    status: text(value?.status),
    version: nonNegativeInteger(value?.version),
    total: nonNegativeInteger(value?.total_items),
    remaining: nonNegativeInteger(value?.remaining_items),
    transferred: nonNegativeInteger(value?.transferred_items),
    initiatedAt: value?.initiated_at ?? null,
  };
}

export function normalizeHandoverList(value = {}) {
  return {
    total: nonNegativeInteger(value?.total),
    page: Math.max(nonNegativeInteger(value?.page), 1),
    pageSize: nonNegativeInteger(value?.page_size),
    list: list(value?.list).map(normalizeHandoverBatch),
  };
}

export function normalizeHandoverItem(value = {}) {
  return {
    id: nonNegativeInteger(value?.id),
    studentId: nonNegativeInteger(value?.student_id),
    name: text(value?.name),
    caseNo: text(value?.case_no),
    schoolName: text(value?.school_name),
    region: text(value?.region),
    status: text(value?.status),
    statusDetail: text(value?.status_detail),
    intentLevel: text(value?.intent_level),
    stage: text(value?.stage),
    needHelp: Boolean(value?.need_help),
    assignedTo: value?.assigned_to == null ? null : nonNegativeInteger(value.assigned_to),
    handoverStatus: text(value?.handover_status),
    targetAgentId:
      value?.target_agent_id == null ? null : nonNegativeInteger(value.target_agent_id),
    transferId: value?.transfer_id == null ? null : nonNegativeInteger(value.transfer_id),
    transferredAt: value?.transferred_at ?? null,
    overdue: Boolean(value?.overdue),
    workItemKinds: textList(value?.work_item_kinds),
    openWorkItemCount: nonNegativeInteger(value?.open_work_item_count),
  };
}

export function normalizeHandoverDetail(value = {}) {
  const options = value?.filter_options || {};
  return {
    batch: normalizeHandoverBatch(value?.batch),
    total: nonNegativeInteger(value?.total),
    page: Math.max(nonNegativeInteger(value?.page), 1),
    pageSize: nonNegativeInteger(value?.page_size),
    items: list(value?.items).map(normalizeHandoverItem),
    filterOptions: {
      regions: textList(options.regions),
      schools: textList(options.schools),
      intents: textList(options.intents),
      kinds: textList(options.kinds),
    },
  };
}

export function normalizeHandoverPreview(value = {}) {
  const byKind = value?.by_kind;
  return {
    batchId: nonNegativeInteger(value?.batch_id),
    version: nonNegativeInteger(value?.version),
    mode: text(value?.mode),
    selectedCount: nonNegativeInteger(value?.selected_count),
    openWorkItemCount: nonNegativeInteger(value?.open_work_item_count),
    overdueCount: nonNegativeInteger(value?.overdue_count),
    highIntentCount: nonNegativeInteger(value?.high_intent_count),
    byKind: byKind && typeof byKind === 'object' && !Array.isArray(byKind) ? { ...byKind } : {},
  };
}

export function normalizeTransferResult(value = {}) {
  return {
    transferId: nonNegativeInteger(value?.transfer_id),
    transferredIds: list(value?.transferred_ids),
    skippedIds: list(value?.skipped_ids),
    remainingCount: nonNegativeInteger(value?.remaining_count),
    batchVersion: nonNegativeInteger(value?.batch_version),
    completed: Boolean(value?.completed),
  };
}

function fallbackRandomId() {
  const timestamp = Date.now().toString(16);
  const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16);
  return `${timestamp}-${random}`;
}

export function createIdempotencyKey(batchId) {
  const normalizedBatchId = nonNegativeInteger(batchId);
  const id =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackRandomId();
  return `handover-${normalizedBatchId}-${id}`;
}
