# 招生话务CRM系统

招生咨询全流程管理，支持坐席分配、通话记录、AI 意向分析、回访跟进。

## 技术栈

- **后端**: Python FastAPI + SQLAlchemy (异步) + SQLite
- **前端**: React + Vite + Tailwind CSS
- **AI**: DeepSeek API 意图分析 + 关键词兜底

## 快速启动

### Windows

双击 `start.bat` 即可启动（自动通过 WSL 拉起后端服务）。

或使用 PowerShell：

```powershell
.\start.ps1
```

### 手动启动

```bash
# 后端
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 前端（开发模式）
cd frontend && npm run dev
```

## 功能

- 坐席/管理员双角色
- 学生信息 CRUD + 批量导入
- AI 通话记录意向分析（A/B/C 三级）
- 回访、到访、备注全程跟踪
- 数据统计看板
- 定时备份
