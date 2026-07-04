import { CheckCircle2, Circle, GraduationCap, Home, PhoneCall, School, UserCheck } from 'lucide-react';
import { formatDateTime } from '../../utils';

const STAGE_ORDER = [
  '初次联系',
  '有意向',
  '已送资料',
  '待家访',
  '家访已安排',
  '家访完成',
  '待到校参观',
  '到校参观已安排',
  '已到校参观',
  '预约参观',
  '已来访',
  '已报名',
];

const COMPLETED_HOME_STAGES = new Set([
  '家访完成',
  '待到校参观',
  '到校参观已安排',
  '已到校参观',
  '预约参观',
  '已来访',
  '已报名',
]);

const CAMPUS_SCHEDULED_STAGES = new Set(['到校参观已安排', '已到校参观', '预约参观', '已来访', '已报名']);
const CAMPUS_ARRIVED_STAGES = new Set(['已到校参观', '已来访', '已报名']);

const STEP_STYLES = {
  done: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200',
  current: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200',
  pending: 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400',
};

function stageAtOrAfter(stage, target) {
  const currentIndex = STAGE_ORDER.indexOf(stage || '');
  const targetIndex = STAGE_ORDER.indexOf(target);
  return currentIndex >= 0 && targetIndex >= 0 && currentIndex >= targetIndex;
}

function latestEvent(events, type) {
  return events
    .filter((event) => event.type === type)
    .sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')))[0];
}

function hasEventStatus(events, type, values) {
  return events.some((event) => (
    event.type === type
    && (values.has(event.status || '') || values.has(event.result || ''))
  ));
}

function eventDetail(event) {
  if (!event) return '';
  const when = formatDateTime(event.scheduled_at || event.occurred_at);
  return [event.status || event.result || '', when].filter(Boolean).join(' · ');
}

export function buildAdmissionsFlowSteps({
  student = {},
  calls = [],
  admissionsTimeline = [],
} = {}) {
  const events = Array.isArray(admissionsTimeline) ? admissionsTimeline : [];
  const stage = student.stage || '';
  const status = student.status || '';
  const intentLevel = student.intent_level || '';
  const homeEvent = latestEvent(events, 'home_visit');
  const campusEvent = latestEvent(events, 'campus_visit');
  const enrollmentEvent = latestEvent(events, 'enrollment');

  const phoneConfirmed = (
    calls.length > 0
    || ['A', 'B', 'C'].includes(intentLevel)
    || !['', '新线索', '未联系'].includes(status)
    || stageAtOrAfter(stage, '有意向')
  );
  const homeReported = Boolean(homeEvent) || stageAtOrAfter(stage, '待家访');
  const homeCompleted = (
    COMPLETED_HOME_STAGES.has(stage)
    || hasEventStatus(events, 'home_visit', new Set(['已完成', '已报名', '安排到校参观', '成功']))
  );
  const campusScheduled = Boolean(campusEvent) || CAMPUS_SCHEDULED_STAGES.has(stage);
  const campusArrived = (
    CAMPUS_ARRIVED_STAGES.has(stage)
    || hasEventStatus(events, 'campus_visit', new Set(['已到校', '现场报名', '已报名']))
  );
  const enrolled = Boolean(enrollmentEvent) || status === '已报名' || stage === '已报名';

  const steps = [
    {
      key: 'phone',
      label: '电话确认',
      done: phoneConfirmed,
      icon: PhoneCall,
      detail: intentLevel && intentLevel !== '无' ? `${intentLevel} 意向` : status || '待确认',
    },
    {
      key: 'home_reported',
      label: '家访上报',
      done: homeReported,
      icon: Home,
      detail: eventDetail(homeEvent) || (homeReported ? stage : '待上报'),
    },
    {
      key: 'home_completed',
      label: '家访完成',
      done: homeCompleted,
      icon: CheckCircle2,
      detail: homeEvent?.result || homeEvent?.status || (homeCompleted ? stage : '待处理'),
    },
    {
      key: 'campus_scheduled',
      label: '到校预约',
      done: campusScheduled,
      icon: School,
      detail: eventDetail(campusEvent) || (campusScheduled ? stage : '待预约'),
    },
    {
      key: 'campus_arrived',
      label: '已到校',
      done: campusArrived,
      icon: UserCheck,
      detail: campusEvent?.result || campusEvent?.status || (campusArrived ? stage : '待确认'),
    },
    {
      key: 'enrolled',
      label: '报名',
      done: enrolled,
      icon: GraduationCap,
      detail: enrollmentEvent?.summary || status || '待报名',
    },
  ];

  const currentIndex = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({
    ...step,
    state: step.done ? 'done' : index === currentIndex ? 'current' : 'pending',
  }));
}

export default function AdmissionsFlowStrip({ student, calls = [], admissionsTimeline = [] }) {
  const steps = buildAdmissionsFlowSteps({ student, calls, admissionsTimeline });

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">招生流程</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">电话 → 家访 → 到校 → 报名</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map((step) => {
          const Icon = step.icon || Circle;
          return (
            <div
              key={step.key}
              data-testid={`admissions-flow-${step.key}`}
              className={`min-h-[88px] rounded-lg border px-3 py-2 ${STEP_STYLES[step.state] || STEP_STYLES.pending}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate text-sm font-medium">{step.label}</span>
              </div>
              <div className="mt-2 min-h-8 text-xs leading-5 opacity-80">{step.detail || '-'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
