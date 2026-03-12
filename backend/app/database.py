from motor.motor_asyncio import AsyncIOMotorClient
from fastapi.security import HTTPBearer
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'nexusops-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

PAX8_API_URL = "https://api.pax8.com/v1"
PAX8_AUTH_URL = "https://login.pax8.com/oauth/token"

security = HTTPBearer()

UPLOADS_DIR = ROOT_DIR / "uploads"
AVATARS_DIR = UPLOADS_DIR / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
