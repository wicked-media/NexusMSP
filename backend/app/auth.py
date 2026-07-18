from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import re
from app.database import db, security, JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRATION_HOURS


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def password_policy_error(password: str, email: str = "") -> str | None:
    """Return a user-safe password policy error, or None when the password is acceptable."""
    if len(password) < 12:
        return "Use at least 12 characters"
    categories = sum((
        bool(re.search(r"[a-z]", password)),
        bool(re.search(r"[A-Z]", password)),
        bool(re.search(r"\d", password)),
        bool(re.search(r"[^A-Za-z0-9]", password)),
    ))
    if categories < 3:
        return "Use at least three of: lowercase, uppercase, number, and symbol"
    local_part = email.split("@", 1)[0].strip().lower()
    if local_part and len(local_part) >= 3 and local_part in password.lower():
        return "Do not include your email name in the password"
    return None


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
