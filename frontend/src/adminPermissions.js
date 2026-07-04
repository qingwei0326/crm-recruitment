export const ADMIN_PAGE_PERMISSIONS = {
  workCenter: 'work_center',
  homeVisits: 'home_visits',
  campusVisits: 'campus_visits',
  enrollmentSettlement: 'enrollment_settlement',
  leadsManage: 'leads_manage',
  leadGovernance: 'lead_governance',
  invalidReclaim: 'invalid_reclaim',
  schoolDistribution: 'school_distribution',
  scorePreview: 'score_preview',
  accountManage: 'account_manage',
  reportCenter: 'report_center',
  auditLogs: 'audit_logs',
};

export const ADMIN_PAGE_PERMISSION_OPTIONS = [
  {
    key: ADMIN_PAGE_PERMISSIONS.workCenter,
    label: '工作中心',
    description: '查看和处理家访、到校、回访、结算、求助待办',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.homeVisits,
    label: '家访任务',
    description: '查看家访申请、安排家访、回填家访结果',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.campusVisits,
    label: '到校参观',
    description: '查看到校预约、回填到校结果和现场报名',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.enrollmentSettlement,
    label: '报名结算',
    description: '查看报名记录、处理归属和结算状态',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.leadsManage,
    label: '学生管理',
    description: '查看学生名单、学生详情和基础线索处理',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.leadGovernance,
    label: '线索治理',
    description: '查看数据健康、重复线索、风险操作和治理入口',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.invalidReclaim,
    label: '无效线索回收',
    description: '查看无效线索并按学校回收到未分配池',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.schoolDistribution,
    label: '多学校分发',
    description: '按学校批量分发未分配学生给话务员',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.scorePreview,
    label: '评分预览',
    description: '查看话务员评分、风险信号和试算参数',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.accountManage,
    label: '账号管理',
    description: '查看账号列表和话务员任务明细',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.reportCenter,
    label: '报表中心',
    description: '查看招生报表、趋势报表和通电量查询',
  },
  {
    key: ADMIN_PAGE_PERMISSIONS.auditLogs,
    label: '操作记录',
    description: '查看操作日志、筛选审计记录',
  },
];

export const ADMIN_OPERATION_PERMISSIONS = {
  studentCreate: 'student_create',
  studentEdit: 'student_edit',
  studentDelete: 'student_delete',
  studentImport: 'student_import',
  studentAssign: 'student_assign',
  studentPhone: 'student_phone',
  invalidReclaim: 'invalid_reclaim',
  invalidDelete: 'invalid_delete',
  duplicateCleanup: 'duplicate_cleanup',
  assignmentRollback: 'assignment_rollback',
  governanceReview: 'governance_review',
  userCreate: 'user_create',
  userEdit: 'user_edit',
  userDelete: 'user_delete',
  userOffboard: 'user_offboard',
  userUnlock: 'user_unlock',
  userResetPassword: 'user_reset_password',
  enrollmentCreate: 'enrollment_create',
  enrollmentAttribution: 'enrollment_attribution',
  enrollmentSettlement: 'enrollment_settlement',
  reportExport: 'report_export',
  auditRollback: 'audit_rollback',
  auditExport: 'audit_export',
};

export const ADMIN_OPERATION_PERMISSION_OPTIONS = [
  {
    group: '学生管理',
    items: [
      { key: ADMIN_OPERATION_PERMISSIONS.studentCreate, label: '新增学生' },
      { key: ADMIN_OPERATION_PERMISSIONS.studentEdit, label: '编辑学生' },
      { key: ADMIN_OPERATION_PERMISSIONS.studentDelete, label: '删除学生' },
      { key: ADMIN_OPERATION_PERMISSIONS.studentImport, label: '导入学生' },
      { key: ADMIN_OPERATION_PERMISSIONS.studentAssign, label: '分配/改派学生' },
      { key: ADMIN_OPERATION_PERMISSIONS.studentPhone, label: '查看明文电话' },
    ],
  },
  {
    group: '线索治理',
    items: [
      { key: ADMIN_OPERATION_PERMISSIONS.invalidReclaim, label: '无效线索回收' },
      { key: ADMIN_OPERATION_PERMISSIONS.invalidDelete, label: '无效线索删除' },
      { key: ADMIN_OPERATION_PERMISSIONS.duplicateCleanup, label: '重复手机号清理' },
      { key: ADMIN_OPERATION_PERMISSIONS.assignmentRollback, label: '分配批次回滚' },
      { key: ADMIN_OPERATION_PERMISSIONS.governanceReview, label: '治理复核确认' },
    ],
  },
  {
    group: '账号管理',
    items: [
      { key: ADMIN_OPERATION_PERMISSIONS.userCreate, label: '新增账号' },
      { key: ADMIN_OPERATION_PERMISSIONS.userEdit, label: '编辑账号' },
      { key: ADMIN_OPERATION_PERMISSIONS.userDelete, label: '删除账号' },
      { key: ADMIN_OPERATION_PERMISSIONS.userOffboard, label: '离职交接' },
      { key: ADMIN_OPERATION_PERMISSIONS.userUnlock, label: '解锁账号' },
      { key: ADMIN_OPERATION_PERMISSIONS.userResetPassword, label: '重置密码' },
    ],
  },
  {
    group: '报名结算',
    items: [
      { key: ADMIN_OPERATION_PERMISSIONS.enrollmentCreate, label: '确认报名' },
      { key: ADMIN_OPERATION_PERMISSIONS.enrollmentAttribution, label: '修改报名归属' },
      { key: ADMIN_OPERATION_PERMISSIONS.enrollmentSettlement, label: '修改结算状态' },
    ],
  },
  {
    group: '报表/审计',
    items: [
      { key: ADMIN_OPERATION_PERMISSIONS.reportExport, label: '报表导出' },
      { key: ADMIN_OPERATION_PERMISSIONS.auditRollback, label: '操作记录回滚' },
      { key: ADMIN_OPERATION_PERMISSIONS.auditExport, label: '操作记录导出' },
    ],
  },
];

const ADMIN_OPERATION_PERMISSION_KEYS = new Set(
  ADMIN_OPERATION_PERMISSION_OPTIONS.flatMap((group) => group.items.map((item) => item.key)),
);

export function normalizeAdminPagePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item) =>
      ADMIN_PAGE_PERMISSION_OPTIONS.some((option) => option.key === item),
    );
  }
  if (typeof value === 'string') {
    return normalizeAdminPagePermissions(value.split(',').map((item) => item.trim()));
  }
  return [];
}

export function canAccessAdminPage(user, permissionKey) {
  if (!permissionKey) return true;
  if (user?.role !== 'admin') return false;
  if (user?.is_super_admin) return true;
  return normalizeAdminPagePermissions(user?.page_permissions).includes(permissionKey);
}

export function normalizeAdminOperationPermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item) => ADMIN_OPERATION_PERMISSION_KEYS.has(item));
  }
  if (typeof value === 'string') {
    return normalizeAdminOperationPermissions(value.split(',').map((item) => item.trim()));
  }
  return [];
}

export function canPerformAdminOperation(user, permissionKey) {
  if (!permissionKey) return true;
  if (user?.role !== 'admin') return false;
  if (user?.is_super_admin) return true;
  return normalizeAdminOperationPermissions(user?.operation_permissions).includes(permissionKey);
}
