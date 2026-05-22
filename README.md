<div align="center">

# 招生话务 CRM 系统

### 中职校招生话务全流程管理平台 — 坐席分配、通话记录、AI 意向分析、回访跟进

![Version](https://img.shields.io/badge/version-1.0.0-blue)
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
- **管理员**：新建完整学生档案、分配话务员、查看全局数据、系统管理
- **话务员**：今日任务工作台、手动添加学生（自动归属）、填写跟进记录

### 学生线索管理

- **完整学生档案** — 姓名、电话、地域、成绩、监护人信息、学校信息、报名原因
- **意向等级** — A（高意向）/ B（中等）/ C（低意向）三级标记
- **跟进阶段流转** — 未联系 → 初次联系 → 跟进中 → 意向明确 → 已报名
- **状态标记** — 需协助、已报名、报名专业、定金、报名日期
- **批量导入** — Excel 一键导入学生名单
- **点击拨号** — 线索列表直接触发系统拨号
- **学校派案** — 按区县筛选学校，批量分配学生到指定话务员

### 通话记录与 AI 意向分析

- **通话记录自动同步** — 对接话务系统，通话后自动生成记录
- **AI 深度分析** — 接入 DeepSeek API，自动识别家长意向（A/B/C）
- **关键词兜底** — 弱网 / API 不可用时自动匹配关键词规则，分析不中断
- **通话回放** — 查看通话时长、时间、内容摘要

### 回访与跟进

- **回访提醒** — 根据意向等级和跟进阶段自动生成回访计划
- **待办回访面板** — 话务员专属视图，展示待办和逾期回访
- **跟进记录** — 每次通话/到访的详细备注，完整可追溯
- **到访管理** — 邀约到校记录，统计到访转化率

### 数据统计看板

- **全局统计** — 总线索数、分配数、跟进数、报名数
- **话务员绩效** — 个人通话量、意向转化率、报名转化率
- **趋势图表** — 日/周/月趋势，直观掌握招生节奏
- **导出报表** — 关键数据一键导出 Excel

### 系统管理

- **定时自动备份** — 每日自动备份 SQLite 数据库，支持手动触发和文件下载
- **操作日志** — 全操作审计追踪（登录、用户管理、备份等）
- **用户安全** — 禁止删除/停用最后一个管理员，删除用户时自动回收其名下学生
- **IP 限流** — 跨进程共享的登录频率限制，防止暴力破解
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

### v1.1.0（2025-05-22）

- 移除 Docker 相关文件和废弃脚本，精简仓库
- 新增操作日志审计体系（登录、用户管理、备份等全记录）
- 用户管理安全加固：禁止删除/停用最后一个管理员，删除用户自动回收学生
- IP 限流从内存迁移至数据库，支持跨进程共享
- 线索分配：新增回收模式、排除终态学生、按区县筛选学校
- 回访模块：新增待办回访接口和话务员面板
- 备注支持编辑/删除
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
