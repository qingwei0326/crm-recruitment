#!/bin/bash
# J1900 简单启动脚本（类似 Windows 的 start.ps1）

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 查找 Python
if [ -n "$CRM_PYTHON" ]; then
    PYTHON="$CRM_PYTHON"
elif [ -f "$ROOT/.venv/bin/python" ]; then
    PYTHON="$ROOT/.venv/bin/python"
else
    PYTHON="python3"
fi

# 检查 Python
if ! command -v "$PYTHON" &> /dev/null; then
    echo "错误: 未找到 Python"
    exit 1
fi

# 加载 SECRET_KEY
if [ -z "$SECRET_KEY" ]; then
    if [ -f "$ROOT/.secret_key" ]; then
        export SECRET_KEY=$(cat "$ROOT/.secret_key")
    fi
fi

if [ -z "$SECRET_KEY" ]; then
    echo "错误: SECRET_KEY 未设置且 .secret_key 文件不存在"
    exit 1
fi

# 设置环境变量
export DATABASE_PATH="$ROOT/crm.db"
export FRONTEND_DIR="$ROOT/frontend/dist"
export PYTHONNOUSERSITE=1

# 加载 .env 文件
if [ -f "$ROOT/.env" ]; then
    set -a
    source "$ROOT/.env"
    set +a
fi

# 构建前端
echo "构建前端..."
cd "$ROOT/frontend"
if [ -f "node_modules/.bin/vite" ]; then
    node_modules/.bin/vite build
elif command -v npm &> /dev/null; then
    npm run build
else
    echo "警告: 未找到 vite 或 npm，跳过前端构建"
fi
cd "$ROOT"

# 停止旧进程
if [ -f "$ROOT/backend.pid" ]; then
    OLD_PID=$(cat "$ROOT/backend.pid")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        kill "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$ROOT/backend.pid"
fi

# 日志轮转
for log in "$ROOT"/*.log; do
    if [ -f "$log" ] && [ $(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null) -gt 5242880 ]; then
        mv "$log" "$log.old"
        echo "日志已轮转: $(basename $log)"
    fi
done

# 启动后端
echo "启动后端服务..."
nohup "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 \
    > "$ROOT/backend.log" 2>&1 &
echo $! > "$ROOT/backend.pid"

echo ""
echo "服务已启动！"
echo "访问地址: http://$(hostname -I | awk '{print $1}'):8000"
echo "本地访问: http://127.0.0.1:8000"
echo ""
echo "管理命令:"
echo "  停止服务: ./stop.sh"
echo "  查看日志: tail -f backend.log"
