from motor.motor_asyncio import AsyncIOMotorClient
from fastapi.security import HTTPBearer
import os
from pathlib import Path
from dotenv import load_dotenv
from app.services.runtime_config import dotenv_loading_enabled, validate_runtime_database_name

ROOT_DIR = Path(__file__).parent.parent
if dotenv_loading_enabled():
    load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db_name = validate_runtime_database_name(os.environ['DB_NAME'])
db = client[db_name]

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET is required. Set a long, random value in the backend environment "
        "before starting NexusOps."
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

PAX8_API_URL = "https://api.pax8.com/v1"
PAX8_AUTH_URL = "https://login.pax8.com/oauth/token"

security = HTTPBearer()

_configured_uploads_dir = str(os.environ.get("NEXUS_UPLOADS_DIR") or "").strip()
UPLOADS_DIR = Path(_configured_uploads_dir).expanduser().resolve() if _configured_uploads_dir else ROOT_DIR / "uploads"
AVATARS_DIR = UPLOADS_DIR / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
