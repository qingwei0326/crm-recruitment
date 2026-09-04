# 招生 CRM 发布前检查清单

这份清单用于每次打包、部署或交付前收口。目标是确认代码、构建、运行状态和本地产物都处在可解释状态。

## 一键检查

在项目根目录运行：

```powershell
.\scripts\release-check.ps1
```

生成生产候选包后，再把冻结目录加入同一门禁：

```powershell
.\scripts\release-check.ps1 -ProductionReleaseDir releases\production-20260714-01
```

脚本会依次执行：

- 项目虚拟环境中的 `python -m pytest -q`（优先 `.venv-win` / `.venv`）
- `npm test`
- `npm run lint`
- `npm run build`
- `GET http://127.0.0.1:8000/api/health`
- `git status --short` 摘要

如果本机没有启动服务，健康检查会失败。只想检查代码和构建时可以运行：

```powershell
.\scripts\release-check.ps1 -SkipHealth
```

## 手动确认

发布前人工确认这些点：

- `git status --short` 里的改动都能解释，临时截图、日志、数据库、备份文件不能进版本。
- 新增或修改的业务行为有对应测试，至少覆盖后端接口或前端核心交互。
- 前端构建后的 `frontend/dist` 已更新，但不提交到版本库。
- `.env`、`.secret_key`、`crm.db`、`backups/`、`data/` 不进入发布包或代码仓库。
- 旧宿主机启动、部署和进程管理脚本已归档；服务器运行由 Docker 托管，隧道由服务器侧服务托管。
- `/api/stats/predictions` 旧预测接口已废弃；发布前确认没有重新暴露该接口或前端调用。
- 离职/禁用人员不出现在分配类列表，只在账号历史管理场景可见。
- 超管和普通管理员权限符合预期：普通管理员不能做账号管理、系统设置、破坏性操作。
- 账号状态使用“在职 / 暂停 / 待交接 / 已离职”四态；办理离职不会重置学生状态、意向、阶段或历史进度。
- 交接操作必须先预览再执行；部分转派和全部接手都携带批次版本及独立幂等键，版本冲突后必须刷新重审。
- 交接完成后只改变当前学生归属和开放工作项负责人；跟进、家访、到校记录及工作项创建人保持原始历史归因。
- 桌面端和移动端结果目录都包含“已报名其他学校”，该终态在无效回收页不可选择或自动回收。

## 离职交接回归

前端完整测试使用固定的 8 个 Vitest worker，发布前连续运行两次，排除偶发超时：

```powershell
cd frontend
npm test -- --reporter=dot
npm test -- --reporter=dot
cd ..
```

交接浏览器回归包含 mocked 契约流程和真实 FastAPI 流程：

```powershell
npx playwright test tests/e2e/handover-center.spec.js tests/e2e/handover-real-workflow.spec.js
```

真实流程会自动创建临时 SQLite、迁移到 Alembic head、写入仅以 `e2e_` 开头的合成账号，并在结束后删除数据库。严禁把 `crm.db`、`backups/server-audit/` 下的服务器快照或任何含非 `e2e_` 用户的数据库传给 `scripts/seed_handover_e2e.py`；脚本也必须主动拒绝这些路径和数据。

## 打包

### Ubuntu 生产发布包

生产服务器只接收冻结后的最小运行时目录：

```powershell
.\scripts\prepare-production-release.ps1 -Version 20260714-01
```

该脚本每次都会重新执行 `vite build`，不提供跳过构建的发布参数。禁止从本地或生产目录单独复制某个 Vite JS/CSS 文件作为正式发布；`index.html`、入口 JS、懒加载分块、vendor 分块和 CSS 必须来自同一次构建并作为一个完整 `frontend/dist/` 冻结、校验和切换。

该命令会重新构建前端，并在 `releases/production-<version>/` 生成：

- `app/`、`alembic/`、`alembic.ini` 与 `frontend/dist/`
- `requirements.txt`、`logging.json` 和 `data/school_regions.json`
- SQLite 在线备份工具
- `SHA256SUMS` 和包含 Git 来源、数据库起始/目标版本及逐文件哈希的 `release-manifest.json`
- 同名 ZIP 及其 `.sha256`

先在 WSL 中执行纯本地预检，不连接服务器：

