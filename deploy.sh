#!/bin/bash
# J1900 一键部署脚本（简化版）

set -e

echo "=========================================="
echo "招生系统 CRM - 一键部署"
echo "=========================================="
echo ""

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 1. 创建虚拟环境
if [ ! -d ".venv" ]; then
    echo "[1/5] 创建虚拟环境..."
    python3 -m venv .venv
else
    echo "[1/5] 虚拟环境已存在"
fi

# 2. 安装依赖
echo "[2/5] 安装 Python 依赖..."
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

# 3. 生成 SECRET_KEY
if [ ! -f ".secret_key" ]; then
    echo "[3/5] 生成 SECRET_KEY..."
    python3 -c "import secrets; print(secrets.token_hex(32))" > .secret_key
else
    echo "[3/5] SECRET_KEY 已存在"
fi

# 4. 初始化数据库
if [ ! -f "crm.db" ]; then
    echo "[4/5] 初始化数据库..."
    export SECRET_KEY=$(cat .secret_key)
    .venv/bin/python scripts/init_db.py
else
    echo "[4/5] 数据库已存在，执行迁移..."
    export SECRET_KEY=$(cat .secret_key)
    .venv/bin/python scripts/migrate_db_schema.py
fi

# 5. 安装前端依赖并构建
echo "[5/5] 构建前端..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run build
cd ..

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo ""
echo "启动服务: ./start.sh"
echo "停止服务: ./stop.sh"
echo ""
