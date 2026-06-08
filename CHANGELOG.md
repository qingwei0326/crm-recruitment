# 更新日志

## 2026-06-09

### 🐛 修复
- **汇总报表页面卡死** — `/stats/predictions` 接口存在 N+1 查询问题（每个学生 3 次独立 DB 查询），导致 57000+ 学生时请求挂死。改为 3 次批量查询（notes/follow_ups/visits），1.5s 内返回
- **RefreshCcw 图标未定义** — `InvalidStudentReclaim`、`LeadRecycle`、`DistributeBySchools` 三个页面导入了 `RefreshCw` 但 JSX 使用了 `RefreshCcw`，导致页面崩溃

### ⚡ 性能
- **转化概率分布查询优化** — 使用 SQLAlchemy 子查询替代 Python 列表 IN，避免 SQLite 变量数限制（`too many SQL variables`），同时消除 N+1 问题

---

## 2026-06-08

### ✨ 新功能
- **报名转化率** — 汇总报表新增「报名率」和「A→报名」两列，CSV 导出同步支持
- **通知重试机制** — PushPlus 推送失败自动记录到 OperationLog，每 30 分钟扫描重试，成功后删除记录
- **通知失败提醒** — 管理员仪表盘顶部显示近 7 天通知失败数量
- **服务端搜索** — 手机端任务列表搜索从客户端过滤改为服务端 SQL LIKE（支持姓名/电话）
- **服务端分页** — 手机端任务列表支持分页加载（每页 30 条）
- **前周对比** — 趋势报表新增上周同期虚线对比
- **手动评级时间线** — 学员详情时间线合并手动评级操作记录，显示操作人
- **呼叫限额配置化** — `dial_max_per_24h` 从硬编码改为 SystemConfig 可配置，话务员端读取
- **跟进提醒窗口配置化** — `follow_up_window_minutes` 从硬编码 15 分钟改为 SystemConfig 可配置（1-60）
- **AI 分析引擎可切换** — 支持 DeepSeek / 小米 MiMo / 自定义

### 🔒 安全
- **IP 限流修复** — Cloudflare Tunnel 后所有请求 IP 为 127.0.0.1，改为读取 `CF-Connecting-IP` 实现 per-user 限流
- **环境变量解析统一** — `TRUST_PROXY_HEADERS` 从 `os.getenv` 比较改为导入 `app.config` 统一解析（支持 true/yes/on/1）

### 📊 报表
- **话务员排行** — 新增 `enroll_rate`（报名率）和 `a_to_enroll`（A→报名率）
- **CSV 导出** — 支持一键导出话务员业绩排行，BOM 前缀兼容 Excel

### 🧪 测试
- 新增 210 项测试（含配置验证、通知重试、限流器、AI 提供者）
- 所有测试通过，前端构建正常
