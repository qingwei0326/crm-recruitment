import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 数据库配置 ──────────────────────────────────────────
# 优先使用 DATABASE_URL 环境变量（PostgreSQL / SQLite 均可）。
# 未设置时回退到本地 SQLite 文件（向后兼容）。
DATABASE_URL = os.getenv("DATABASE_URL", "")

if not DATABASE_URL:
    # SQLite 模式
    DB_PATH = os.getenv("DATABASE_PATH", os.path.join(BASE_DIR, "crm.db"))
    DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"
    DATABASE_URL_SYNC = f"sqlite:///{DB_PATH}"
    DB_ENGINE = "sqlite"
else:
    # PostgreSQL 模式：DATABASE_URL 由用户提供，
    # 例如 postgresql+asyncpg://user:pass@localhost:5432/crm_recruitment
    DB_PATH = ""  # PostgreSQL 无本地文件
    # 派生同步驱动 URL（用于 init_db / backup 等同步场景）
    DATABASE_URL_SYNC = DATABASE_URL.replace("+asyncpg", "+psycopg2")
    if DATABASE_URL_SYNC == DATABASE_URL:
        # 用户可能直接写了 postgresql://，补上 psycopg2 驱动
        DATABASE_URL_SYNC = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
    DB_ENGINE = "postgresql"

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is required. "
        'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"'
    )

ALGORITHM = "HS256"
APP_ENV = os.getenv("APP_ENV", "development").lower()
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0").lower() in {"1", "true", "yes", "on"}

# 是否信任 Cloudflare 注入的 CF-Connecting-IP。
# 隧道部署下 request.client.host 恒为 127.0.0.1，不信任代理头会让登录 IP 限流
# 退化成全站共享配额（一人刷爆 → 全网登不进），所以生产环境默认开启。
# 非生产环境默认关闭：直连部署时客户端可任意伪造 X-Forwarded-For，
# 只有明确处于可信反代之后才应打开（仍可用环境变量覆盖）。
_TRUST_PROXY_DEFAULT = "1" if APP_ENV == "production" else "0"
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", _TRUST_PROXY_DEFAULT).lower() in {
    "1",
    "true",
    "yes",
    "on",
}

BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", "12"))

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = os.getenv("DEEPSEEK_BASE", "https://api.deepseek.com")

EXPECTED_ALEMBIC_REVISION = os.getenv("EXPECTED_ALEMBIC_REVISION", "20260925_01")
_DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://localhost:5173"
_default_cors_origins = _DEFAULT_CORS_ORIGINS if APP_ENV != "production" else ""
_raw_cors_origins = os.getenv("CORS_ORIGINS", _default_cors_origins)
if APP_ENV == "production" and not _raw_cors_origins.strip():
    raise RuntimeError("CORS_ORIGINS must be set in production")
CORS_ORIGINS = [o.strip() for o in _raw_cors_origins.split(",") if o.strip()]
