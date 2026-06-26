#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# 穿透隧道管理脚本
# 用法: bash tunnel.sh [start|stop|status|setup|cf-login|test]
# ═══════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
title() { echo -e "\n${BLUE}═══ $* ═══${NC}"; }

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
FRPC_CONF="$APP_DIR/frpc.ini"
CF_CONFIG="$APP_DIR/cloudflared-config.yml"

# ── 显示帮助 ──────────────────────────────────────────────
show_help() {
    cat <<EOF
用法: bash tunnel.sh <命令>

命令:
  start           启动所有隧道（frpc + cloudflared）
  stop            停止所有隧道
  status          查看隧道状态
  setup           首次安装配置向导
  frpc-start      仅启动樱花穿透
  frpc-stop       仅停止樱花穿透
  frpc-status     仅查看樱花穿透状态
  cf-start        仅启动 Cloudflare Tunnel
  cf-stop         仅停止 Cloudflare Tunnel
  cf-login        Cloudflare 登录
  cf-status       仅查看 CF Tunnel 状态
  test            测试隧道连通性

EOF
}

# ── 检查 frpc 配置 ────────────────────────────────────────
check_frpc_config() {
    if [[ ! -f "$FRPC_CONF" ]]; then
        warn "frpc.ini 不存在"
        return 1
    fi
    if grep -q "YOUR_TOKEN_HERE" "$FRPC_CONF"; then
        warn "frpc.ini 中的 token 未配置"
        return 1
    fi
    return 0
}

# ── 樱花穿透 ──────────────────────────────────────────────
frpc_start() {
    title "启动樱花穿透"
    if ! command -v frpc &>/dev/null; then
        fail "frpc 未安装，请先运行: sudo bash deploy-linux.sh"
    fi
    if ! check_frpc_config; then
        fail "请先编辑 frpc.ini 填入 token（从 natfrp.com 获取）"
    fi
    systemctl start frpc
    sleep 2
    if systemctl is-active --quiet frpc; then
        info "樱花穿透已启动"
        frpc_status
    else
        fail "启动失败，查看日志: journalctl -u frpc -n 20"
    fi
}

frpc_stop() {
    title "停止樱花穿透"
    systemctl stop frpc 2>/dev/null || true
    info "樱花穿透已停止"
}

frpc_status() {
    title "樱花穿透状态"
    if systemctl is-active --quiet frpc 2>/dev/null; then
        info "运行中"
        # 显示连接信息
        journalctl -u frpc --no-pager -n 5 2>/dev/null | tail -3
    else
        warn "未运行"
    fi
}

# ── Cloudflare Tunnel ─────────────────────────────────────
cf_start() {
    title "启动 Cloudflare Tunnel"
    if ! command -v cloudflared &>/dev/null; then
        fail "cloudflared 未安装，请先运行: sudo bash deploy-linux.sh"
    fi
    # 检查是否有配置文件或隧道
    if [[ -f "$CF_CONFIG" ]]; then
        nohup cloudflared tunnel --config "$CF_CONFIG" run > /tmp/cf-tunnel.log 2>&1 &
        echo $! > /tmp/cf-tunnel.pid
        info "Cloudflare Tunnel 已启动 (PID: $(cat /tmp/cf-tunnel.pid))"
    else
        warn "未找到 cloudflared 配置"
        echo "  运行 cloudflared tunnel login 登录"
        echo "  然后 cloudflared tunnel create crm-tunnel"
    fi
}

cf_stop() {
    title "停止 Cloudflare Tunnel"
    if [[ -f /tmp/cf-tunnel.pid ]]; then
        kill "$(cat /tmp/cf-tunnel.pid)" 2>/dev/null || true
        rm -f /tmp/cf-tunnel.pid
        info "Cloudflare Tunnel 已停止"
    else
        warn "未发现运行中的 CF Tunnel"
    fi
}

cf_status() {
    title "Cloudflare Tunnel 状态"
    if [[ -f /tmp/cf-tunnel.pid ]] && kill -0 "$(cat /tmp/cf-tunnel.pid)" 2>/dev/null; then
        info "运行中 (PID: $(cat /tmp/cf-tunnel.pid))"
    else
        warn "未运行"
    fi
}

