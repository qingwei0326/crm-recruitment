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
  Compose:    /home/qingwei/crm/compose.yml（仓库 deploy/compose.yml 的副本）
  生产数据库: /home/qingwei/crm/crm.db（挂载进容器 /data/crm.db）
  代码:       /home/qingwei/crm/.deploy/current -> .deploy/releases/<版本>
              （/home/qingwei/crm/app 是指向 .deploy/current/app 的软链接）
```

镜像以 `.deploy/current` 为构建上下文，`Dockerfile` 也取自发布包（即仓库根目录的 `Dockerfile`），所以代码和镜像定义一起切换。切换版本 = 改 `current` 指针后 `docker compose up -d --build`。

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
/home/qingwei/crm/compose.yml                 容器编排（仓库 deploy/compose.yml 的副本）
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

## compose.yml 和 .env

服务器上的 `compose.yml` 与仓库 `deploy/compose.yml` 保持一致：要改先改仓库，再拷到服务器。`.env` 只放 `SECRET_KEY`、`APP_ENV=production`、`CORS_ORIGINS` 这类和环境有关的值，值本身不要写进文档。

应用启动时会先自动执行 `alembic upgrade head`，再断言数据库版本等于发布包代码里的期望版本（`app/config.py`）。期望版本跟着发布包走，发布时不用改任何配置。`compose.yml` 和 `.env` 里都**不要**再设 `EXPECTED_ALEMBIC_REVISION`：设了就会覆盖代码里的值，哪次发布忘了改，容器就会在迁移完成后反复重启。

### 一次性切换（2026-10 之后的第一次发布做一次）

在这之前，`Dockerfile` 放在 `~/crm/Dockerfile`，`compose.yml` 写死了 `EXPECTED_ALEMBIC_REVISION`，`.env` 里也有一行同名变量。第一次发布带 `Dockerfile` 的发布包时，在“校验并解压”“备份数据库”两步之后、“切换并重启”之前，多做下面三步。

服务器上，先确认新包里有 `Dockerfile`，再备份 `compose.yml` 和 `.env`，并删掉 `.env` 里的期望版本：

```bash
cd ~/crm && ls .deploy/releases/<版本号>/Dockerfile && cp compose.yml compose.yml.before-<版本号> && cp -p .env .env.before-<版本号> && sed -i '/^EXPECTED_ALEMBIC_REVISION=/d' .env && grep -o '^[A-Za-z_][A-Za-z0-9_]*=' .env
```

最后一条只列出变量名，里面应该已经没有 `EXPECTED_ALEMBIC_REVISION=`。`DEEPSEEK_API_KEY` 自从删掉 AI 通话分析后就没用了，可以顺手删掉那一行。

Windows 本地，把仓库里的 `compose.yml` 拷上去：

```powershell
cd D:\招生系统
scp -P 30002 deploy/compose.yml qingwei@frp-end.com:/home/qingwei/crm/compose.yml
```

然后照常“切换并重启”。切换之后：

- `~/crm/.dockerignore` 不在构建上下文里，构建时根本读不到，可以删。
- `~/crm/Dockerfile` 先留着。回滚到不带 `Dockerfile` 的旧发布包时，要先把它拷进旧版本目录：`cp ~/crm/Dockerfile ~/crm/.deploy/releases/<旧版本目录>/`。

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

已经迁移过的数据库**不能**直接配旧代码：旧代码不认识新的迁移版本，启动会失败，迁移本身也只能向前。回滚 = 恢复旧代码 + 发布前的数据库备份，**备份之后写入的数据会丢失**：

```bash
cd ~/crm && ln -sfn /home/qingwei/crm/.deploy/releases/<旧版本目录> .deploy/current && docker compose down && cp -a backups/crm-before-<版本号>.db crm.db && docker compose up -d --build
```

旧版本目录里没有 `Dockerfile`（2026-10 一次性切换之前的包）时，先 `cp ~/crm/Dockerfile` 进去。如果要退回到一次性切换之前，还要用 `compose.yml.before-<版本号>` 和 `.env.before-<版本号>` 恢复这两个文件。

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
compose.yml 或 .env 里还留着 EXPECTED_ALEMBIC_REVISION，且与数据库版本不一致
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

## 历史 SQLite schema 清理：20261021_01

目标迁移 `20261021_01` 从 `20261020_01` 升级，修复历史启动脚本造成的类型、空值约束、索引和外键差异，不增加 Alembic 比较过滤规则：

- 学生字段类型与模型统一，补 `case_no` 唯一约束和状态/学校索引。
- 保留并在模型中声明有用的回访、备注、查看记录、操作日志索引；只移除被 `(assigned_to, status)` 覆盖的独立 `assigned_to` 索引。
- 统一 `users.locked_until` 时间类型，补回 `operation_logs.operator_id -> users.id` 外键。
- 退役的学生字段 `agent_id`、`priority`、`last_contact_at`、`next_follow_up`、`follow_up_count`、`attempt_count`、`is_expired`、`expired_reason` 原值先写入 `schema_cleanup_archive`，再从业务表移除。
- 必填联系人/学校字段的 NULL 使用空字符串，`need_help` 的 NULL 使用 0；备注缺失的更新时间使用创建时间。被规范化的原 NULL 也归档，保留的非空联系人字段不重复归档。

归档表以 `(revision, table_name, row_id)` 标识来源，`payload` 保存 JSON 原值，没有业务写入接口，也不混入操作日志。它不参与学生级联删除，保留作独立恢复资料。

迁移在改表前拦截重复编号、孤立操作人、非法布尔值、超长字段、已有外键违规，以及需要人工审查的索引、CHECK、trigger、view；不自动删除冲突数据或截断字段。SQLite 使用显式 `BEGIN IMMEDIATE`，让归档、表重建和版本更新一起回滚。迁移必须离线执行，迁移连接关闭外键执行；应用连接继续启用外键执行。原有索引、外键、自增行为和序列高水位会保留。

在生产在线备份副本上的验证：`alembic check` 无差异，原有 31 张表保留字段的逐行哈希与行数一致（56,932 名学生、12,920 条备注、163,944 条操作日志），56,932 条学生字段归档与源库原值逐条一致；`integrity_check=ok`、外键违规 0、域一致性审计通过。自动化测试覆盖异常数据拦截、旧双引号默认值、自增序列和重建途中故障回滚。

这是前向清理，`alembic downgrade` 会拒绝。回退应在维护窗口内恢复经过完整性验证的迁移前数据库备份，并一起恢复旧代码、镜像及期望版本。归档原值不能代替完整 schema 备份；重新开放业务后，先保留并核对增量数据，不能直接覆盖数据库回退。SQLite 历史结构修复与副本验证只覆盖 SQLite；PostgreSQL 路径仅添加归档表和缺失索引。
