import { memo, useState } from 'react';
import { X, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';

const HELP_SECTIONS = {
  admin: [
    {
      title: '管理后台概览',
      content: `管理员用于查看招生进度、管理线索、分配话务员、回收长期未跟进线索，以及查看各类报表。

常用入口：
• 仪表盘：查看学生总数、已联系、A级意向、今日呼出和阶段分布
• 学生管理：筛选、编辑、分配和批量管理学生线索
• 线索回收：回收长期无回访线索，并重新分配给坐席
• 话务员管理：新增、编辑、停用和删除话务员
• 汇总报表/趋势报表/通电量查询：查看运营数据
• 系统设置：维护系统级配置`,
    },
    {
      title: '学生管理',
      content: `学生管理页支持按关键词、状态、阶段、意向、地区、负责人和需协助标记筛选线索。

常用操作：
• 点击学生行查看详情、联系记录和通话记录
• 修改学生基础信息、跟进状态、阶段和意向等级
• 给未分配或需调整的线索指定话务员
• 使用“需协助”筛选查看话务员标记出的重点问题线索
• 对已报名、无效、未接通等线索及时更新状态，保证报表准确`,
    },
    {
      title: '线索回收',
      content: `线索回收用于处理已分配但长期没有回访记录的学生。

操作流程：
1. 选择 3/7/14/30 天，点击查询
2. 勾选需要回收的线索，可单选或全选
3. 点击“自动均摊”将线索平均分给可用话务员
4. 或选择指定坐席后点击“确认分配”

回收后线索会进入新的负责人名下，原负责人不再继续处理这些线索。`,
    },
    {
      title: '话务员管理',
      content: `话务员管理用于维护坐席账号和线索归属。

常用操作：
• 新增话务员账号，设置姓名、账号和初始密码
• 编辑话务员信息或重置密码
• 停用暂不工作的坐席，避免继续分配线索
• 删除话务员前确认线索处理方式，相关线索会回收到线索池`,
    },
    {
      title: '报表与数据',
      content: `仪表盘展示当前整体进度，适合每天快速查看。

汇总报表：按时间统计通话量、意向数、报名数等关键指标。
趋势报表：查看不同日期的趋势变化，判断整体转化是否上升或下降。
通电量查询：按话务员和时间范围查询具体通话明细，用于核对工作量。

建议每天检查今日呼出、待回访、A级意向和报名数据，发现异常及时回到学生管理页处理。`,
    },
    {
      title: '状态和阶段',
      content: `状态用于描述当前处理结果：未联系、已联系、待回访、已结案、已报名、无效、未接通等。

阶段用于描述招生转化进度：
① 新线索
② 意向跟进
③ 资料已发
④ 邀约到访
⑤ 已到访
⑥ 已报名

意向等级用于判断优先级：A 最高，B 次之，C 较低，无表示暂未判断或无明显意向。`,
    },
  ],
  agent: [
    {
      title: '工作台概览',
      content: `话务员工作台用于处理自己名下的学生线索。

主要区域：
• 今日任务：逐个处理今天需要联系的学生
• 昨日回顾：查看昨日呼出和今日待回访提醒
• 学生详情：查看学生资料、联系记录、意向和阶段
• AI分析：粘贴通话内容，让系统生成意向判断和摘要`,
    },
    {
      title: '联系学生流程',
      content: `建议按以下顺序处理：
1. 在今日任务中确认学生姓名、地区、学校和联系方式
2. 点击电话按钮拨号
3. 通话后选择快捷状态：已联系、待回访、已报名或无效（标记无效会要求填写原因）
4. 根据沟通结果调整阶段：意向跟进、资料已发、邀约到访、已到访、已报名
5. 在备注中记录关键信息，例如家长态度、关注点、下次跟进时间
6. 需要主管协助时点击“需要协助”`,
    },
    {
      title: 'AI 通话分析',
      content: `点击“AI分析”后，在文本框中粘贴通话内容或输入通话摘要，再点击“开始分析”。

分析结果包含：
• 意向等级：A/B/C/无
• 置信度：系统对判断的把握程度
• 摘要：本次沟通重点
• 判断依据：为什么给出该意向等级

分析完成后学生会自动标记为“已联系”。AI 结果用于辅助判断，最终跟进阶段和备注仍以实际沟通情况为准。`,
    },
    {
      title: '回访和到访',
      content: `待回访：适合家长暂时没空、需要考虑、约定稍后再联系的情况。设置回访时间后，后续可在回顾和任务中继续跟进。

邀约到访/家访：学生或家长同意到校、来访或家访时填写到访类型、时间和备注。

已到访：学生完成参观或家访后及时调整阶段，方便管理员查看转化进度。`,
    },
    {
      title: '学生详情和备注',
      content: `点击“学生详情”可查看学生基础信息、意向等级、阶段和历史联系记录。

备注建议写具体事实：
• 家长最关心的问题
• 学生分数、学校、地区等补充信息
• 是否需要发送资料
• 约定的下次联系时间
• 拒绝、无效或需协助的原因`,
    },
    {
      title: '状态和意向',
      content: `常用状态：
• 已联系：电话已接通并完成沟通
• 待回访：需要后续再联系
• 已报名：确认报名成功
• 无效：空号、错号、重复、明确无效（标记时需填写原因）
• 未接通：多次拒接或明确不愿沟通

意向等级：
• A：明确有兴趣，建议优先跟进
• B：有一定兴趣，需要继续培育
• C：兴趣较弱，后续观察
• 无：暂无有效判断`,
    },
  ],
};

export default memo(function HelpModal({ isOpen, onClose, role = 'admin' }) {
  const [expanded, setExpanded] = useState({});
  const sections = HELP_SECTIONS[role] || HELP_SECTIONS.admin;
  const title = role === 'agent' ? '话务员使用说明' : '管理员使用说明';

  const toggle = (i) => setExpanded((p) => ({ ...p, [i]: !p[i] }));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border dark:border-gray-700 w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-1 flex-1">
          {sections.map((section, i) => (
            <div key={i} className="border dark:border-gray-700 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(i)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {section.title}
                </span>
                {expanded[i] ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                )}
              </button>
              {expanded[i] && (
                <div className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
                  {section.content}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t dark:border-gray-700 text-center shrink-0">
          <span className="text-xs text-gray-400">招生话务CRM v1.0</span>
        </div>
      </div>
    </div>
  );
});