cf_login() {
    title "Cloudflare Tunnel 登录"
    if ! command -v cloudflared &>/dev/null; then
        fail "cloudflared 未安装"
    fi
    cloudflared tunnel login
    info "登录完成后，创建隧道:"
    echo "  cloudflared tunnel create crm-tunnel"
    echo "  cloudflared tunnel route dns crm-tunnel crm.qing-wei.com"
}

# ── 测试连通性 ────────────────────────────────────────────
test_connectivity() {
    title "测试连通性"

    # 测试本地服务
    echo -n "  本地服务 (127.0.0.1:8000): "
    if curl -sf http://127.0.0.1:8000/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 正常${NC}"
    else
        echo -e "${RED}✗ 不可达${NC}"
    fi

    # 测试 frpc
    if systemctl is-active --quiet frpc 2>/dev/null; then
        echo -n "  樱花穿透: "
        echo -e "${GREEN}✓ 运行中${NC}"
        # 尝试从外部检测
        FRPC_PORT=$(grep -oP 'remote_port\s*=\s*\K\d+' "$FRPC_CONF" 2>/dev/null || echo "")
        if [[ -n "$FRPC_PORT" ]]; then
            echo "    外部端口: $FRPC_PORT"
        fi
    else
        echo -n "  樱花穿透: "
        echo -e "${YELLOW}- 未运行${NC}"
    fi

    # 测试 CF Tunnel
    if [[ -f /tmp/cf-tunnel.pid ]] && kill -0 "$(cat /tmp/cf-tunnel.pid)" 2>/dev/null; then
        echo -n "  CF Tunnel: "
        echo -e "${GREEN}✓ 运行中${NC}"
    else
        echo -n "  CF Tunnel: "
        echo -e "${YELLOW}- 未运行${NC}"
    fi

    echo ""
}

# ── 首次设置 ──────────────────────────────────────────────
setup_wizard() {
    title "穿透设置向导"
    echo ""
    echo "  选择你的穿透方案:"
    echo ""
    echo "  1) 樱花穿透 (SakuraFrp) — 国内推荐"
    echo "     - 注册: https://natfrp.com"
    echo "     - 创建隧道: 控制台 → 隧道列表 → 创建"
    echo "     - 类型: HTTP / TCP"
    echo "     - 本地IP: 127.0.0.1"
    echo "     - 本地端口: 8000"
    echo ""
    echo "  2) Cloudflare Tunnel — 国际推荐"
    echo "     - 安装: 已完成"
    echo "     - 登录: cloudflared tunnel login"
    echo "     - 创建: cloudflared tunnel create crm-tunnel"
    echo ""
    echo "  编辑配置文件:"
    echo "    樱花穿透: $FRPC_CONF"
    echo "    CF Tunnel: $CF_CONFIG"
    echo ""
    echo "  启动隧道:"
    echo "    bash tunnel.sh start"
    echo ""

    read -p "  按回车继续..."
}

# ── 主入口 ────────────────────────────────────────────────
case "${1:-help}" in
    start)
        echo -e "${BLUE}启动所有隧道...${NC}"
        # 启动 frpc（如果有配置）
        if check_frpc_config 2>/dev/null; then
            frpc_start
        else
            warn "跳过樱花穿透（未配置或未安装）"
        fi
        # 启动 CF Tunnel（如果有配置）
        if [[ -f "$CF_CONFIG" ]]; then
            cf_start
        else
            warn "跳过 CF Tunnel（未配置）"
        fi
        echo ""
        test_connectivity
        ;;
    stop)
        frpc_stop 2>/dev/null || true
        cf_stop 2>/dev/null || true
        ;;
    status)
        frpc_status 2>/dev/null || true
        echo ""
        cf_status 2>/dev/null || true
        echo ""
        test_connectivity
        ;;
    setup)
        setup_wizard
        ;;
    frpc-start)   frpc_start ;;
    frpc-stop)    frpc_stop ;;
    frpc-status)  frpc_status ;;
    cf-start)     cf_start ;;
    cf-stop)      cf_stop ;;
    cf-login)     cf_login ;;
    cf-status)    cf_status ;;
    test)         test_connectivity ;;
    help|--help|-h) show_help ;;
    *) fail "未知命令: $1 (运行 bash tunnel.sh help 查看帮助)" ;;
esac
