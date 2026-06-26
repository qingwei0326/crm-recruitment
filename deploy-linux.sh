#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# 招生话务CRM系统 — Ubuntu 一键部署脚本
# 用法: sudo bash deploy-linux.sh
# ═══════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_USER="crm"
VENV_DIR="$APP_DIR/.venv-linux"
LOG_DIR="/var/log/crm"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── 0. 检查 root ─────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    fail "请用 root 运行: sudo bash $0"
fi

# ── 1. 系统依赖 ──────────────────────────────────────────
info "安装系统依赖..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip \
    nodejs npm sqlite3 curl nginx > /dev/null 2>&1

# 检查 Python 版本
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
if [[ "$PY_MAJOR" -lt 3 ]] || [[ "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10 ]]; then
    fail "Python 版本过低: $PY_VER (需要 3.10+)"
fi
info "Python $PY_VER ✓"

# 检查 Node.js 版本
NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ -z "$NODE_VER" ]] || [[ "$NODE_VER" -lt 18 ]]; then
    warn "Node.js 版本较低或未安装，尝试安装 Node 18+..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
fi
info "Node.js $(node -v) ✓"

# ── 2. 创建应用用户 ──────────────────────────────────────
if ! id "$APP_USER" &>/dev/null; then
    info "创建系统用户 $APP_USER..."
    useradd -r -m -d "$APP_DIR" -s /bin/bash "$APP_USER" 2>/dev/null || true
fi
info "用户 $APP_USER ✓"

# ── 3. Python 虚拟环境 + 依赖 ───────────────────────────
if [[ ! -f "$VENV_DIR/bin/python" ]]; then
    info "创建 Python 虚拟环境..."
    python3 -m venv "$VENV_DIR"
fi
info "安装 Python 依赖..."
"$VENV_DIR/bin/pip" install -q --upgrade pip
"$VENV_DIR/bin/pip" install -q -r "$APP_DIR/requirements.txt"

# ── 4. Node 依赖 + 构建前端 ─────────────────────────────
info "安装前端依赖并构建..."
cd "$APP_DIR/frontend"
npm install --silent 2>/dev/null
npm run build
info "前端构建完成 ✓"

# ── 5. 生成 SECRET_KEY ──────────────────────────────────
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    info "生成 .env 文件..."
    SECRET_KEY=$("$VENV_DIR/bin/python" -c "import secrets; print(secrets.token_hex(32))")
    cat > "$ENV_FILE" <<EOF
# ═══════════════════════════════════════════════════════════
# 招生话务CRM — 环境变量
# ═══════════════════════════════════════════════════════════

# ── 安全 ────────────────────────────────────────────────
SECRET_KEY=$SECRET_KEY

# ── 数据库（留空 = 本地 SQLite）────────────────────────
# DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/crm

# ── AI 分析 ─────────────────────────────────────────────
DEEPSEEK_API_KEY=

# ── CORS ────────────────────────────────────────────────
CORS_ORIGINS=http://127.0.0.1:8000,http://localhost:8000,https://crm.qing-wei.com

# ── 安全头 ──────────────────────────────────────────────
TRUST_PROXY_HEADERS=1
COOKIE_SECURE=1
EOF
    chmod 600 "$ENV_FILE"
    info ".env 已生成，请编辑填入 DEEPSEEK_API_KEY"
else
    info ".env 已存在，跳过"
fi

# ── 6. 复制数据库（如果有的话）───────────────────────────
if [[ ! -f "$APP_DIR/crm.db" ]]; then
    warn "未找到 crm.db，首次启动会自动创建"
fi

# ── 7. 日志目录 ──────────────────────────────────────────
mkdir -p "$LOG_DIR"
chown "$APP_USER:$APP_USER" "$LOG_DIR"

# ── 8. 权限 ─────────────────────────────────────────────
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$ENV_FILE"

# ── 9. systemd 服务 ─────────────────────────────────────
info "安装 systemd 服务..."
cat > /etc/systemd/system/crm.service <<EOF
[Unit]
Description=招生话务CRM系统
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=PATH=$VENV_DIR/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$VENV_DIR/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-config logging.json
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=crm

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$APP_DIR $LOG_DIR /tmp
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable crm.service
info "systemd 服务已安装 ✓"

# ── 10. nginx 反向代理（可选）─────────────────────────────
if [[ ! -f /etc/nginx/sites-available/crm ]]; then
    info "配置 nginx 反向代理..."
    cat > /etc/nginx/sites-available/crm <<'NGINX'
server {
    listen 80;
    server_name crm.qing-wei.com _;

    # 如需 HTTPS，取消注释以下行并配置证书路径
    # listen 443 ssl;
    # ssl_certificate     /etc/nginx/ssl/crm.pem;
    # ssl_certificate_key /etc/nginx/ssl/crm.key;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（如未来需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # 静态资源缓存
    location /assets/ {
        proxy_pass http://127.0.0.1:8000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 日志
    access_log /var/log/nginx/crm_access.log;
    error_log  /var/log/nginx/crm_error.log;
}
NGINX
    ln -sf /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/crm
    rm -f /etc/nginx/sites-enabled/default
    nginx -t 2>/dev/null && systemctl reload nginx
    info "nginx 配置完成 ✓"
else
    info "nginx 配置已存在，跳过"
fi

# ── 11. 樱花穿透 (SakuraFrp) ─────────────────────────────
info "安装樱花穿透 (frpc)..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  FRPC_ARCH="amd64" ;;
    aarch64) FRPC_ARCH="arm64" ;;
    armv7l)  FRPC_ARCH="arm" ;;
    *)       warn "不支持的架构: $ARCH，跳过 frpc 安装"; FRPC_ARCH="" ;;
