<div align="center">

# 招生话务 CRM 系统

### 中职校招生话务全流程管理平台 — 坐席分配、通话记录、AI 意向分析、回访跟进

![Version](https://img.shields.io/badge/version-1.3.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Backend](https://img.shields.io/badge/backend-FastAPI%20%7C%20SQLAlchemy-green)
![Frontend](https://img.shields.io/badge/frontend-React%20%7C%20Vite%20%7C%20Tailwind-blueviolet)
![AI](https://img.shields.io/badge/AI-DeepSeek%20API-orange)

中文

</div>

---

## 💡 为什么做这个系统？

中职校招生工作高度依赖电话话务，传统的 Excel 管理方式存在几个痛点：

- 学生线索分散，难以追踪每个学生的跟进状态
- 话务员工作量无法量化，管理者只能靠"感觉"评估
- 通话记录靠手工填写，意向判定主观性太强
- 回访跟进容易漏，没有自动提醒和状态流转

**招生话务 CRM** 就是为解决这些问题而生：一套轻量、开箱即用的话务管理系统，让招生团队专注在"打电话"这件事上。

---

## ✨ 功能特性

### 角色管理

- **双角色体系** — 管理员和话务员各有专属视图和操作权限
- **管理员**：新建完整学生档案、分配话务员、查看全局数据、线索治理、工作中心、系统管理
- **话务员**：今日任务工作台、手动添加学生（自动归属）、手机端完成回访/到访/备注闭环

### 学生线索管理

- **完整学生档案** — 姓名、电话、地域、成绩、监护人信息、学校信息、报名原因
- **意向等级** — A（高意向）/ B（中等）/ C（低意向）三级标记
- **跟进阶段流转** — 初次联系 → 有意向 → 已送资料 → 预约参观 → 已来访 → 已报名
- **状态标记** — 需协助、已报名、报名专业、定金、报名日期
- **批量导入** — Excel 一键导入学生名单
- **点击拨号** — 线索列表直接触发系统拨号
- **学校派案** — 按区县筛选学校，批量分配学生到指定话务员
- **线索治理中心** — 集中处理线索回收、无效线索回收和学校分发，减少后台分散入口

### 通话记录与 AI 意向分析

- **通话记录录入** — 话务员提交通话文本后由 AI 生成分析记录（非自动对接话务系统）
- **AI 深度分析** — 接入 DeepSeek API，自动识别家长意向（A/B/C）
- **关键词兜底** — 弱网 / API 不可用时自动匹配关键词规则，分析不中断
- **通话回放** — 查看通话时长、时间、内容摘要

### 回访与跟进

- **回访提醒** — 话务员设置回访时间后，到点通过 PushPlus 推送提醒
- **待办回访面板** — 话务员专属视图，展示待办和逾期回访
- **移动端跟进闭环** — 学员详情支持完成回访、改期、删除回访、确认到访和更新状态
- **管理员工作中心** — 管理员集中处理求助、待回访和到访确认，减少跨页面巡检
- **跟进记录** — 每次通话/到访的详细备注，完整可追溯
- **到访管理** — 邀约到校记录，统计到访转化率

### 数据统计看板

- **全局统计** — 总线索数、分配数、跟进数、报名数
- **话务员绩效** — 个人通话量、意向转化率、报名转化率、A→报名率
- **趋势图表** — 日/周/月趋势，支持前周同期对比
- **热力图** — 话务员 × 日期工作量矩阵
- **转化概率预测** — 基于意向等级、跟进阶段、互动频率的概率分布
- **导出报表** — 关键数据一键导出 Excel（BOM 前缀兼容）

### 系统管理

- **定时自动备份** — 每日自动备份 SQLite 数据库，支持手动触发和文件下载
- **操作日志** — 全操作审计追踪（登录、用户管理、备份等）
- **统一后台导航** — 管理员页面共用侧边栏和移动端抽屉导航，后台入口更清晰
- **通知重试** — PushPlus 推送失败自动记录，每 30 分钟扫描重试，管理员仪表盘实时提醒
- **用户安全** — 禁止删除/停用最后一个管理员，删除用户时自动回收其名下学生
- **IP 限流** — 跨进程共享的登录频率限制，支持 Cloudflare Tunnel（读取 CF-Connecting-IP）
- **运行时配置** — 呼叫限额、跟进提醒窗口等参数可通过管理后台实时调整
- **一键部署脚本** — `start.bat` / `start.ps1` 一键拉起前后端

---

## 🚀 快速开始

### 环境要求

- Windows 10+（推荐）
- Python 3.10+
- Node.js 18+

### 一键启动

```powershell
# 双击 start.bat，或在终端运行：
.\start.ps1
```

启动后访问 `http://127.0.0.1:8000` 即可进入系统。`start.ps1` 会先 `vite build` 出前端静态产物，再由 FastAPI 在 8000 端口一并托管。

### 手动启动（生产模式）

```powershell
# 1. 构建前端
cd D:\招生系统\frontend
npm run build

# 2. 启动后端（同时托管 frontend/dist 静态资源）
cd D:\招生系统
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 开发模式

```powershell
# 后端
cd D:\招生系统
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 前端（另一个终端）
cd D:\招生系统\frontend
npm run dev   # 默认 http://localhost:3000，已在 vite.config.js 中代理 /api → 8000
```

### 启动参数

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `CRM_PYTHON` | 指定 Python 路径 | 自动检测 `.venv-win` |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 可选（不设置则仅用关键词分析） |

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| **后端框架** | Python FastAPI |
| **ORM** | SQLAlchemy 异步 |
| **数据库** | SQLite |
| **前端框架** | React 18 |
| **构建工具** | Vite 5 |
| **CSS** | Tailwind CSS 3 |
| **路由** | React Router 6 |
| **图标** | Lucide React |
| **图表** | Recharts |
| **HTTP 客户端** | Axios |
| **AI 分析** | DeepSeek API + 本地关键词兜底 |
| **进程管理** | PowerShell 脚本（start.ps1 / stop.ps1）+ Windows 任务计划程序 |

---

## 📁 项目结构

```
D:\招生系统\
├── app/                        # 后端 (Python FastAPI)
│   ├── main.py                 # 应用入口 + 路由注册
│   ├── config.py               # 配置（CORS、数据库等）
│   ├── database.py             # 数据库初始化
│   ├── models.py               # SQLAlchemy 数据模型
│   ├── schemas.py              # Pydantic 数据验证
│   ├── auth.py                 # 登录认证
│   ├── permissions.py          # 权限控制
│   ├── routers/                # 路由模块
│   │   ├── admin.py             # 管理员接口
│   │   ├── auth.py              # 认证接口
│   │   ├── calls.py             # 通话记录接口
│   │   ├── follow_ups.py        # 回访跟进接口
│   │   ├── students.py          # 学生线索接口
│   │   ├── tasks.py             # 任务接口
│   │   ├── visits.py            # 到访记录接口
│   │   ├── notes.py             # 备注接口
│   │   ├── operation_logs.py    # 操作日志
│   │   └── stats.py             # 统计数据
│   ├── ai_analyzer.py          # DeepSeek AI 意向分析
│   ├── keywords.json           # 关键词兜底规则
│   ├── utils.py                # 工具函数
│   ├── pushplus.py             # 推送通知
│   ├── scheduler.py            # 定时任务
│   └── backup.py               # 自动备份
├── frontend/                   # 前端 (React + Vite)
│   ├── src/
│   │   ├── components/         # 可复用组件
│   │   ├── pages/              # 页面组件
│   │   ├── context/            # React Context
│   │   ├── hooks/              # 自定义 Hooks
│   │   ├── api.js              # API 请求封装
│   │   ├── App.jsx             # 根组件
│   │   └── main.jsx            # 入口文件
│   └── package.json
├── backups/                    # 自动备份目录
├── start.ps1 / start.bat       # 一键启动（构建前端 + 启动后端）
├── stop.ps1 / stop.bat         # 停止服务
├── install-startup.ps1         # 注册开机自启
├── uninstall-startup.ps1       # 卸载开机自启
├── deploy-update.ps1           # 部署更新脚本
├── init_db.py                  # 数据库初始化脚本
└── README.md                   # 本文件
```

---

## ❓ 常见问题

<details>
<summary><strong>启动后页面空白怎么办？</strong></summary>

先确认后端是否启动成功：访问 `http://localhost:8000/docs`，能看到 Swagger 文档说明后端正常。然后检查前端终端是否有报错，一般是端口占用或依赖未安装，运行 `cd frontend && npm install` 重装依赖。

</details>

<details>
<summary><strong>AI 分析不生效？</strong></summary>

AI 分析依赖 DeepSeek API。设置环境变量 `DEEPSEEK_API_KEY` 后重启系统。不设置也能用关键词兜底分析（`app/keywords.json`），只是精度低于 AI。

</details>

<details>
<summary><strong>数据存储在哪里？</strong></summary>

数据库文件是仓库根目录的 `crm.db`（SQLite，路径由 `start.ps1` 中的 `DATABASE_PATH` 指定）。备份文件在 `backups/` 目录，每日自动轮换。管理员也可以手动触发备份。

</details>

<details>
<summary><strong>如何添加话务员账号？</strong></summary>

管理员登录后在系统管理页面可以创建话务员账号。初始账号需要在 `init_db.py` 中配置。

</details>

<details>
<summary><strong>点击拨号没反应？</strong></summary>

点击拨号依赖浏览器 `tel:` 协议支持。在电脑上需要配合软电话（如 X-Lite、MicroSIP）或物理话机使用。移动端浏览器直接调用系统电话。

</details>

---

## 📜 更新日志

### v1.3.0（2026-06-10）

- **话务员移动端闭环** — 学员详情补齐回访完成、改期、删除和到访确认等操作
- **管理员工作中心** — 集中处理求助、待回访、到访确认三类待办
- **线索治理中心** — 整合线索回收、无效回收和学校分发入口，旧路由保留兼容
- **统一后台导航** — 后台页面接入统一 `AdminLayout` / `AdminSidebar`
- **回访列表接口扩展** — `/api/follow-ups` 支持管理员全局分页和坐席/完成状态过滤
- **测试覆盖** — 前端 51 项测试、后端 207 项测试通过，生产构建通过

### v1.2.0（2026-06-09）

- **汇总报表性能优化** — `/stats/predictions` 接口 N+1 查询改为批量查询，57000+ 学生从挂死降至 1.5s
- **RefreshCcw 图标修复** — 无效线索回收、线索回收、多学校分发三个页面图标导入错误导致崩溃
- **报名转化率** — 汇总报表新增「报名率」和「A→报名」两列，CSV 导出同步支持
- **通知重试机制** — PushPlus 推送失败自动记录到 OperationLog，每 30 分钟扫描重试
- **通知失败提醒** — 管理员仪表盘顶部显示近 7 天通知失败数量
- **服务端搜索** — 手机端任务列表搜索从客户端过滤改为服务端 SQL LIKE（支持姓名/电话）
- **服务端分页** — 手机端任务列表支持分页加载（每页 30 条）
- **前周对比** — 趋势报表新增上周同期虚线对比
- **手动评级时间线** — 学员详情时间线合并手动评级操作记录，显示操作人
- **呼叫限额配置化** — `dial_max_per_24h` 从硬编码改为 SystemConfig 可配置
- **跟进提醒窗口配置化** — `follow_up_window_minutes` 从硬编码 15 分钟改为 SystemConfig 可配置（1-60）
- **AI 分析引擎可切换** — 支持 DeepSeek / 小米 MiMo / 自定义
- **IP 限流修复** — Cloudflare Tunnel 后改为读取 `CF-Connecting-IP` 实现 per-user 限流
- **环境变量解析统一** — `TRUST_PROXY_HEADERS` 统一解析（支持 true/yes/on/1）
- **测试覆盖** — 新增至 210 项后端测试 + 40 项前端测试

### v1.1.3（2026-05-31）

- **话务员换设备安全机制**：登录时记录设备指纹（User-Agent + IP），检测到换设备自动推送 PushPlus 通知
- **无效线索回收页面**：管理员可查看所有无效线索、批量选择、一键回收并重新分配给话务员验证
- **软离职功能**（`/users/{id}/offboard`）：一个原子操作完成禁用账号 + 撤销 token + 回收线索 + 保留历史，比手动分步操作更安全
- **Token 即时撤销**：管理员禁用账号或重置密码时，旧 token 立即失效（JWT 携带 tv 字段，user.token_version 递增触发）
- **权限边界测试**：新增 4 套测试（设备追踪、软离职、权限隔离、token 撤销），守住话务员数据隔离红线
- **部署脚本改进**：start.sh / stop.sh 重构，支持更可靠的前后端启停
- **J1900 迁移文档更新**：新增纯 Python / PowerShell 修复方案，降低部署门槛

### v1.1.2（2025-05-23）

- 新增无效线索（invalid）枚举状态 + 无效原因日志审计
- SQLite 启用 WAL 模式，解决三后台任务并发写锁冲突
- DeepSeek API Key 改为管理后端可配置（SystemSettings 页面）
- ai_analyzer 支持调用方传入 API Key，优先使用用户配置
- DeepSeek API Key 服务端校验（sk- 前缀；空串可用于清除）
- 线索列表默认隐藏终态线索（已报名/已过期/未接通/无效）
- 列表筛选用 enum 实例查询，修复 status/stage/intent 传中文值不匹配
- 删除用户逻辑拆分：终态只解绑、非终态回收全部状态
- 所有统计查询排除无效线索（不纳入已联系/转化率计算）
- 管理员后台配置项校验重构为统一 _validate_config_value
- 下载备份双重防路径穿越（白名单 + realpath 校验）
- 操作日志 CSV 导出改用 StreamingResponse 解决大文件 OOM
- 配置项新增 deepseek_api_key，mask_config 兼容其脱敏显示
- 移除 import_students 路由中对其他模块的无用 import
- start.ps1 不再强制设置 DEEPSEEK_API_KEY 环境变量（改为 DB 配置）

### v1.1.1（2025-05-22）

- 移除 MessageTemplate 整个模块（模型、路由、UI），数据库迁移清理
- region_extractor 从学校名自动解析区县（导入和手动创建时）
- CORS 添加生产域名，cloudflared 配置生产映射
- students 表 region/school_name 加索引，启动时自动创建
- 新增拨打限制系统：DialLog 防撞号表、拨号窗口配置、24h 上限
- 报名后生命周期：EnrollmentSubStage 枚举 + 管理端可编辑 + 报表饼图
- PushPlus 支持按话务员个人 token 推送
- 通话检查改为可配置 within_hours 窗口
- Note 新增 source/updated_at 字段
- 新增移动端页面（MobileHome, CallForm, StudentDetail）
- 前端组件化：StatusBadge, IntentLevelBadge 等可复用组件
- 学校派案 UI 优化：ref 防 race condition、区县人数统计
- 清理调试产物（backups/ 加入 .gitignore）
- 日志配置独立为 logging.json，启动脚本适配

### v1.1.0（2025-05-22）

- 移除 Docker 相关文件和废弃脚本，精简仓库
- 新增操作日志审计体系（登录、用户管理、备份等全记录）
- 用户管理安全加固：禁止删除/停用最后一个管理员，删除用户自动回收学生
- IP 限流从内存迁移至数据库，支持跨进程共享
- 线索分配：新增回收模式、排除终态学生、按区县筛选学校
- 回访模块：新增待办回访接口和话务员面板
- 备注支持编辑/删除，模板支持编辑和启用/停用
- 新增数据库手动备份 API（列表+触发+下载）
- SystemSettings 支持恢复出厂设置

### v1.0.0（2025-03）

- 初始版本发布
- 坐席/管理员双角色
- 学生线索 CRUD + 批量导入
- AI 通话意向分析（DeepSeek + 关键词兜底）
- 回访、到访、备注全流程跟踪
- 数据统计看板
- 定时自动备份

---

## 📄 许可

本项目为内部系统，仅供团队内部使用。
