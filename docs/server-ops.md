# CRM 服务器运维手册

本文档记录当前 Ubuntu 服务器的实际运维方式（Docker Compose 托管）。不要把访问密钥、API Key、数据库密码写进本文档。

> 旧版本文档描述的是 systemd + `.venv-py312` 的部署方式，已经废弃。`crm.service` 在宿主机上应保持停止，否则会和容器抢 8000 端口。仓库里已删除的 `scripts/safe-ubuntu-deploy.sh`（服务器 `~/crm/scripts/` 里还留有旧副本）同样是 systemd 时代的脚本，**不要运行**。

## 当前架构

```text
网页入口：
  https://crm.qing-wei.com
  -> Cloudflare Tunnel (cloudflared-crm.service)
  -> 127.0.0.1:8000
  -> Docker 容器 crm-crm-1

远程维护：
  ssh -p 30002 qingwei@frp-end.com
  -> SakuraFrp TCP 隧道 (natfrp.service)
  -> Ubuntu SSH

应用：
  目录:       /home/qingwei/crm
  Compose:    /home/qingwei/crm/compose.yml
  生产数据库: /home/qingwei/crm/crm.db（挂载进容器 /data/crm.db）
  代码:       /home/qingwei/crm/.deploy/current -> .deploy/releases/<版本>
              （/home/qingwei/crm/app 是指向 .deploy/current/app 的软链接）
```

镜像以 `.deploy/current` 为构建上下文，`Dockerfile` 在 `/home/qingwei/crm/Dockerfile`。切换版本 = 改 `current` 指针后 `docker compose up -d --build`。

## 常用入口

```powershell
ssh -p 30002 qingwei@frp-end.com
```

局域网 SSH，IP 可能变化：

```text
ssh qingwei@<局域网 IP>
```

健康检查：

```bash
curl http://127.0.0.1:8000/api/health
curl https://crm.qing-wei.com/api/health
```

正常输出类似：

```json
{"code":0,"msg":"ok","db":"ok","db_ms":3}
```

## 日常命令

```bash
cd ~/crm
docker compose ps                    # 容器状态，应为 Up (healthy)
docker compose logs --tail 100 crm   # 应用日志
docker compose restart crm           # 仅重启，不重建
systemctl is-active cloudflared-crm.service natfrp.service
journalctl -u cloudflared-crm.service -n 100 --no-pager
journalctl -u natfrp.service -n 100 --no-pager
```

## 文件位置

```text
/home/qingwei/crm/compose.yml                 容器编排（不在 git 里）
/home/qingwei/crm/.env                        生产环境变量（SECRET_KEY 等）
/home/qingwei/crm/crm.db                      生产 SQLite 数据库
/home/qingwei/crm/backups/                    数据库备份（同时挂载进容器）
/home/qingwei/crm/.deploy/releases/<版本>/    各版本冻结的发布包内容
/home/qingwei/crm/.deploy/current             当前版本指针
/home/qingwei/.cloudflared/config.yml         Cloudflare Tunnel 配置
/home/qingwei/.config/natfrp/frpc.env         SakuraFrp token 和隧道 ID
```

不要随便覆盖：

```text
/home/qingwei/crm/crm.db
/home/qingwei/crm/.env
/home/qingwei/.config/natfrp/frpc.env
/home/qingwei/.cloudflared/*.json
```

## compose.yml 里的关键变量

```yaml
environment:
  DATABASE_PATH: /data/crm.db
  FRONTEND_DIR: /app/frontend/dist
  EXPECTED_ALEMBIC_REVISION: "<目标迁移版本>"
```

应用启动时会先自动执行 `alembic upgrade head`，再断言数据库版本等于 `EXPECTED_ALEMBIC_REVISION`。**每次发布都必须把它改成新包的目标版本**（见发布包里的 `release-manifest.json` 的 `expected_database_revision`），否则迁移完成后断言失败，容器会反复重启。

## 发布流程（手工，Docker 版）

### 本地：打包

在开发机上，工作区必须干净、在 `main` 上、测试通过：

```powershell
.\scripts\prepare-production-release.ps1 -Version <版本号>
```

产物在 `releases/production-<版本号>/`、同名 `.zip` 和 `.zip.sha256`。脚本内部会重新构建前端并执行发布包校验。脚本里的 `$DatabaseUpgradeFromRevision` 必须等于**线上库当前版本**，`$ExpectedDatabaseRevision` 是新版本的目标版本；这两个值不对，发布包校验会放行但部署时库版本会对不上。

线上库当前版本可以在服务器上只读查询：

```bash
python3 -c "import sqlite3;print(sqlite3.connect('file:/home/qingwei/crm/crm.db?mode=ro',uri=True).execute('select * from alembic_version').fetchall())"
```

### 本地：上传

在 Windows 本地终端（提示符是 `PS D:\...>`，不是 `qingwei@crm`）里运行：

```powershell
cd D:\招生系统
scp -P 30002 releases/production-<版本号>.zip releases/production-<版本号>.zip.sha256 qingwei@frp-end.com:/home/qingwei/crm/.deploy/
```

### 服务器：校验并解压（不影响线上）

```bash
cd ~/crm/.deploy && sha256sum -c production-<版本号>.zip.sha256 && mkdir releases/<版本号> && python3 -c "import zipfile;zipfile.ZipFile('production-<版本号>.zip').extractall('releases/<版本号>')" && ls releases/<版本号>
```

### 服务器：备份数据库

用包里的在线备份工具，不要直接 `cp` 正在使用的 SQLite 文件：

