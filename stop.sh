#!/bin/bash
# J1900 停止脚本（类似 Windows 的 stop.ps1）

ROOT="$(cd "$(dirname "$0")" && pwd)"

# 停止后端
if [ -f "$ROOT/backend.pid" ]; then
    PID=$(cat "$ROOT/backend.pid")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "停止后端服务 (PID: $PID)..."
        kill "$PID" 2>/dev/null || true
        sleep 1
        if ps -p "$PID" > /dev/null 2>&1; then
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi
    rm -f "$ROOT/backend.pid"
fi

# 清理所有 uvicorn 进程
pkill -f "uvicorn app.main:app" 2>/dev/null || true

echo "服务已停止"
