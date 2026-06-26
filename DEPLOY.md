# 部署指南 v1.1

## 一键部署

```powershell
.\deploy.ps1           # 完整部署（安装依赖 + 构建前端 + 重启后端）
.\deploy.ps1 -NoBuild  # 跳过前端构建（仅更新后端）
.\deploy.ps1 -DryRun   # 仅检查环境，不执行
```

## 迁移到新机器

### 前置条件

- Python 3.11+（推荐使用 `.venv-win` 虚拟环境）
- Node.js 18+（仅前端构建需要）
- 原机器的 `crm.db` 数据库文件
- 原机器的 `.env` 或 `.secret_key` 文件

### 步骤

1. **拷贝项目目录**到新机器（排除 `node_modules`、`__pycache__`、`.venv-win`、`dist`）

2. **拷贝数据库文件**
   ```
   # 从旧机器
   copy D:\招生系统\crm.db D:\招生系统\backups\crm_before_migrate.db

   # 拷贝到新机器同路径
   ```

3. **拷贝密钥文件**
   ```
   .env       # 含 SECRET_KEY 等配置
   # 或
   .secret_key  # 单独的密钥文件
   ```

4. **在新机器执行部署**
   ```powershell
   cd D:\招生系统
   .\deploy.ps1
   ```

5. **验证**
   - 访问 `http://127.0.0.1:8000` 确认后端启动
   - 访问 `https://crm.qing-wei.com` 确认公网访问正常

## 数据库兼容性

本次更新的数据库变更是**向后兼容**的：

| 变更 | 类型 | 自动迁移 |
|------|------|---------|
| `users.must_change_password` | 新增列 | ✅ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| `students` 表 3 个索引 | 新增索引 | ✅ `CREATE INDEX IF NOT EXISTS` |
| `operation_logs.operator_id` | 改为 nullable | ✅ 启动时自动执行 |

**不会影响现有数据读取**。启动后端时 `init_db()` 会自动执行迁移，无需手动操作。

## 常见问题

### 500 错误
- 检查 `backend_stderr.log` 查看具体报错
- 确认 `pip install -r requirements.txt` 执行成功（特别是 `slowapi`）
- 确认 `.env` 中 `SECRET_KEY` 已设置

### 502 错误（Cloudflare Tunnel）
- 确认后端端口 8000 正在监听：`netstat -ano | findstr 8000`
- 确认 Cloudflare Tunnel 配置指向 `http://127.0.0.1:8000`
- 检查 Tunnel 进程是否运行

### 数据库锁定
- 确保没有多个后端实例同时访问 `crm.db`
- SQLite 超时已设为 15 秒，高并发场景建议迁移到 PostgreSQL