esac

if [[ -n "$FRPC_ARCH" ]]; then
    FRPC_VERSION="0.51.0"
    FRPC_DIR="/usr/local/bin"
    FRPC_BIN="$FRPC_DIR/frpc"
    FRPC_URL="https://github.com/natfrp/frp/releases/download/v${FRPC_VERSION}/frpc_${FRPC_VERSION}_linux_${FRPC_ARCH}.tar.gz"

    if [[ ! -f "$FRPC_BIN" ]]; then
        info "下载 frpc v${FRPC_VERSION} (${FRPC_ARCH})..."
        cd /tmp
        curl -fsSL "$FRPC_URL" -o frpc.tar.gz
        tar -xzf frpc.tar.gz
        cp "frpc_${FRPC_VERSION}_linux_${FRPC_ARCH}/frpc" "$FRPC_BIN"
        chmod +x "$FRPC_BIN"
        rm -rf frpc.tar.gz "frpc_${FRPC_VERSION}_linux_${FRPC_ARCH}"
        info "frpc 安装完成 ✓"
    else
        info "frpc 已安装，跳过"
    fi

    # 生成 frpc 配置模板
    FRPC_CONF="$APP_DIR/frpc.ini"
    if [[ ! -f "$FRPC_CONF" ]]; then
        cat > "$FRPC_CONF" <<'FRPC'
# ═══════════════════════════════════════════════════════════
# 樱花穿透 (SakuraFrp) 客户端配置
# 填入你的穿透设置后运行: frpc -c frpc.ini
# ═══════════════════════════════════════════════════════════

# 服务端设置（从 natfrp.com 控制台获取）
[common]
server_addr = nodes.natfrp.com
server_port = 7000
token = YOUR_TOKEN_HERE

# ── CRM 系统 HTTP 隧道 ──────────────────────────────────
[crm-http]
type = http
local_ip = 127.0.0.1
local_port = 8000
# 节点选择：推荐国内节点（cn-hk-zh-01 等）
# 从 natfrp.com 控制台查看可用节点
node = cn-hk-zh-01
# 自定义域名（如果有自己的域名）
# custom_domain = crm.yourdomain.com
# 或使用 SSH 隧道（免费方案）
# remote_port = 12345
FRPC
        info "frpc 配置已生成: $FRPC_CONF"
        info "⚠️  请编辑填入 token 和节点信息（从 natfrp.com 获取）"
    fi

    # 生成 frpc systemd 服务
    cat > /etc/systemd/system/frpc.service <<FRPC_SVC
[Unit]
Description=SakuraFrp 客户端
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$FRPC_BIN -c $FRPC_CONF
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=frpc

[Install]
WantedBy=multi-user.target
FRPC_SVC

    systemctl daemon-reload
    info "frpc systemd 服务已安装 ✓"
fi

# ── 12. Cloudflare Tunnel（备用）─────────────────────────
if ! command -v cloudflared &>/dev/null; then
    info "安装 cloudflared（备用隧道）..."
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
        -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    info "cloudflared 安装完成 ✓"
    info "⚠️  需要手动登录: cloudflared tunnel login"
else
    info "cloudflared 已安装，跳过"
fi

# ── 13. 防火墙（如果有 ufw）───────────────────────────────
if command -v ufw &>/dev/null; then
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 443/tcp 2>/dev/null || true
    info "防火墙规则已添加 (80, 443)"
fi

# ── 14. 启动服务 ──────────────────────────────────────────
info "启动 CRM 服务..."
systemctl restart crm.service
sleep 2

if systemctl is-active --quiet crm.service; then
    info "══════════════════════════════════════════════════"
    info "  部署完成！"
    info "══════════════════════════════════════════════════"
    info ""
    info "  本地访问:  http://$(hostname -I | awk '{print $1}'):8000"
    info ""
    info "  穿透方案（按需启用）:"
    info "    樱花穿透:  编辑 frpc.ini → systemctl start frpc"
    info "    CF Tunnel:  cloudflared tunnel login → cloudflared tunnel run"
    info ""
    info "  管理命令:"
    info "    systemctl status crm       # 查看状态"
    info "    systemctl restart crm      # 重启服务"
    info "    systemctl start frpc       # 启动樱花穿透"
    info "    systemctl status frpc      # 查看穿透状态"
    info "    journalctl -u crm -f       # 查看日志"
    info ""
    info "  ⚠️  必须完成的配置:"
    info "    1. 编辑 .env 填入 DEEPSEEK_API_KEY"
    info "    2. 编辑 frpc.ini 填入 token（从 natfrp.com 获取）"
    info "    3. systemctl start frpc 启动穿透"
    info ""
    info "  📁 项目目录: $APP_DIR"
    info ""
else
    warn "服务启动似乎失败，查看日志:"
    journalctl -u crm -n 20 --no-pager
fi
