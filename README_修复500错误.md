# 🔧 修复 J1900 迁移后的 500 错误

## 问题原因

迁移到 J1900 后访问系统报 500 错误，是因为：

1. **数据库 schema 不匹配**
   - 新版本代码增加了字段：`token_version`, `last_login_device`, `last_login_ip`
   - `operation_logs.operator_id` 改为可空（nullable）
   - 但迁移过去的数据库还是旧结构

2. **代码期望新字段存在，但数据库里没有** → 500 错误

---

## 快速修复（在 J1900 上执行）

```bash
cd ~/招生系统

# 1. 运行数据库迁移脚本
export SECRET_KEY=$(cat .secret_key)
.venv/bin/python scripts/migrate_db_schema.py

# 2. 重启服务
./stop.sh && ./start.sh
```

**完成！** 现在访问应该正常了。

---

## 迁移脚本做了什么

`scripts/migrate_db_schema.py` 会自动：

1. **检查并添加 users 表的新字段：**
   - `token_version` - 用于 JWT token 版本控制
   - `last_login_device` - 记录最后登录设备
   - `last_login_ip` - 记录最后登录 IP

2. **修改 operation_logs 表：**
   - 将 `operator_id` 改为 nullable（删除学生时系统操作无 operator）

3. **保留所有现有数据** - 只修改表结构，不影响数据

---

## 验证修复是否成功

```bash
# 查看日志，应该没有错误
tail -f backend.log

# 访问系统，应该能正常登录
curl http://localhost:8000
```

---

## 预防措施

**下次迁移时，`deploy.sh` 会自动运行迁移脚本**，不需要手动执行。

当前的 `deploy.sh` 已经更新：
```bash
# 如果数据库已存在，自动执行迁移
if [ ! -f "crm.db" ]; then
    .venv/bin/python init_db.py
else
    .venv/bin/python scripts/migrate_db_schema.py  # 自动迁移
fi
```

---

## 技术细节

### 为什么会出现这个问题？

1. Windows 上的代码已经更新（新增字段）
2. 打包时复制的是旧数据库（没有新字段）
3. J1900 上运行新代码 + 旧数据库 → schema 不匹配 → 500 错误

### SQLite 的限制

SQLite 不支持直接修改列属性（如改为 nullable），所以迁移脚本需要：
1. 创建新表（正确的 schema）
2. 复制数据
3. 删除旧表
4. 重命名新表
5. 重建索引

这就是为什么 `_migrate_operation_log_nullable()` 函数比较复杂。

---

## 相关文件

- `scripts/migrate_db_schema.py` - 完整的数据库迁移脚本
- `app/database.py` - 包含自动迁移逻辑
- `deploy.sh` - 部署时自动运行迁移

---

**如果还有问题，查看日志：**
```bash
tail -100 backend.log
```
