$ErrorActionPreference = "Stop"

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    throw "pm2 not found in PATH. Run this from a shell where pm2 is available."
}

pm2 stop crm-backend
