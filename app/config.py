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
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0").lower() in {"1", "true", "yes", "on"}
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "0").lower() in {"1", "true", "yes", "on"}

BCRYPT_ROUNDS = 12

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE = os.getenv("DEEPSEEK_BASE", "https://api.deepseek.com")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173,https://crm.qing-wei.com",
    ).split(",")
    if o.strip()
]
