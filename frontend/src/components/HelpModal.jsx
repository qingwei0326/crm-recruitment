import { useState } from 'react';
import { X, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';

const SECTIONS = [
  {
    title: '系统概述',
    content: `本系统是招生话务CRM管理平台，用于管理潜在学生信息、跟踪沟通进度、记录通话和报名情况。

角色分为两类：
• 管理员：查看数据报表、管理学生、分配话务员
• 话务员：拨打电话联系学生、记录沟通结果、更新跟进状态`,
  },
  {
    title: '学生状态说明',
    content: `学生跟进分为 6 个阶段：
① 初次联系 — 尚未拨打或刚分配
② 有意向  — 学生表示对课程有兴趣
③ 已送资料 — 已发送课程资料/简章
④ 预约参观 — 已预约来校参观或家访
⑤ 已来访  — 学生已到校参观/已家访
⑥ 已报名  — 已缴纳定金，报名成功

附加标记：
• A级意向 — 高意向学生，转化可能性大
• 无效   — 号码错误/空号/明确拒绝等`,
  },
  {
    title: '仪表盘（管理员首页）',
    content: `顶部统计卡片：学生总数、已联系数、A级意向数、今日呼出数。
点击卡片可快速跳转到对应筛选的学生列表。

跟进阶段分布图：直观展示各阶段学生数量。
点击柱状图可跳转到对应阶段的学生列表。

各地域转化率：按生源地区统计学生数及转化效果。

到访汇总：展示来校参观和家访的数量，以及近期到访安排。`,
  },
  {
    title: '学生管理',
    content: `• 左侧搜索栏可按姓名、学校、电话等筛选
• 状态筛选：未联系/已联系/待回访/已完成/已报名/无效
• 意向筛选：A/B/C/D 级
• 地区筛选：按生源所在地
• 话务员筛选：按负责人
• 点击学生行可查看详情，包括通话记录和沟通历史
• 管理员可分配话务员、修改学生信息`,
  },
  {
    title: '话务员工作台',
    content: `话务员登录后进入工作台，可以看到分配给自己的学生列表。

操作流程：
1. 在列表中选择学生，点击拨号按钮
2. 通话结束后，选择沟通结果（有意向/待回访/拒绝等）
3. 如有意向，可标记意向等级（A/B/C/D）
4. 添加备注，记录关键信息
5. 可预约下次回访时间或到访安排

AI 通话分析（新功能）：
• 通话结束后，点击"AI分析"按钮
• 系统自动将通话文本发送到 DeepSeek AI 分析
• 分析结果：意向等级（A/B/C）、置信度、摘要、原因
• 若 AI 服务不可用，自动使用关键词匹配降级
• 分析记录会保存在通话详情中，方便后续跟进

通话结果选项：
• 已联系-有意向 → 进入有意向阶段
• 已联系-待回访 → 标记待回访，设置回访时间
• 拒绝接听   → 标记拒绝
• 无效/空号  → 标记无效`,
  },
  {
    title: '数据报表',
    content: `汇总报表：按日/周/月统计通话量、意向数、报名数等关键指标。

趋势报表：展示各项指标的时间趋势变化，支持图表可视化。

通电量查询：按话务员、日期范围查询详细通话记录。`,
  },
  {
    title: '快捷操作技巧',
    content: `• 仪表盘卡片可直接点击跳转到筛选列表
• 阶段分布图可点击跳转
• 学生列表支持多条件组合筛选
• 话务员可一键复制学生电话
• 支持暗色/亮色模式切换（侧边栏底部）`,
  },
];

export default function HelpModal({ isOpen, onClose }) {
  const [expanded, setExpanded] = useState({});

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
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">使用说明</h2>
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
          {SECTIONS.map((section, i) => (
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
}
