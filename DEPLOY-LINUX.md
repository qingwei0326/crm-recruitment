# Ubuntu 部署指南

## 一键部署

```bash
# 将项目拷贝到 Ubuntu 服务器
scp -r "D:\招生系统" user@server:/opt/crm

# SSH 登录后执行
cd /opt/crm
sudo bash deploy-linux.sh
```

部署脚本会自动安装: Python venv + Node.js + nginx + frpc + cloudflared + systemd 服务

## 手动部署步骤

### 1. 系统依赖

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm sqlite3 nginx curl
```

### 2. Python 虚拟环境

```bash
cd /opt/crm
python3 -m venv .venv-linux
.venv-linux/bin/pip install -r requirements.txt
```

### 3. 构建前端

```bash
cd /opt/crm/frontend
npm install
npm run build
```

### 4. 环境变量

```bash
cp .env.example .env
# 编辑 .env 填入 SECRET_KEY 和 DEEPSEEK_API_KEY
```

生成 SECRET_KEY:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 5. systemd 服务

```bash
sudo cp crm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable crm
sudo systemctl start crm
```

### 6. nginx 反向代理

```bash
sudo cp nginx-crm.conf /etc/nginx/sites-available/crm
sudo ln -sf /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 穿透隧道配置

### 方案 A: 樱花穿透 (SakuraFrp) — 国内推荐 ✅

**国内速度快，适合国内用户访问**

#### 步骤

1. 注册账号: https://natfrp.com
2. 登录控制台 → 隧道列表 → 创建隧道
3. 配置隧道:
   - 类型: `HTTP`
   - 本地 IP: `127.0.0.1`
   - 本地端口: `8000`
   - 节点: 选国内节点（推荐 `cn-hk-zh-01` 或 `cn-bj-zh-01`）
   - 自定义域名: 可选（有自己的域名填上）
4. 复制 token

5. 编辑配置文件:
```bash
cd /opt/crm
nano frpc.ini
```

填入你的 token 和节点信息:
```ini
[common]
server_addr = nodes.natfrp.com
server_port = 7000
token = 你的token

[crm-http]
type = http
local_ip = 127.0.0.1
local_port = 8000
node = cn-hk-zh-01
```

6. 启动:
```bash
systemctl start frpc
systemctl enable frpc  # 开机自启
```

7. 查看状态:
```bash
systemctl status frpc
journalctl -u frpc -f
```

#### 管理命令

```bash
bash tunnel.sh frpc-start    # 启动樱花穿透
bash tunnel.sh frpc-stop     # 停止
bash tunnel.sh frpc-status   # 查看状态
```

### 方案 B: Cloudflare Tunnel — 国际推荐

**全球 CDN，适合国外用户，国内可能较慢**

#### 步骤

1. 安装 cloudflared（部署脚本已自动安装）

2. 登录:
```bash
cloudflared tunnel login
# 会打开浏览器，登录 Cloudflare 账号授权
```

3. 创建隧道:
```bash
cloudflared tunnel create crm-tunnel
cloudflared tunnel route dns crm-tunnel crm.qing-wei.com
```

4. 配置:
```bash
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: crm.qing-wei.com
    service: http://127.0.0.1:8000
  - service: http_status:404
EOF
```

5. 运行:
```bash
cloudflared tunnel run crm-tunnel
```

6. 设为服务:
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### 方案 C: 两个都用

国内用户走樱花穿透，国外用户走 CF Tunnel，同时运行互不影响:

```bash
# 两个都启动
systemctl start frpc           # 樱花穿透
systemctl start cloudflared    # CF Tunnel
```

### 方案 D: nginx + Let's Encrypt（有服务器公网 IP 时）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.qing-wei.com
```

---

## 穿透管理脚本

```bash
bash tunnel.sh start       # 启动所有隧道
bash tunnel.sh stop        # 停止所有隧道
bash tunnel.sh status      # 查看所有状态
bash tunnel.sh test        # 测试连通性
bash tunnel.sh setup       # 设置向导
```

---

## CRM 服务管理

```bash
# 查看状态
sudo systemctl status crm

# 重启服务
sudo systemctl restart crm

# 查看实时日志
sudo journalctl -u crm -f

# 查看应用日志
tail -f /opt/crm/backend.log

# 手动启动（调试用）
cd /opt/crm
.venv-linux/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 数据迁移

从 Windows 迁移数据到 Ubuntu:

```bash
# 1. 拷贝数据库文件
scp "D:\招生系统\crm.db" user@server:/opt/crm/

# 2. 拷贝密钥文件
scp "D:\招生系统\.env" user@server:/opt/crm/

# 3. 重启服务
sudo systemctl restart crm
```

---

## 常见问题

### 502 Bad Gateway

```bash
sudo systemctl status crm
curl http://127.0.0.1:8000/api/health
sudo nginx -t
```

### 樱花穿透连不上

```bash
# 检查配置
cat /opt/crm/frpc.ini

# 检查日志
journalctl -u frpc -n 20

# 测试 token 是否正确
frpc -c /opt/crm/frpc.ini
```

### CF Tunnel 国内慢

这是正常的，CF 的国内节点有限。国内用户建议用樱花穿透。

### 端口被占用

```bash
sudo lsof -i :8000
sudo ss -tlnp | grep 8000
```

### 日志过大

```bash
sudo journalctl --vacuum-time=7d
ls -lh /opt/crm/backend*.log
```