```bash
cd ~/crm && python3 .deploy/releases/<版本号>/scripts/sqlite_online_backup.py --source ~/crm/crm.db --destination ~/crm/backups/crm-before-<版本号>.db --expect-revision <线上当前版本> && ls -la backups/crm-before-<版本号>.db
```

输出里应有 `"integrity_check": "ok"`，文件大小应与线上库相近（约 100MB 以上）。备份没成功不要继续。

### 服务器：更新 compose.yml 的期望版本

```bash
cd ~/crm && cp compose.yml compose.yml.before-<版本号> && sed -i 's/EXPECTED_ALEMBIC_REVISION: "<旧版本>"/EXPECTED_ALEMBIC_REVISION: "<目标版本>"/' compose.yml && grep EXPECTED compose.yml
```

### 服务器：切换并重启（有几十秒中断，挑没人用的时间）

```bash
cd ~/crm && ln -sfn /home/qingwei/crm/.deploy/releases/<版本号> .deploy/current && docker compose up -d --build && sleep 20 && docker compose ps && curl -s http://127.0.0.1:8000/api/health
```

期望：容器 `Up ... (healthy)`，健康检查 `{"code":0,"msg":"ok",...}`。构建时 `pip install` 可能需要几分钟。

### 服务器：发布后验证

```bash
python3 -c "import sqlite3;print(sqlite3.connect('file:/home/qingwei/crm/crm.db?mode=ro',uri=True).execute('select * from alembic_version').fetchall())"; curl -s https://crm.qing-wei.com/api/health; echo; cd ~/crm && docker compose logs --tail 25 crm | grep -i -E "error|traceback|alembic|revision" | head -15; readlink .deploy/current
```

期望：版本为目标版本；公网健康检查正常；日志里没有 `error`/`Traceback`（有 alembic 升级信息行是正常的）；`current` 指向新版本目录。最后在浏览器登录，点开学生列表、话务员工作台和学生详情页做冒烟检查。

### 回滚

已经迁移过的数据库**不能**靠旧代码直接回退：旧代码的 `EXPECTED_ALEMBIC_REVISION` 与新库版本不符会启动失败，迁移本身也只能向前。回滚 = 恢复旧代码 + 旧 compose.yml + 发布前的数据库备份，**备份之后写入的数据会丢失**：

```bash
cd ~/crm && ln -sfn /home/qingwei/crm/.deploy/releases/<旧版本目录> .deploy/current && cp compose.yml.before-<版本号> compose.yml && docker compose down && cp -a backups/crm-before-<版本号>.db crm.db && docker compose up -d --build
```

只有在确认新版本确实有问题、并接受丢失备份后数据时才回滚；能修就先看日志。

### 清理

观察几天确认稳定后，再清理旧的发布目录、备份和 `compose.yml.before-*`。保留最近几份即可。`~/crm/.deploy/deploy.lock` 是空文件，不要删。

## 备份

手动备份数据库（用在线备份工具，保证一致性）：

```bash
cd ~/crm && python3 .deploy/current/scripts/sqlite_online_backup.py --source ~/crm/crm.db --destination ~/crm/backups/crm-$(date +%Y%m%d-%H%M%S).db
```

从服务器拉回 Windows：

```powershell
scp -P 30002 qingwei@frp-end.com:/home/qingwei/crm/crm.db D:\招生系统\backups\crm-server-latest.db
```

建议定期保留：

```text
最近 7 天每日备份
重大导入/更新前的手动备份
每次发布前的备份
```

## 故障排查

### SSH 连不上

先测试樱花端口：

```powershell
Test-NetConnection frp-end.com -Port 30002
```

可能原因：服务器没开机或没联网、`natfrp.service` 没运行、樱花节点异常、隧道 ID/token 失效。现场或局域网能进时检查：

```bash
systemctl status natfrp.service --no-pager
journalctl -u natfrp.service -n 100 --no-pager
```

### 网页打不开

服务器本地先查：

```bash
curl http://127.0.0.1:8000/api/health
docker compose -f ~/crm/compose.yml ps
systemctl status cloudflared-crm.service --no-pager
```

本地 health 正常但公网打不开，通常是 Cloudflare Tunnel 或访问网络问题，不是 CRM 本体问题：

```bash
journalctl -u cloudflared-crm.service -n 100 --no-pager
```

### 容器反复重启

```bash
cd ~/crm && docker compose ps && docker compose logs --tail 100 crm
```

常见原因：

```text
EXPECTED_ALEMBIC_REVISION 与数据库版本不一致（最常见，发布后忘记改 compose.yml）
.env 缺少 SECRET_KEY
数据库文件权限异常
迁移失败（日志里有 alembic 报错）
```

### 磁盘空间

```bash
df -h
du -sh ~/crm/backups ~/crm/.deploy
```

不要误删：

```text
~/crm/crm.db
~/crm/.env
~/crm/.deploy/current 指向的目录
```

## 安全注意

SSH 已配置密钥登录，禁止密码登录。不要重新开启 SSH 密码登录。

不要把这些内容发到聊天或公开仓库：

```text
SakuraFrp token
Cloudflare tunnel credentials JSON
.env
SECRET_KEY
DEEPSEEK_API_KEY
crm.db
```

如果怀疑 SakuraFrp token 泄露，到樱花后台重置 token，然后更新 `/home/qingwei/.config/natfrp/frpc.env` 并重启 `natfrp.service`：

```bash
sudo systemctl restart natfrp.service
```

## 寄回家后的现场要求

家里只需要：插电、插网线到路由器 LAN 口、确认 BIOS 来电自启仍有效。

如果远程入口不上线，让现场接显示器后执行：

```bash
hostname -I
ip route
ping -c 3 223.5.5.5
systemctl is-active cloudflared-crm.service natfrp.service
docker ps
```
