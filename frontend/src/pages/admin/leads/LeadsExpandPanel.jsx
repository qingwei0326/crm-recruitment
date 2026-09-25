import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Home as HomeIcon,
  Loader2,
  MapPin,
  Trash2,
} from 'lucide-react';
import PhoneLink from '../../../components/PhoneLink';
import { formatDateTime } from '../../../utils';
import { STAGES, statusLabel } from '../../../labels';
import {
  CAMPUS_ACTION_STAGES,
  ENROLLMENT_SUBSTAGES,
  HOME_ACTION_STAGES,
  INTENT_OPTS,
  compactStageLabel,
  inputCls,
} from '../leadsManageUtils';
import { EDITABLE_STATUS_OPTS } from './leadOptions';

/**
 * 线索列表展开面板：学生信息、最近联系记录与跟进操作。
 * 所有副作用通过 actions 传入，组件本身不持有业务状态。
 */
export default function LeadsExpandPanel({
  studentId,
  cache,
  permissions,
  agents,
  noteValue,
  followUpValue,
  homeSubmitting,
  campusSubmitting,
  actions,
}) {
  if (!cache || cache.loading) {
    return (
      <tr className="bg-slate-50 dark:bg-gray-800">
        <td colSpan={9} className="px-4 py-8 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </td>
      </tr>
    );
  }

  if (cache.error) {
    return (
      <tr className="bg-slate-50 dark:bg-gray-800">
        <td colSpan={9} className="px-4 py-6">
          <div className="flex items-center justify-center gap-3 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span>{cache.error}</span>
            <button
              type="button"
              onClick={() => actions.reload(studentId)}
              className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              重新加载
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const s = cache.student;
  const notes = cache.notes || [];
  const isEnrolled = s.status === '已报名' || s.stage === '已报名';

  return (
    <tr className="bg-slate-50 dark:bg-gray-800 expand-row">
      <td colSpan={9} className="px-4 py-4">
        <div className="border-l-4 border-blue-500 pl-3 grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fadeIn">
          {/* ── Left Column: Student Info + Notes ── */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider border-b pb-2 mb-1">
              学生信息 & 联系记录
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['成绩', s.score != null ? s.score : '-', null],
                ['监护人', s.guardian_name || '-', null],
                ['监护人电话', s.guardian_phone_raw || s.guardian_phone || '', 'guardian'],
                ['监护人2', s.guardian2_name || '-', null],
                ['监护人2电话', s.guardian2_phone_raw || s.guardian2_phone || '', 'guardian2'],
                ['学校', s.school_name || '-', null],
              ].map(([k, v, contactKey]) => (
                <div key={k} className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border dark:border-gray-700">
                  <div className="text-xs text-gray-400">{k}</div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {contactKey && permissions.canViewStudentPhone ? (
                      <PhoneLink
                        value={v}
                        label={`拨打${k}`}
                        onDial={() => actions.dial(studentId, contactKey)}
                      />
                    ) : (
                      v
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Last 3 notes */}
            <div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                最近联系记录
              </div>
              {cache.notesError && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg mb-2">
                  联系记录加载失败：{cache.notesError}
                </div>
              )}
              {notes.length === 0 ? (
                <div className="text-xs text-gray-400 py-2">暂无联系记录</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {notes.map((n) => (
                    <div key={n.id} className={`rounded-lg px-3 py-2 border ${n.source === 'ai' ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800' : 'bg-white dark:bg-gray-800 dark:border-gray-700'}`}>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mb-0.5">
                        {n.source === 'ai' && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">AI</span>
                        )}
                        <span className="font-medium text-gray-600 dark:text-gray-300">{n.agent_name}</span>
                        <span>{formatDateTime(n.created_at)}</span>
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {n.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Right Column: Quick Actions ── */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider border-b pb-2 mb-1">
              跟进操作
            </div>

            {/* Stage */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">跟进阶段</label>
              <div className="flex gap-1">
                {STAGES.map((st, i) => {
                  const curIdx = STAGES.indexOf(s.stage);
                  const editable = st !== '已报名';
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => editable && actions.quickStage(s.id, st)}
                      disabled={!permissions.canEditStudent || isEnrolled || !editable}
                      title={st}
                      className={`flex-1 h-2 rounded-full transition-colors ${
                        i <= curIdx ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
                      } ${st === s.stage ? 'ring-2 ring-blue-300' : ''} ${
                        permissions.canEditStudent && !isEnrolled && editable ? '' : 'cursor-not-allowed opacity-60'
                      }`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                {STAGES.map((st) => (
                  <span key={st} className="truncate max-w-[16%] text-center">
                    {compactStageLabel(st)}
                  </span>
                ))}
              </div>
            </div>

            {(permissions.canManageHomeVisits || permissions.canManageCampusVisits) && (
              <div className="border-t dark:border-gray-600 pt-3">
                <div className="mb-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    招生任务
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    一键生成任务后进入对应管理页继续安排时间和填写结果。
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {permissions.canManageHomeVisits && HOME_ACTION_STAGES.has(s.stage) && (
                    <button
                      type="button"
                      onClick={() => actions.createHomeVisit(s)}
                      disabled={homeSubmitting === s.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {homeSubmitting === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HomeIcon className="w-3.5 h-3.5" />}
                      生成家访任务
                    </button>
                  )}
                  {permissions.canManageCampusVisits && CAMPUS_ACTION_STAGES.has(s.stage) && (
                    <button
                      type="button"
                      onClick={() => actions.createCampusVisit(s)}
                      disabled={campusSubmitting === s.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {campusSubmitting === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                      生成到校任务
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 border-t dark:border-gray-600 pt-3">
              {/* Status */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">状态</label>
                {isEnrolled ? (
                  <div className="flex min-h-10 items-center rounded-lg bg-green-50 px-3 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:text-green-300">
                    已报名
                  </div>
                ) : (
                  <select
                    aria-label={`设置 ${s.name || '学生'} 状态`}
                    value={s.status}
                    onChange={(e) => actions.quickStatus(s.id, e.target.value)}
                    disabled={!permissions.canEditStudent}
                    className={`${inputCls} text-xs`}
                  >
                    {EDITABLE_STATUS_OPTS.map((o) => (
                      <option key={o} value={o}>{statusLabel(o)}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Intent */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">意向等级</label>
                <select
                  aria-label={`设置 ${s.name || '学生'} 意向等级`}
                  value={s.intent_level}
                  onChange={(e) => actions.quickIntent(s.id, e.target.value)}
                  disabled={!permissions.canEditStudent}
                  className={`${inputCls} text-xs`}
                >
                  {INTENT_OPTS.filter(Boolean).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Note input */}
            <div className="border-t dark:border-gray-600 pt-3">
              <label className="text-xs text-gray-500 mb-1 block">写备注</label>
              <div className="flex gap-1">
                <input
                  aria-label={`给 ${s.name || '学生'} 写备注`}
                  value={noteValue || ''}
                  onChange={(e) => actions.onNoteChange(s.id, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && actions.addNote(s.id)}
                  placeholder="回车发送…"
                  className={`flex-1 ${inputCls} text-xs`}
                />
                <button
                  type="button"
                  onClick={() => actions.addNote(s.id)}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs shrink-0"
                >
                  提交
                </button>
              </div>
            </div>

            {/* Follow-up date */}
            <div className="border-t dark:border-gray-600 pt-3">
              <label className="text-xs text-gray-500 mb-1 block">设置回访日期</label>
              <div className="flex gap-1">
                <input
                  aria-label={`设置 ${s.name || '学生'} 回访日期`}
                  type="datetime-local"
                  value={followUpValue || ''}
                  onChange={(e) => actions.onFollowUpChange(s.id, e.target.value)}
                  className={`flex-1 ${inputCls} text-xs`}
                />
                <button
                  type="button"
                  onClick={() => actions.addFollowUp(s.id)}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs shrink-0"
                >
                  设置
                </button>
              </div>
            </div>

            {/* Assign agent */}
            {permissions.canAssignStudents && (
              <div className="border-t dark:border-gray-600 pt-3">
                <label className="text-xs text-gray-500 mb-1 block">分配话务员</label>
                <select
                  aria-label={`分配 ${s.name || '学生'} 给话务员`}
                  value={s.assigned_to || ''}
                  onChange={(e) => actions.assignAgent(s.id, e.target.value)}
                  className={`${inputCls} text-xs`}
                >
                  <option value="">未分配</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Need help toggle */}
            <div className="flex items-center justify-between border-t dark:border-gray-600 pt-3">
              <span className="text-xs text-gray-500">需要协助</span>
              <button
                type="button"
                onClick={() => actions.toggleNeedHelp(s.id)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  s.need_help ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    s.need_help ? 'translate-x-[1.15rem]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1 border-t dark:border-gray-600 pt-3">
              <Link
                to={`/admin/leads/${s.id}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs hover:bg-blue-100 dark:hover:bg-blue-900/50"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                查看详情
              </Link>
              {permissions.canEditStudent && (
                <button
                  type="button"
                  onClick={() => actions.openEdit(s)}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  编辑信息
                </button>
              )}

              {permissions.canCreateEnrollment && !isEnrolled && (
                <button
                  type="button"
                  onClick={() => actions.openEnrollment(s)}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs text-white hover:bg-green-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  确认报名
                </button>
              )}

              {permissions.canInvalidateEnrolled && s.status === '已报名' && (
                <button
                  type="button"
                  onClick={() => actions.invalidateEnrolled(s)}
                  className="flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  取消报名
                </button>
              )}
              {permissions.canDeleteStudent && (
                <button
                  type="button"
                  onClick={() => actions.remove(s)}
                  className="flex items-center gap-1 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              )}
            </div>

            {/* Enroll info */}
            {s.status === '已报名' && (
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 space-y-2">
                <div className="text-xs font-semibold text-green-700 dark:text-green-300">报名信息</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>专业: {s.program || '-'}</div>
                  <div>定金: {s.deposit != null ? s.deposit : '-'}</div>
                  <div>报名日: {s.enrolled_at || '-'}</div>
                </div>
                {permissions.canEditStudent && (
                  <div className="flex items-center gap-2 pt-2 border-t border-green-200 dark:border-green-800">
                    <label className="text-xs text-green-700 dark:text-green-300 font-medium">
                      报名后状态
                    </label>
                    <select
                      aria-label={`设置 ${s.name || '学生'} 报名后状态`}
                      value={s.enrollment_substage || ''}
                      onChange={(e) => actions.changeSubstage(s.id, e.target.value)}
                      className={`${inputCls} text-xs flex-1`}
                    >
                      <option value="">(清空)</option>
                      {ENROLLMENT_SUBSTAGES.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
