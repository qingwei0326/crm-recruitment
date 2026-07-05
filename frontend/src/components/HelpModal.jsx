import { memo, useState } from 'react';
import { X, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';

const HELP_SECTIONS = {
  admin: [
    {
      title: '管理后台概览',
      content: `管理员用于查看招生进度、管理线索、分配话务员、处理线索治理，以及查看各类报表。

常用入口：
• 仪表盘：查看可分配有效线索、今日新增 A、今日呼出、有效通话和阶段分布
• 今日待办：从仪表盘直接进入求助、逾期回访、无电话数据、需关注坐席等处理入口
• 每日运营：集中处理 A 级超时、家访待处理、到校待确认、已报名未结算、求助、分配后无通话、昨日遗留未联系和逾期回访
• 工作中心：按全部/求助/回访/到访处理队列集中处理事项
• 评分预览：按通话目标试算坐席分数，识别需关注、逾期回访和低通话量坐席，并跳转到问题线索
• 学生管理：筛选、编辑、分配和批量管理学生线索
• 线索治理：查看数据健康中心、疑似重复线索、异常变更提醒，并进入学生管理、无效回收、多学校分发
• 账号管理：查看管理员和话务员账号、任务归属和历史记录
• 报表中心：通过汇总报表、趋势报表、通电量查询查看运营数据
• 系统设置：维护系统级配置（含 AI 分析引擎，可在 DeepSeek / 小米 MiMo / 自定义之间切换）`,
    },
    {
      title: '学生管理',
      content: `学生管理页支持按关键词、状态、阶段、意向、地区和需协助标记筛选线索。

常用操作：
• 点击学生行查看详情、分配时间和完整时间线
• 修改学生基础信息、跟进状态、阶段和意向等级
• 给未分配或需调整的线索指定话务员
• 使用“需协助”筛选查看话务员标记出的重点问题线索
• 对已报名、无效、未接等线索及时更新状态，保证报表准确

当前学生详情以“分配时间”表示线索派给话务员的时间；时限类提醒和处理入口已暂时隐藏。`,
    },
    {
      title: '线索治理',
      content: `线索治理统一处理线索分配、无效回收和学校分发。

常用入口：
• 数据健康中心：复核重复手机号、同名同校同手机号、无手机号、已报名异常变更、A 级长期未跟进、分配后无通话、非工作时间状态变更
• 学生管理与分配：日常新增、筛选、编辑、批量选择、手动分配和自动均摊
• 无效线索回收：按无效原因和学校查看线索，可一键回收到未分配池，也可勾选后批量回收或删除
• 多学校分发：按学校选择未分配学生，自动均衡分发或指定分发给话务员

普通管理员可以查看重复手机号清理预览，但清理动作需要超级管理员执行。标记学生为“无效”时会记录原因；空号、无意向、孩子不想读、高分段会自动作为原因，其他无效需要手动填写。`,
    },
    {
      title: '账号管理',
      content: `账号管理用于查看管理员、话务员账号和线索归属。

常用操作：
• 查看话务员任务、线索归属和历史操作
• 超级管理员可新增普通管理员或话务员账号
• 超级管理员可编辑账号、重置密码、解锁或办理离职
• 离职账号默认保留历史记录，避免报表和操作追溯丢失`,
    },
    {
      title: '报表与数据',
      content: `仪表盘展示当前整体进度，适合每天快速查看。

报表中心顶部会给出管理结论，例如呼出量变化、A 转报名最佳坐席和整体报名效率。

报表中心包含三个标签：
• 汇总报表：按时间统计通话量、意向数、报名数等关键指标
• 趋势报表：查看不同日期的趋势变化，判断整体转化是否上升或下降
• 通电量查询：按话务员和时间范围查询具体通话明细，用于核对工作量
评分预览：按通话目标试算话务员表现，辅助发现低通话量、逾期回访或任务推进不足。

建议每天检查今日呼出、待回访、A 级意向和报名数据，发现异常及时回到学生管理页处理。报表以实际状态、意向和报名数据为准。`,
    },
    {
      title: '状态和阶段',
      content: `状态用于描述当前处理结果：未联系、已联系、未接、待回访、已报名、无效。

阶段用于描述招生转化进度：
① 新线索
② 意向跟进
③ 已送资料
④ 待家访
⑤ 家访已安排
⑥ 家访完成
⑦ 待到校参观
⑧ 到校参观已安排
⑨ 已到校参观
⑩ 已报名

意向等级用于判断优先级：A 最高，B 次之，C 较低，无表示暂未判断或无明显意向。`,
    },
  ],
  super_admin: [
    {
      title: '超级管理员职责',
      content: `超级管理员负责系统级兜底、账号权限、敏感配置和高危操作复核。

重点入口：
• 线索治理：查看数据健康中心，处理重复手机号清理等高危数据维护
• 操作记录：按日期、动作、分类、批次号搜索管理员操作，分配批次可预览并回滚
• 每日运营：复核并标记每日异常项，填写处理状态和备注
• 账号管理：创建管理员/话务员、重置密码、解锁账号、办理离职、调整超管权限
• 系统设置：维护 PushPlus、AI 分析、拨号窗口、评分目标和备份

高危操作执行前应先查看影响范围，执行后用批次号到操作记录复核；部署和代码更新不影响生产数据库与 .env。`,
    },
    {
      title: '数据健康和回滚',
      content: `数据健康中心聚合 7 类风险：
• 重复手机号
• 同名同校同手机号
• 无手机号线索
• 已报名异常变更
• A 级长期未跟进
• 分配后无通话
• 非工作时间状态变更

分配批次回滚路径：
1. 进入操作记录
2. 按分类“分配”或批次号筛选
3. 在批次汇总行点击“回滚预览”
4. 确认可回滚和跳过数量
5. 点击确认回滚

系统只回滚当前分配仍与该批次一致的学生；如果学生后来又被重新分配，会跳过，避免覆盖新操作。`,
    },
    {
      title: '权限边界',
      content: `只有超级管理员可以执行：
• 创建、编辑、删除管理员或话务员账号
• 重置密码、解锁账号、办理离职
• 修改系统配置、下载备份、手动备份
• 删除学生、按学校删除无效线索、批量删除无效线索
• 清理重复手机号
• 分配批次回滚

普通管理员保留日常查看、筛选、分配、回收和报表能力，但不能执行永久删除、系统配置和账号权限类操作。`,
    },
  ],
  agent: [
    {
      title: '工作台概览',
      content: `话务员工作台用于处理自己名下的学生线索。

主要区域：
• 待拨打：逐个处理当前需要首次联系的学生
• 待处理：继续处理已联系或未接通、仍需推进的学生
• 跟进中：查看有意向且需要持续跟进的学生
• 学生详情：查看学生资料、分配时间、完整时间线、意向和阶段
• AI分析：粘贴通话内容，让系统生成意向判断和摘要

电脑端列表只保留姓名、学校、阶段、意向、状态和操作，更多联系过程进入展开行或学生详情查看。

手机端包含待拨打、待处理、我的三个底部入口；学生详情可直接拨号、写备注、申请家访、预约到校和填写通话内容。`,
    },
    {
      title: '联系学生流程',
      content: `建议按以下顺序处理：
1. 在待拨打中确认学生姓名、地区、学校和联系方式
2. 点击电话按钮拨号
3. 通话后选择快捷状态：已联系、未接、待回访、已报名、空号、无意向、孩子不想读或高分段
4. 根据沟通结果调整阶段：意向跟进、已送资料、待家访、家访已安排、家访完成、待到校参观、到校参观已安排、已到校参观、已报名
5. 在备注中记录关键信息，例如家长态度、关注点、下次跟进时间
6. 需要主管协助时点击“需要协助”

手机端打完电话返回系统后会弹出处理结果选择；超过 24 小时拨号上限时系统会提示频次。`,
    },
    {
      title: 'AI 通话分析',
      content: `点击“AI分析”后，在文本框中粘贴通话内容或输入通话摘要，再点击“开始分析”。

分析结果包含：
• 意向等级：A/B/C/无
• 置信度：系统对判断的把握程度
• 摘要：本次沟通重点
• 判断依据：为什么给出该意向等级

分析完成后学生会自动标记为”已联系”。AI 结果用于辅助判断，最终跟进阶段和备注仍以实际沟通情况为准。

分析引擎由超级管理员在”系统设置 → AI 分析”中配置（DeepSeek / 小米 MiMo / 自定义）；未配置密钥时自动回退到关键词匹配，分析仍可出结果但精度较低。`,
    },
    {
      title: '回访和到访',
      content: `待回访：适合家长暂时没空、需要考虑、约定稍后再联系的情况。设置回访时间后，后续可在回顾和任务中继续跟进。

家访/到校：学生或家长同意家访时提交家访申请；家访完成后可继续预约到校参观，并记录时间、人数和关注点。

已到校参观：学生完成到校参观后由管理员记录接待结果，方便后续确认报名和结算归属。

手机端学生详情中的回访和到访记录支持完成、改期或删除。`,
    },
    {
      title: '学生详情和备注',
      content: `点击“学生详情”可查看学生基础信息、分配时间、意向等级、阶段和完整时间线。

完整时间线会合并展示分配、通话、备注、回访、到访和意向变化，方便判断下一步该继续拨打、回访、邀约到访还是请主管协助。

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
• 无效：空号、无意向、孩子不想读、高分段会自动记录原因；其他无效需填写原因
• 未接：电话未接通，需要后续再处理

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
  const title = role === 'agent'
    ? '话务员使用说明'
    : role === 'super_admin'
      ? '超级管理员使用说明'
      : '管理员使用说明';

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
