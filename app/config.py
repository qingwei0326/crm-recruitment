import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DB_PATH = os.getenv("DATABASE_PATH", os.path.join(BASE_DIR, "crm.db"))
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"
DATABASE_URL_SYNC = f"sqlite:///{DB_PATH}"

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

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