同一版本号默认不能覆盖；只有明确废弃旧候选时才能使用 `-Force` 重建。Docker 生产发布由服务器侧编排执行，本地只负责冻结发布包和完成校验。发布包校验会依次：

1. 校验冻结目录内全部 SHA256、声明的起始/目标 revision，并确认候选 Alembic head 等于目标 revision；同时从 `index.html` 递归校验 JS/CSS 动态资产图，任一引用缺失都阻断发布。
2. 获取远端部署锁，上传到独立版本目录，在远端再次校验精确文件集合，并把冻结版本收紧为目录 `0555`、文件 `0444`，阻止运行时字节码污染版本目录。
3. 从运行中服务的 PID 环境和 `/proc/<pid>/cwd` 解析真实 SQLite 路径，要求与 `EXPECTED_DB_PATH` 一致且不位于可切换代码树中。
4. 确认依赖、日志配置和区域数据未发生未受控变化；记录应用/schema guard 文件变化，并要求生产库只允许位于发布清单声明的起始 revision 或目标 revision。
5. 对当前数据库执行只读 `quick_check`、外键检查和工作项负责人审计；磁盘空间不足或历史快照达到上限时阻断。
6. 以 `0700/0600` 权限备份当前代码和数据库，快照必须保持当前 revision 且通过完整性校验。
7. 如果生产库仍在起始 revision，使用候选发布包内的 Alembic 升级到目标 revision，再次验证 revision、`quick_check` 和外键；已经在目标 revision 时幂等跳过迁移。
8. 在快照和迁移完成后执行工作项负责人数据修复；修复失败时不切换代码，修复成功后才进入发布切换。
9. 让 `app` 与前端共同跟随 `.deploy/current`，原子替换当前版本指针并重启；确认新 PID 稳定、数据库路径未变化，并逐个比对内部服务返回的全部前端构建资产。
10. 通过 `PUBLIC_BASE_URL` 再次比对公网首页、`manifest.json`、图标、全部 JS/CSS/字体/图片资产及健康接口；生产部署强制使用 `https://`，公网任一文件与候选构建不一致即自动回滚，回滚后还会重新验证公网是否恢复。生产证书目前为自签名，因此 `PUBLIC_CURL_INSECURE=1` 必须与固定的 `PUBLIC_PINNED_PUBKEY=sha256//...` 同时使用，仍会校验证书公钥；普通 HTTP 仅允许隔离的 `fake-public` 部署模拟显式开启，不能用于生产。证书续签或更换时先核对并更新 SPKI pin，换成受信任证书后应设为 `PUBLIC_CURL_INSECURE=0`。
11. 任一步失败或收到中断信号时自动切回旧代码；数据库快照保留供人工研判，不自动覆盖生产库，也不自动降级已经成功的加法迁移或反向恢复已提交的数据修复。

### 通用交付包

检查通过后再打包：

```powershell
.\make-release.ps1
```

如果目标机器没有依赖缓存，需要包含依赖：

```powershell
.\make-release.ps1 -IncludeDeps
```

打包完成后检查 `releases/` 下的 `release-manifest.json`，确认 `crm.db`、`.env`、日志、备份等运行时数据没有被打进去。

发布包规则：

- 发布包只保留 `make-release.ps1`、`make-release.cmd` 及应用运行所需文件；旧宿主机脚本位于 `archive/legacy-host-deploy/`，不会进入发布包。
- 排除运行时和本机配置：`.env`、`.env.linux`、`.secret_key`、`crm.db`、`*.db`、`*.log*`、`*.pid`、`backups/`、`data/`。
- 排除隧道/本机网络配置：`cloudflared-config.yml`、`frpc.ini`、`nginx-crm.conf`、`forward.js`、`tunnel.sh`、`install-tunnel-task.ps1`、`start-tunnel.bat`。
- 排除已废弃 watchdog 三脚本：`watchdog.ps1`、`install-watchdog.ps1`、`uninstall-watchdog.ps1`。

## 本地清理

清理前先预览：

```powershell
.\scripts\cleanup-old.ps1
```

确认后再执行：

```powershell
.\scripts\cleanup-old.ps1 -Apply
```

数据库备份默认不删。需要裁剪旧备份时单独指定：

```powershell
.\scripts\cleanup-old.ps1 -Apply -PruneBackups -KeepBackups 5
```
