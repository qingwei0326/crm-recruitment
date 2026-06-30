# 招生 CRM 发布前检查清单

这份清单用于每次打包、部署或交付前收口。目标是确认代码、构建、运行状态和本地产物都处在可解释状态。

## 一键检查

在项目根目录运行：

```powershell
.\scripts\release-check.ps1
```

脚本会依次执行：

- `python -m pytest -q`
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
- `watchdog.ps1`、`install-watchdog.ps1`、`uninstall-watchdog.ps1` 已废弃并删除；不要恢复 Windows 看门狗计划任务，运行守护交给 `start.ps1`/系统服务处理。
- `/api/stats/predictions` 旧预测接口已废弃；发布前确认没有重新暴露该接口或前端调用。
- 离职/禁用人员不出现在分配类列表，只在账号历史管理场景可见。
- 超管和普通管理员权限符合预期：普通管理员不能做账号管理、系统设置、破坏性操作。

## 打包

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

- 保留通用启动/部署脚本：`start.ps1`、`start.bat`、`stop.ps1`、`stop.bat`、`deploy.ps1`、`deploy.bat`、`deploy-update.ps1`、`deploy-linux.sh`、`make-release.ps1`、`make-release.cmd`、`install-startup.ps1`、`uninstall-startup.ps1`。
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
