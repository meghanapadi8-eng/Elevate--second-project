from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import bcrypt
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


ROOT = Path(__file__).resolve().parents[1]


def load_backend_env() -> None:
    """Load backend/.env for local development without overriding process env."""
    env_path = Path(__file__).with_name(".env")
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip().strip("\"'")
        if name.strip():
            os.environ.setdefault(name.strip(), value)


load_backend_env()
DB_PATH = Path(os.getenv("ELEVATE_SQLITE_PATH", str(ROOT / "data" / "elevate.sqlite3")))
IS_PRODUCTION = os.getenv("ELEVATE_ENV", "development").lower() == "production"
JWT_SECRET = os.getenv("ELEVATE_JWT_SECRET", "" if IS_PRODUCTION else "Elevate_Local_2026_7fK9mP2xQ8vR4nL6").strip()
TOKEN_TTL = 12 * 60 * 60
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-luna").strip()
GEMINI_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
rate_state: dict[tuple[str, str], tuple[float, int]] = {}
rate_lock = threading.Lock()


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with database() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                session_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS resumes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_resumes_user_updated ON resumes(user_id, updated_at);
            CREATE TABLE IF NOT EXISTS saved_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                job_key TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, job_key)
            );
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                job_key TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, job_key)
            );
            CREATE INDEX IF NOT EXISTS idx_applications_user_updated ON applications(user_id, updated_at);
            CREATE TABLE IF NOT EXISTS career_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS letters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_letters_user_updated ON letters(user_id, updated_at);
            CREATE TABLE IF NOT EXISTS profiles (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                phone TEXT,
                location TEXT,
                headline TEXT,
                bio TEXT,
                website TEXT,
                linkedin TEXT,
                skills TEXT NOT NULL DEFAULT '[]',
                preferences TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS password_resets (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    if IS_PRODUCTION and len(JWT_SECRET) < 32:
        raise RuntimeError("Set a unique ELEVATE_JWT_SECRET of at least 32 characters in production.")
    initialize_database()
    yield


app = FastAPI(title="Elevate API", version="1.0.0", lifespan=lifespan)
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "ELEVATE_CORS_ORIGINS",
        "http://localhost,http://127.0.0.1,http://localhost:80,http://127.0.0.1:80,http://localhost:5500,http://127.0.0.1:5500",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    if int(request.headers.get("content-length", "0") or "0") > 1_500_000:
        return JSONResponse({"error": "Request is too large."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; "
        "object-src 'none'; img-src 'self' data: https:; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "connect-src 'self' " + " ".join(cors_origins)
    )
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse({"error": message}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Invalid JSON request."}, status_code=400)


@app.exception_handler(Exception)
async def server_error(_: Request, exc: Exception):
    logging.exception("Elevate API error", exc_info=exc)
    return JSONResponse({"error": "Server error. Check the Python API logs."}, status_code=500)


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_load(value: str | None, fallback: Any = None) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def user_view(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {"id": int(row["id"]), "name": row["name"], "email": row["email"]}


def rate_limit(request: Request, bucket: str, limit: int, window: int) -> None:
    ip = (request.client.host if request.client else "unknown")[:64]
    key = (bucket, ip)
    current = time.time()
    with rate_lock:
        start, count = rate_state.get(key, (current, 0))
        if current - start >= window:
            start, count = current, 0
        count += 1
        rate_state[key] = (start, count)
    if count > limit:
        retry = max(1, int(window - (current - start)))
        raise HTTPException(429, "Too many requests. Please try again shortly.", headers={"Retry-After": str(retry)})


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def encode_token(payload: dict[str, Any]) -> str:
    header = b64url(json_dump({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64url(json_dump(payload).encode())
    signature = b64url(hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
    return f"{header}.{body}.{signature}"


def create_token(user: dict[str, Any]) -> str:
    session_id = secrets.token_hex(32)
    with database() as db:
        db.execute(
            "INSERT INTO auth_sessions(session_id,user_id,created_at) VALUES(?,?,?)",
            (hashlib.sha256(session_id.encode()).hexdigest(), user["id"], now_text()),
        )
    issued = int(time.time())
    return encode_token(
        {
            "sub": user["id"],
            "name": user["name"],
            "email": user["email"],
            "iat": issued,
            "exp": issued + TOKEN_TTL,
            "sid": session_id,
        }
    )


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not re.match(r"^Bearer\s+\S+$", authorization, re.I):
        raise HTTPException(401, "Authentication required")
    token = authorization.split(None, 1)[1]
    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(401, "Invalid session.")
    header, body, signature = parts
    expected = b64url(hmac.new(JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "Invalid session.")
    try:
        padding = "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(body + padding))
        issued, expires = int(payload["iat"]), int(payload["exp"])
        session_id, user_id = str(payload["sid"]), int(payload["sub"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(401, "Invalid session.") from None
    current = int(time.time())
    if issued > current or expires <= current or expires <= issued or expires - issued > TOKEN_TTL:
        raise HTTPException(401, "Session expired. Please sign in again.")
    with database() as db:
        session = db.execute(
            "SELECT 1 FROM auth_sessions WHERE session_id=? AND user_id=?",
            (hashlib.sha256(session_id.encode()).hexdigest(), user_id),
        ).fetchone()
    if not session:
        raise HTTPException(401, "Session ended. Please sign in again.")
    return {"id": user_id, "name": str(payload.get("name", "")), "email": str(payload.get("email", "")), "session_id": session_id}


def body_name(data: dict[str, Any], default: str) -> str:
    return str(data.get("name") or default).strip()[:120] or default


def validate_url(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if len(text) > 255 or parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(400, f"Invalid {label}.")
    return text


def valid_email(value: Any) -> str:
    email = str(value or "").strip().lower()
    if len(email) > 190 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(400, "Please enter a valid email address.")
    return email


@app.get("/health")
def health():
    with database() as db:
        db.execute("SELECT 1").fetchone()
    return {"ok": True, "service": "Elevate Python API", "database": "ok"}


@app.post("/auth/register", status_code=201)
def register(data: dict[str, Any], request: Request):
    rate_limit(request, "register", 20, 900)
    name = str(data.get("name") or "").strip()
    email = valid_email(data.get("email"))
    password = str(data.get("password") or "")
    if len(name) < 2:
        raise HTTPException(400, "Please enter your full name.")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if len(password.encode()) > 72:
        raise HTTPException(400, "Password must be 72 bytes or fewer.")
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        with database() as db:
            cursor = db.execute(
                "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",
                (name[:120], email, password_hash),
            )
            user = {"id": cursor.lastrowid, "name": name[:120], "email": email}
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists.") from None
    return {"user": user, "token": create_token(user)}


@app.post("/auth/login")
def login(data: dict[str, Any], request: Request):
    rate_limit(request, "login", 30, 900)
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not password:
        raise HTTPException(401, "Incorrect email or password.")
    with database() as db:
        row = db.execute("SELECT id,name,email,password_hash FROM users WHERE email=?", (email,)).fetchone()
    if not row:
        raise HTTPException(401, "Incorrect email or password.")
    try:
        valid = bcrypt.checkpw(password.encode(), row["password_hash"].encode())
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(401, "Incorrect email or password.")
    user = user_view(row)
    return {"user": user, "token": create_token(user)}


@app.post("/auth/logout")
def logout(user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        db.execute(
            "DELETE FROM auth_sessions WHERE session_id=? AND user_id=?",
            (hashlib.sha256(user["session_id"].encode()).hexdigest(), user["id"]),
        )
    return {"ok": True}


@app.get("/auth/me")
def get_me(user: dict[str, Any] = Depends(current_user)):
    return {"user": user_view(user)}


def send_password_reset_email(recipient: str, recipient_name: str, reset_url: str) -> None:
    host = os.getenv("ELEVATE_SMTP_HOST", "").strip()
    username = os.getenv("ELEVATE_SMTP_USERNAME", "").strip()
    password = os.getenv("ELEVATE_SMTP_PASSWORD", "")
    sender = os.getenv("ELEVATE_MAIL_FROM", "").strip()
    encryption = os.getenv("ELEVATE_SMTP_ENCRYPTION", "tls").lower()
    port = int(os.getenv("ELEVATE_SMTP_PORT", "587"))
    base_url = os.getenv("ELEVATE_BASE_URL", "").strip().rstrip("/")
    if not all((host, username, password, sender, base_url)) or encryption not in ("tls", "ssl"):
        raise HTTPException(503, "Password reset email is not configured. Set the SMTP environment variables.")
    if os.getenv("ELEVATE_ENV", "development").lower() == "production" and not base_url.startswith("https://"):
        raise HTTPException(503, "Password reset email requires an HTTPS ELEVATE_BASE_URL in production.")
    message = EmailMessage()
    message["Subject"] = "Reset your Elevate password"
    message["From"] = f'{os.getenv("ELEVATE_MAIL_FROM_NAME", "Elevate")} <{sender}>'
    message["To"] = recipient
    message.set_content(
        f"Hello {recipient_name},\n\nUse this link within 60 minutes to reset your Elevate password:\n"
        f"{reset_url}\n\nIf you did not request this, you can ignore this email."
    )
    message.add_alternative(
        f"<p>Hello {html.escape(recipient_name)},</p><p>Use this link within 60 minutes:</p>"
        f'<p><a href="{html.escape(reset_url, quote=True)}">Reset your password</a></p>'
        "<p>If you did not request this, you can ignore this email.</p>",
        subtype="html",
    )
    if encryption == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(message)


@app.post("/auth/forgot-password")
def forgot_password(data: dict[str, Any], request: Request):
    rate_limit(request, "forgot-password", 20, 900)
    email = valid_email(data.get("email"))
    base_url = os.getenv("ELEVATE_BASE_URL", "http://localhost/Elevate").rstrip("/")
    with database() as db:
        user = db.execute("SELECT id,name,email FROM users WHERE email=?", (email,)).fetchone()
        if user:
            token = secrets.token_hex(32)
            now = datetime.now()
            db.execute(
                "INSERT INTO password_resets(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=excluded.created_at",
                (user["id"], hashlib.sha256(token.encode()).hexdigest(), (now + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"), now.strftime("%Y-%m-%d %H:%M:%S")),
            )
    if user:
        reset_url = f"{base_url}/reset-password.html?token={quote(token)}"
        try:
            send_password_reset_email(user["email"], user["name"], reset_url)
        except HTTPException:
            with database() as db:
                db.execute(
                    "DELETE FROM password_resets WHERE user_id=? AND token_hash=?",
                    (user["id"], hashlib.sha256(token.encode()).hexdigest()),
                )
            raise
        except Exception as exc:
            logging.error("Password reset email delivery failed: %s", exc)
            with database() as db:
                db.execute(
                    "DELETE FROM password_resets WHERE user_id=? AND token_hash=?",
                    (user["id"], hashlib.sha256(token.encode()).hexdigest()),
                )
            raise HTTPException(502, "The reset email could not be sent. Check the SMTP server settings and try again.") from None
    elif not all(os.getenv(key) for key in ("ELEVATE_SMTP_HOST", "ELEVATE_SMTP_USERNAME", "ELEVATE_SMTP_PASSWORD", "ELEVATE_MAIL_FROM")):
        raise HTTPException(503, "Password reset email is not configured. Set the SMTP environment variables.")
    return {"ok": True, "message": "If that email belongs to an Elevate account, password reset instructions will arrive shortly."}


@app.post("/auth/reset-password")
def reset_password(data: dict[str, Any], request: Request):
    rate_limit(request, "reset-password", 20, 900)
    token = str(data.get("token") or "").strip()
    password = str(data.get("password") or "")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if len(password.encode()) > 72:
        raise HTTPException(400, "Password must be 72 bytes or fewer.")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", token):
        raise HTTPException(400, "This reset link is invalid or has expired. Request a new one.")
    now = datetime.now()
    with database() as db:
        row = db.execute(
            "SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?",
            (hashlib.sha256(token.encode()).hexdigest(), now.strftime("%Y-%m-%d %H:%M:%S")),
        ).fetchone()
        if not row:
            raise HTTPException(400, "This reset link is invalid or has expired. Request a new one.")
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash, row["user_id"]))
        db.execute("DELETE FROM password_resets WHERE user_id=?", (row["user_id"],))
        db.execute("DELETE FROM auth_sessions WHERE user_id=?", (row["user_id"],))
    return {"ok": True, "message": "Your password has been reset. You can now sign in."}


@app.get("/profile")
def get_profile(user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        row = db.execute("SELECT * FROM profiles WHERE user_id=?", (user["id"],)).fetchone()
    profile = {
        "phone": row["phone"] or "",
        "location": row["location"] or "",
        "headline": row["headline"] or "",
        "bio": row["bio"] or "",
        "website": row["website"] or "",
        "linkedin": row["linkedin"] or "",
        "skills": json_load(row["skills"], []),
        "preferences": json_load(row["preferences"], {}),
    } if row else {"phone": "", "location": "", "headline": "", "bio": "", "website": "", "linkedin": "", "skills": [], "preferences": {}}
    return {"profile": profile}


@app.put("/profile")
def put_profile(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    phone = str(data.get("phone") or "").strip()[:40]
    location = str(data.get("location") or "").strip()[:160]
    headline = str(data.get("headline") or "").strip()[:180]
    bio = str(data.get("bio") or "").strip()[:3000]
    website = validate_url(str(data.get("website") or "").strip()[:255], "website")
    linkedin = validate_url(str(data.get("linkedin") or "").strip()[:255], "LinkedIn URL")
    skills = [str(skill).strip()[:60] for skill in data.get("skills", []) if str(skill).strip()] if isinstance(data.get("skills"), list) else []
    preferences = data.get("preferences") if isinstance(data.get("preferences"), dict) else {}
    updated = now_text()
    with database() as db:
        db.execute(
            "INSERT INTO profiles(user_id,phone,location,headline,bio,website,linkedin,skills,preferences,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,location=excluded.location,"
            "headline=excluded.headline,bio=excluded.bio,website=excluded.website,linkedin=excluded.linkedin,"
            "skills=excluded.skills,preferences=excluded.preferences,updated_at=excluded.updated_at",
            (user["id"], phone, location, headline, bio, website, linkedin, json_dump(skills), json_dump(preferences), updated),
        )
    return {"ok": True, "profile": {"phone": phone, "location": location, "headline": headline, "bio": bio, "website": website, "linkedin": linkedin, "skills": skills, "preferences": preferences}, "updatedAt": updated}


def list_data(table: str, user_id: int, select: str, order: str) -> list[sqlite3.Row]:
    with database() as db:
        return db.execute(f"SELECT {select} FROM {table} WHERE user_id=? ORDER BY {order}", (user_id,)).fetchall()


@app.get("/resumes")
def get_resumes(user: dict[str, Any] = Depends(current_user)):
    rows = list_data("resumes", user["id"], "id,name,data,created_at,updated_at", "updated_at DESC")
    return {"resumes": [{"id": row["id"], "name": row["name"], "data": json_load(row["data"], {}), "createdAt": row["created_at"], "updatedAt": row["updated_at"]} for row in rows]}


@app.post("/resumes", status_code=201)
def create_resume(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    name, payload, now = body_name(data, "Untitled Resume"), json_dump(data.get("data", {})), now_text()
    with database() as db:
        cursor = db.execute("INSERT INTO resumes(user_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)", (user["id"], name, payload, now, now))
        resume_id = cursor.lastrowid
    return {"id": resume_id, "name": name, "data": data.get("data", {}), "createdAt": now, "updatedAt": now}


@app.get("/resumes/{resume_id}")
def get_resume(resume_id: int, user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        row = db.execute("SELECT * FROM resumes WHERE id=? AND user_id=?", (resume_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(404, "Resume not found.")
    return {"resume": {"id": row["id"], "name": row["name"], "data": json_load(row["data"], {}), "createdAt": row["created_at"], "updatedAt": row["updated_at"]}}


@app.put("/resumes/{resume_id}")
def update_resume(resume_id: int, data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    now = now_text()
    with database() as db:
        result = db.execute("UPDATE resumes SET name=?,data=?,updated_at=? WHERE id=? AND user_id=?", (body_name(data, "Untitled Resume"), json_dump(data.get("data", {})), now, resume_id, user["id"]))
    if not result.rowcount:
        raise HTTPException(404, "Resume not found.")
    return {"ok": True, "updatedAt": now}


@app.delete("/resumes/{resume_id}")
def delete_resume(resume_id: int, user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        result = db.execute("DELETE FROM resumes WHERE id=? AND user_id=?", (resume_id, user["id"]))
    if not result.rowcount:
        raise HTTPException(404, "Resume not found.")
    return {"ok": True}


@app.get("/jobs")
def get_jobs(user: dict[str, Any] = Depends(current_user)):
    rows = list_data("saved_jobs", user["id"], "id,job_key,data,created_at", "created_at DESC")
    return {"jobs": [{"id": r["id"], "jobKey": r["job_key"], "data": json_load(r["data"], {}), "createdAt": r["created_at"]} for r in rows]}


@app.post("/jobs", status_code=201)
def save_job(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    key = str(data.get("jobKey") or "").strip()
    if not key:
        raise HTTPException(400, "Job key required.")
    with database() as db:
        db.execute("INSERT INTO saved_jobs(user_id,job_key,data) VALUES(?,?,?) ON CONFLICT(user_id,job_key) DO UPDATE SET data=excluded.data", (user["id"], key, json_dump(data.get("data", {}))))
    return {"ok": True}


@app.delete("/jobs/{job_key:path}")
def delete_job(job_key: str, user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        db.execute("DELETE FROM saved_jobs WHERE user_id=? AND job_key=?", (user["id"], job_key))
    return {"ok": True}


@app.get("/applications")
def get_applications(user: dict[str, Any] = Depends(current_user)):
    rows = list_data("applications", user["id"], "id,job_key,data,created_at,updated_at", "updated_at DESC")
    return {"applications": [{"id": r["id"], "jobKey": r["job_key"], "data": json_load(r["data"], {}), "createdAt": r["created_at"], "updatedAt": r["updated_at"]} for r in rows]}


@app.post("/applications", status_code=201)
def save_application(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    key, now = str(data.get("jobKey") or "").strip(), now_text()
    if not key:
        raise HTTPException(400, "Job key required.")
    with database() as db:
        db.execute(
            "INSERT INTO applications(user_id,job_key,data,created_at,updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(user_id,job_key) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            (user["id"], key, json_dump(data.get("data", {})), now, now),
        )
    return {"ok": True, "updatedAt": now}


@app.delete("/applications/{job_key:path}")
def delete_application(job_key: str, user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        db.execute("DELETE FROM applications WHERE user_id=? AND job_key=?", (user["id"], job_key))
    return {"ok": True}


@app.get("/career")
def get_career(user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        row = db.execute("SELECT data,updated_at FROM career_results WHERE user_id=?", (user["id"],)).fetchone()
    return {"career": json_load(row["data"], {}) if row else None, "updatedAt": row["updated_at"] if row else None}


@app.post("/career")
def save_career(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    updated = now_text()
    with database() as db:
        db.execute("INSERT INTO career_results(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at", (user["id"], json_dump(data.get("data", {})), updated))
    return {"ok": True, "updatedAt": updated}


@app.get("/letters")
def get_letters(user: dict[str, Any] = Depends(current_user)):
    rows = list_data("letters", user["id"], "id,name,data,created_at,updated_at", "updated_at DESC")
    return {"letters": [{"id": r["id"], "name": r["name"], "data": json_load(r["data"], {}), "createdAt": r["created_at"], "updatedAt": r["updated_at"]} for r in rows]}


@app.post("/letters", status_code=201)
def create_letter(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    name, now = body_name(data, "Untitled Letter"), now_text()
    with database() as db:
        cursor = db.execute("INSERT INTO letters(user_id,name,data,created_at,updated_at) VALUES(?,?,?,?,?)", (user["id"], name, json_dump(data.get("data", {})), now, now))
        letter_id = cursor.lastrowid
    return {"id": letter_id, "name": name, "createdAt": now, "updatedAt": now}


@app.put("/letters/{letter_id}")
def update_letter(letter_id: int, data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    now = now_text()
    with database() as db:
        result = db.execute("UPDATE letters SET name=?,data=?,updated_at=? WHERE id=? AND user_id=?", (body_name(data, "Untitled Letter"), json_dump(data.get("data", {})), now, letter_id, user["id"]))
    if not result.rowcount:
        raise HTTPException(404, "Letter not found.")
    return {"ok": True, "updatedAt": now}


@app.delete("/letters/{letter_id}")
def delete_letter(letter_id: int, user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        result = db.execute("DELETE FROM letters WHERE id=? AND user_id=?", (letter_id, user["id"]))
    if not result.rowcount:
        raise HTTPException(404, "Letter not found.")
    return {"ok": True}


@app.get("/dashboard")
def dashboard(user: dict[str, Any] = Depends(current_user)):
    uid = user["id"]
    with database() as db:
        applications = db.execute("SELECT data FROM applications WHERE user_id=? ORDER BY updated_at DESC", (uid,)).fetchall()
        resumes = db.execute("SELECT name,updated_at FROM resumes WHERE user_id=? ORDER BY updated_at DESC LIMIT 5", (uid,)).fetchall()
        letters = db.execute("SELECT name,updated_at FROM letters WHERE user_id=? ORDER BY updated_at DESC LIMIT 5", (uid,)).fetchall()
        profile = db.execute("SELECT updated_at FROM profiles WHERE user_id=?", (uid,)).fetchone()
        career = db.execute("SELECT data,updated_at FROM career_results WHERE user_id=?", (uid,)).fetchone()
        counts = {
            "savedJobs": db.execute("SELECT COUNT(*) FROM saved_jobs WHERE user_id=?", (uid,)).fetchone()[0],
            "savedResumes": db.execute("SELECT COUNT(*) FROM resumes WHERE user_id=?", (uid,)).fetchone()[0],
            "letters": db.execute("SELECT COUNT(*) FROM letters WHERE user_id=?", (uid,)).fetchone()[0],
        }
    app_stats = {"total": 0, "applied": 0, "interview": 0, "offer": 0, "rejected": 0}
    for row in applications:
        status = str(json_load(row["data"], {}).get("status", "Applied")).lower()
        app_stats["total"] += 1
        if status in app_stats:
            app_stats[status] += 1
    recent = [{"type": "resume", "title": r["name"], "date": r["updated_at"]} for r in resumes]
    recent += [{"type": "letter", "title": r["name"], "date": r["updated_at"]} for r in letters]
    if profile:
        recent.append({"type": "profile", "title": "Profile updated", "date": profile["updated_at"]})
    recent.sort(key=lambda item: item["date"], reverse=True)
    career_data = {"data": json_load(career["data"], {}), "updatedAt": career["updated_at"]} if career else None
    return {"ok": True, "stats": {**counts, "applications": app_stats, "career": career_data, "recentActivity": recent[:6]}}


@app.get("/analytics")
def analytics(user: dict[str, Any] = Depends(current_user)):
    with database() as db:
        rows = db.execute("SELECT data,created_at,updated_at FROM applications WHERE user_id=? ORDER BY updated_at", (user["id"],)).fetchall()
    counts = {"Applied": 0, "Interview": 0, "Offer": 0, "Rejected": 0}
    monthly: dict[str, int] = {}
    days: list[float] = []
    offers: list[float] = []
    interview = rejected = 0
    for row in rows:
        item = json_load(row["data"], {})
        status = str(item.get("status", "Applied"))
        if status in counts:
            counts[status] += 1
        interview += int(status in ("Interview", "Offer"))
        rejected += int(status == "Rejected")
        try:
            applied = datetime.fromtimestamp(float(item.get("appliedAt")) / 1000) if isinstance(item.get("appliedAt"), (int, float)) else datetime.fromisoformat(str(item.get("appliedAt") or row["created_at"]))
            updated = datetime.fromisoformat(row["updated_at"])
            days.append(max(0, (updated - applied).total_seconds() / 86400))
            month = applied.strftime("%Y-%m")
        except (ValueError, TypeError, OSError):
            month = datetime.now().strftime("%Y-%m")
        monthly[month] = monthly.get(month, 0) + 1
        if status == "Offer" and isinstance(item.get("offerSalary"), (int, float)):
            offers.append(float(item["offerSalary"]))
    total = len(rows)
    return {"ok": True, "analytics": {
        "total": total, "counts": counts,
        "interviewRate": round(interview / total * 100) if total else 0,
        "offerRate": round(counts["Offer"] / total * 100) if total else 0,
        "rejectionRate": round(rejected / total * 100) if total else 0,
        "avgDaysInPipeline": round(sum(days) / len(days), 1) if days else 0,
        "averageOfferSalary": round(sum(offers) / len(offers)) if offers else None,
        "monthly": dict(sorted(monthly.items())),
    }}


@app.post("/ats-analyze")
def ats_analyze(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    resume = data.get("resume") if isinstance(data.get("resume"), dict) else {}
    description = str(data.get("jobDescription") or resume.get("targetJobDescription") or "").strip()
    text = json_dump(resume).lower()
    stop = set("the and for with from that this your you our are was were have has will into about their they them using use used not but can job role work team skills experience years required preferred plus looking who to of in on a an as or be by at it we i".split())
    job_words = list(dict.fromkeys(w for w in re.findall(r"[a-z][a-z0-9+#.-]{2,}", description.lower()) if w not in stop))
    resume_words = set(re.findall(r"[a-z][a-z0-9+#.-]{2,}", text))
    matched, missing = [w for w in job_words if w in resume_words], [w for w in job_words if w not in resume_words]
    keyword_score = round(len(matched) / len(job_words) * 100) if job_words else 100
    experience = resume.get("experience") if isinstance(resume.get("experience"), list) else []
    education = resume.get("education") if isinstance(resume.get("education"), list) else []
    projects = resume.get("projects") if isinstance(resume.get("projects"), list) else []
    skills = resume.get("skills") if isinstance(resume.get("skills"), list) else []
    scores = {
        "contact": min(100, (35 if resume.get("fullName") else 0) + (30 if resume.get("email") else 0) + (20 if resume.get("phone") else 0) + (15 if resume.get("location") else 0)),
        "summary": min(100, len(str(resume.get("summary") or "").strip()) / 80 * 100),
        "experience": min(100, (45 if experience else 0) + (35 if any(isinstance(x, dict) and x.get("desc") for x in experience) else 0) + (20 if any(re.search(r"\d", str(x.get("desc", ""))) for x in experience if isinstance(x, dict)) else 0)),
        "education": 100 if any(isinstance(x, dict) and x.get("degree") and x.get("school") for x in education) else 0,
        "skills": min(100, len(skills) * 12),
        "projects": 100 if any(isinstance(x, dict) and x.get("name") and x.get("desc") for x in projects) else 0,
        "keywords": keyword_score,
        "formatting": 100,
    }
    score = round(sum(scores.values()) / len(scores))
    summary = "Strong ATS foundation. Focus on job-specific evidence and measurable impact." if score >= 85 else "Good ATS foundation with a few areas to strengthen." if score >= 70 else "Several important ATS areas need improvement before applying."
    issues = [msg for condition, msg in [
        (len(str(resume.get("summary") or "")) < 80, "Professional summary is too short or missing."),
        (len(skills) < 6, "Add more relevant, specific skills."),
        (not resume.get("linkedin") and not resume.get("website"), "Consider adding a professional profile or portfolio link."),
        (keyword_score < 60 and bool(description), "Keyword coverage is below 60% for this job description."),
    ] if condition]
    return {"ok": True, "analysis": {"score": score, "sectionScores": scores, "matchedKeywords": matched[:40], "keywordGaps": missing[:25], "summary": summary, "issues": issues, "formattingTips": ["Use standard section names such as Summary, Experience, Education and Skills.", "Keep bullets concise and achievement-focused.", "Avoid tables, text boxes and decorative graphics in ATS-targeted versions."]}}


STOP_WORDS = set("the and for with you your our are this that from will have has about into using their they who job work role team years year all can not but what how when where then than also more most such should would could must looking required requirements responsibilities".split())


@app.post("/job-match")
def job_match(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    resume = data.get("resume") if isinstance(data.get("resume"), dict) else {}
    job = data.get("job") if isinstance(data.get("job"), dict) else {}
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}
    if profile:
        resume["skills"] = list(dict.fromkeys((resume.get("skills") if isinstance(resume.get("skills"), list) else []) + (profile.get("skills") if isinstance(profile.get("skills"), list) else [])))
        resume.setdefault("jobTitle", profile.get("preferences", {}).get("role") or profile.get("headline", ""))
        resume.setdefault("summary", profile.get("bio", ""))
    job_text = " ".join(str(job.get(k) or "") for k in ("description", "title", "company"))
    resume_text = json_dump(resume).lower()
    job_words = list(dict.fromkeys(w for w in re.findall(r"[a-z][a-z0-9+#.-]{2,}", job_text.lower()) if w not in STOP_WORDS))
    resume_words = set(re.findall(r"[a-z][a-z0-9+#.-]{2,}", resume_text))
    matched, missing = [w for w in job_words if w in resume_words], [w for w in job_words if w not in resume_words]
    keyword_percent = round(len(matched) / len(job_words) * 100) if job_words else 0
    role, job_title = str(resume.get("jobTitle") or "").lower(), str(job.get("title") or "").lower()
    score = min(98, max(35, round(keyword_percent * .75) + (10 if role and (role in job_title or job_title in role) else 0)))
    recommendations = []
    if keyword_percent < 60:
        recommendations.append("Tailor the summary and strongest experience bullets to the most relevant requirements in this job description.")
    if not resume.get("summary"):
        recommendations.append("Add a concise professional summary targeted to this role.")
    if not resume.get("experience"):
        recommendations.append("Add relevant experience or projects that demonstrate the required skills.")
    if missing:
        recommendations.append("Review the missing keywords and add only those skills or terms that are genuinely supported by your experience.")
    if score >= 80:
        recommendations.append("Strong starting match. Focus on evidence and measurable achievements rather than adding more keywords.")
    return {"ok": True, "analysis": {"score": score, "keywordCoverage": keyword_percent, "matched": matched[:30], "missing": missing[:20], "recommendations": recommendations}}


def ai_text(prompt: str, max_tokens: int = 900) -> str:
    if not OPENAI_KEY and not GEMINI_KEY:
        raise HTTPException(503, "AI is not configured yet. Set GEMINI_API_KEY or OPENAI_API_KEY on the server.")
    try:
        if GEMINI_KEY:
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                headers={"x-goog-api-key": GEMINI_KEY},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"maxOutputTokens": max_tokens},
                },
                timeout=45,
            )
        else:
            response = httpx.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                json={"model": OPENAI_MODEL, "input": prompt, "max_output_tokens": max_tokens},
                timeout=45,
            )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logging.error("AI provider request failed: %s", type(exc).__name__)
        raise HTTPException(502, "AI provider request failed.") from None
    result = response.json()
    if GEMINI_KEY:
        text = "".join(
            str(part.get("text") or "")
            for candidate in result.get("candidates", [])
            if isinstance(candidate, dict)
            for part in (candidate.get("content", {}).get("parts", []) if isinstance(candidate.get("content"), dict) else [])
            if isinstance(part, dict)
        ).strip()
    else:
        text = str(result.get("output_text") or "").strip()
        if not text:
            text = "".join(
                str(content.get("text") or "")
                for output in result.get("output", [])
                for content in output.get("content", [])
                if isinstance(content, dict)
            ).strip()
    if not text:
        raise HTTPException(502, "AI returned an empty response.")
    return text


@app.post("/ai")
def ai_task(data: dict[str, Any], request: Request, user: dict[str, Any] = Depends(current_user)):
    rate_limit(request, "ai", 30, 3600)
    task = str(data.get("task") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    rules = {
        "summary": "Write a concise ATS-friendly resume summary. Use only facts supplied; do not invent facts. Return only 2-4 sentences.",
        "experience_bullet": "Rewrite the supplied experience into 3-5 ATS-friendly bullets using only its facts. Return each line with '- '.",
        "project_description": "Rewrite the supplied project into 2-4 concise resume bullets using only supplied facts. Return each line with '- '.",
        "tailor_resume": "Return ONLY valid JSON with keys jobTitle, summary, experience, education, skills, projects. Preserve structure and facts; never invent qualifications or metrics.",
        "cover_letter": "Write a concise, tailored professional cover letter using only resume facts; do not invent experience or achievements.",
        "ats_analyze": "Return ONLY valid JSON with score, summary, strengths, issues, keywordGaps, formattingTips, sectionScores. Use only supplied facts.",
        "interview_prep": "Return ONLY valid JSON with roleSummary, likelyQuestions, behavioralQuestions, technicalQuestions, questionsToAsk, talkingPoints, risks, preparationPlan. Do not invent candidate facts.",
    }
    if task not in rules:
        raise HTTPException(400, "Unsupported AI task.")
    resume = payload.get("resume") if isinstance(payload.get("resume"), dict) else {}
    prompt = (
        f"{rules[task]}\n\nRESUME DATA:\n{json_dump(resume)}"
        f"\n\nITEM:\n{json_dump(payload.get('item', {}))}"
        f"\n\nJOB DESCRIPTION:\n{str(payload.get('jobDescription') or '')[:12000]}"
    )
    return {"ok": True, "task": task, "text": ai_text(prompt, 700)}


@app.post("/career-plan")
def career_plan(data: dict[str, Any], request: Request, user: dict[str, Any] = Depends(current_user)):
    rate_limit(request, "career-plan", 12, 3600)
    context = data.get("context") if isinstance(data.get("context"), dict) else {}
    profile = context.get("profile") if isinstance(context.get("profile"), dict) else {}
    resume = context.get("resume") if isinstance(context.get("resume"), dict) else {}
    career = context.get("careerResult") if isinstance(context.get("careerResult"), dict) else {}
    applications = context.get("applications") if isinstance(context.get("applications"), list) else []
    plan: dict[str, Any] = {"priorities": [], "skills": [], "weeks": [], "strategy": [], "notes": []}
    if OPENAI_KEY or GEMINI_KEY:
        prompt = (
            "Create a personalized 30-day career plan. Return ONLY JSON with priorities (3-5 {title,detail}), "
            "skills (up to 6 {name,reason,level}), weeks (exactly 4 {title,text}), strategy (3-5 strings), "
            "notes (2-4 strings). Use only supplied facts; do not invent qualifications or achievements.\n"
            f"CAREER ASSESSMENT:\n{json_dump(career)[:5000]}\nPROFILE:\n{json_dump(profile)[:7000]}"
            f"\nRESUME:\n{json_dump(resume)[:12000]}\nAPPLICATIONS:\n{json_dump(applications[:30])[:10000]}"
        )
        try:
            plan = json.loads(ai_text(prompt, 1000))
            if isinstance(plan, dict) and plan.get("priorities"):
                plan["ai"] = True
                return {"ok": True, "ai": True, "plan": plan}
        except (HTTPException, json.JSONDecodeError):
            logging.warning("AI career plan unavailable; using guided plan.")
    roles = career.get("roles") if isinstance(career.get("roles"), list) else []
    role = str((roles[0] if roles else None) or profile.get("preferences", {}).get("role") or resume.get("jobTitle") or "your target role")
    skills = career.get("skills") if isinstance(career.get("skills"), list) else []
    suggested = [{"name": str(skill), "reason": f"Build this skill to support your {role} career direction.", "level": 45 + index * 10} for index, skill in enumerate(skills[:3])]
    if not suggested:
        suggested = [
            {"name": "Role-specific keywords", "reason": "Align truthful resume language with target job descriptions.", "level": 55},
            {"name": "Achievement storytelling", "reason": "Make existing experience easier for recruiters to understand.", "level": 50},
            {"name": "Interview communication", "reason": "Practice clear, structured answers for common interview themes.", "level": 45},
        ]
    plan = {
        "priorities": [
            {"title": f"Build toward {role}", "detail": "Align your profile, resume and next steps with your career direction."},
            {"title": "Build a high-fit application pipeline", "detail": "Focus on a manageable set of roles where your current experience genuinely matches."},
            {"title": "Improve interview conversion", "detail": "Prepare concise examples that connect your real experience to the target role."},
        ],
        "skills": suggested,
        "weeks": [
            {"title": "Week 1", "text": "Review your career direction and polish your targeted profile and resume."},
            {"title": "Week 2", "text": "Target high-fit jobs and tailor priority applications."},
            {"title": "Week 3", "text": "Practice interviews and strengthen a role-related skill."},
            {"title": "Week 4", "text": "Review outcomes, follow up and refine your strategy."},
        ],
        "strategy": ["Prioritize fit over application volume.", "Tailor truthful keywords to each priority role.", "Review your funnel weekly and adjust based on outcomes."],
        "notes": ["This plan uses only information available in Elevate.", "AI must not be used to invent qualifications or achievements."],
        "ai": False,
    }
    return {"ok": True, "ai": False, "plan": plan}


def guided_copilot(message: str, context: dict[str, Any], *, ai_unavailable: bool = False) -> str:
    profile = context.get("profile") or {}
    resume = context.get("resume") or {}
    applications = context.get("applications") or []
    skills = list(dict.fromkeys(str(s.get("name", s.get("skill", ""))) if isinstance(s, dict) else str(s) for s in (profile.get("skills") or []) + (resume.get("skills") or [])))
    skills = [s for s in skills if s]
    role = profile.get("preferences", {}).get("role") or profile.get("headline") or resume.get("jobTitle") or ""
    q = message.lower()
    if re.search(r"\b(download|save|export|print|get)\b", q) and re.search(r"\b(resume|cv|curriculum vitae)\b", q):
        answer = "To download your resume as a PDF, open Resume Builder, complete your details, and click Download PDF below the preview. Use Export for a JSON backup."
    elif re.search(r"\b(ats|applicant tracking|keywords|keyword|screening)\b", q):
        answer = "Use a simple layout, standard section headings, and keywords from the actual job description. Support important skills with honest examples; do not add skills or qualifications you do not have."
        if skills:
            answer += "\n\nSkills currently listed: " + ", ".join(skills[:10]) + "."
    elif re.search(r"\b(resume|cv)\b", q) and re.search(r"\b(review|improve|fix|better|stronger|check|feedback)\b", q):
        gaps = []
        if not resume:
            answer = "I cannot see a resume saved to your account yet. Open Resume Builder, complete your details and save the resume, then ask me for feedback again."
        else:
            if not resume.get("fullName"): gaps.append("add your name and contact details")
            if not resume.get("summary"): gaps.append("write a short summary targeted to your desired role")
            if not skills: gaps.append("add relevant skills you can demonstrate")
            if not resume.get("experience") and not resume.get("projects"): gaps.append("include experience or projects with specific outcomes")
            answer = "The clearest next improvements are:\n\n• " + "\n• ".join(gaps[:4]) if gaps else "Your saved resume has its main sections in place. Tailor the summary and first experience bullets to a real job description, and include measurable outcomes where you can support them."
    elif re.search(r"\b(application|applications|pipeline|interview|offer|follow.?up)\b", q):
        interviews = sum(item.get("status") == "Interview" for item in applications)
        offers = sum(item.get("status") == "Offer" for item in applications)
        answer = f"Your account currently has {len(applications)} tracked applications, {interviews} marked for interview, and {offers} marked as offers. Review active roles and follow up when the employer's response window has passed."
    elif re.search(r"\b(job|jobs|role|roles|career|direction|search|opportunit)\b", q):
        answer = f"Your saved profile points toward “{role}”." if role else "I could not find a target role in your profile or resume yet."
        answer += (" Skills listed include " + ", ".join(skills[:6]) + ".") if skills else ""
        answer += "\n\nUse Jobs to search live openings, check each posting's requirements, and track roles after you apply."
    elif re.search(r"\b(week|weekly|plan|next step|focus|priority)\b", q):
        steps = []
        if not profile.get("headline") or not skills: steps.append("Complete your profile headline, target role, and skills.")
        if not resume.get("summary"): steps.append("Finish and save a concise, role-focused resume summary.")
        steps.append("Choose relevant live listings and tailor your applications honestly.")
        answer = "Here is a practical plan for this week:\n\n• " + "\n• ".join(steps[:4])
    else:
        answer = "I’m in guided mode, so I can help with your saved Elevate career data. Tell me whether you want help with your resume, ATS keywords, job search, or application follow-ups."
    status = (
        "Guided Copilot (AI service unavailable; using saved career data):"
        if ai_unavailable
        else "Guided Copilot (AI not configured; using saved career data):"
    )
    return status + "\n\n" + answer


@app.post("/copilot")
def copilot(data: dict[str, Any], user: dict[str, Any] = Depends(current_user)):
    message = str(data.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "Please enter a question.")
    if len(message) > 1800:
        raise HTTPException(400, "Message is too long.")
    uid = user["id"]
    with database() as db:
        profile = db.execute("SELECT * FROM profiles WHERE user_id=?", (uid,)).fetchone()
        resume = db.execute("SELECT name,data FROM resumes WHERE user_id=? ORDER BY updated_at DESC LIMIT 1", (uid,)).fetchone()
        applications = db.execute("SELECT data FROM applications WHERE user_id=? ORDER BY updated_at DESC LIMIT 30", (uid,)).fetchall()
        saved = db.execute("SELECT data FROM saved_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 20", (uid,)).fetchall()
        career = db.execute("SELECT data FROM career_results WHERE user_id=?", (uid,)).fetchone()
    profile_data = None
    if profile:
        profile_data = {key: profile[key] for key in ("phone", "location", "headline", "bio", "website", "linkedin")}
        profile_data.update({"skills": json_load(profile["skills"], []), "preferences": json_load(profile["preferences"], {})})
    context = {
        "user": {"name": user["name"], "email": user["email"]},
        "profile": profile_data,
        "resume": json_load(resume["data"], {}) if resume else None,
        "applications": [json_load(r["data"], {}) for r in applications],
        "savedJobs": [json_load(r["data"], {}) for r in saved],
        "career": json_load(career["data"], {}) if career else None,
    }
    reply, mode = "", "guided"
    if OPENAI_KEY or GEMINI_KEY:
        prompt = "You are Elevate Career Copilot. Give concise practical career guidance using ONLY supplied context. Never invent experience, employers, achievements, skills or job facts. The user asks: " + message + "\nCONTEXT:\n" + json_dump(context)
        try:
            reply, mode = ai_text(prompt), "ai"
        except HTTPException:
            logging.warning("Copilot AI request failed; using guided mode.")
    if not reply:
        reply = guided_copilot(message, context, ai_unavailable=bool(OPENAI_KEY or GEMINI_KEY))
    return {"ok": True, "mode": mode, "reply": reply}


def fetch_json(url: str, params: dict[str, Any] | None = None) -> tuple[dict[str, Any], int]:
    try:
        response = httpx.get(url, params=params, headers={"Accept": "application/json", "User-Agent": "ElevateCareerPlatform/1.0"}, timeout=20)
    except httpx.HTTPError:
        raise HTTPException(502, "Live job listings are temporarily unavailable. Please try again shortly.") from None
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return payload if isinstance(payload, dict) else {}, response.status_code


@app.get("/job-search")
def job_search(request: Request, what: str = "", where: str = "", type: str = "", page: int = 1, limit: int = 20):
    rate_limit(request, "job-search", 60, 3600)
    app_id, app_key = os.getenv("ADZUNA_APP_ID", "").strip(), os.getenv("ADZUNA_APP_KEY", "").strip()
    if not app_id or not app_key:
        page, limit = max(1, min(50, page)), max(1, min(20, limit))
        params: dict[str, Any] = {"sort": "recent", "page": page, "limit": limit}
        if where.lower() == "remote":
            params["worldwide"] = "true"
        elif where:
            params["country"] = "IN"
        employment = {"full-time": "Full Time", "part-time": "Part Time", "internship": "Intern"}
        if type.lower() in employment:
            params["employment_type"] = employment[type.lower()]
        if what.strip():
            params["q"] = what.strip()
        result, status = fetch_json("https://himalayas.app/jobs/api/search", params)
        if not 200 <= status < 300 or not isinstance(result.get("jobs"), list):
            raise HTTPException(502, "Live job listings are temporarily unavailable. Please try again shortly.")
        jobs = []
        for job in result["jobs"]:
            title = str(job.get("title") or "").strip()
            if not title:
                continue
            url = str(job.get("applicationLink") or job.get("guid") or "")
            host = urlparse(url).hostname or ""
            if urlparse(url).scheme not in ("http", "https") or host.lower() not in ("himalayas.app", "www.himalayas.app"):
                url = "https://himalayas.app/jobs"
            emp = str(job.get("employmentType") or "").lower().strip()
            job_type = {"full time": "full-time", "part time": "part-time", "intern": "internship"}.get(emp, "other")
            locations = [str(item).strip() for item in job.get("locationRestrictions", []) if str(item).strip()]
            salary_fields = [job.get(key) for key in ("minSalary", "maxSalary") if isinstance(job.get(key), (int, float))]
            salary = "–".join((str(job.get("currency", "")).upper() + " " if job.get("currency") else "") + f"{value:,.0f}" for value in salary_fields)
            if salary:
                salary += " / " + str(job.get("salaryPeriod") or "annual").lower()
            timestamp = job.get("pubDate")
            posted = datetime.fromtimestamp(int(timestamp), timezone.utc).isoformat() if isinstance(timestamp, (int, float)) else ""
            description = re.sub(r"<[^>]*>", "", str(job.get("description") or job.get("excerpt") or ""))
            jobs.append({"id": str(job.get("guid") or hashlib.sha1(f"{title}|{job.get('companyName','')}".encode()).hexdigest()), "title": title, "company": str(job.get("companyName") or "Company not listed").strip(), "location": ", ".join(locations) if locations else "Remote — Worldwide", "type": job_type, "salary": salary or "Not listed", "posted": posted, "description": html.unescape(description).strip(), "url": url, "source": "Himalayas"})
        return {"configured": True, "provider": "Himalayas", "sourceUrl": "https://himalayas.app", "jobs": jobs, "count": len(jobs), "total": int(result.get("totalCount") or len(jobs))}
    page, limit = max(1, min(10, page)), max(5, min(50, limit))
    query = what.strip()
    if type == "internship" and "internship" not in query.lower():
        query = (query + " internship").strip()
    params = {"app_id": app_id, "app_key": app_key, "results_per_page": limit, "content-type": "application/json", "sort_by": "date"}
    if where.lower() == "remote":
        query = (query + " remote").strip()
    elif where:
        params["where"] = where
    if query:
        params["what"] = query
    if type == "full-time":
        params["full_time"] = 1
    elif type == "part-time":
        params["part_time"] = 1
    result, status = fetch_json(f"https://api.adzuna.com/v1/api/jobs/{quote(os.getenv('ADZUNA_COUNTRY', 'in'), safe='')}/search/{page}", params)
    if not 200 <= status < 300:
        raise HTTPException(502, str(result.get("display_name") or result.get("error") or "Job provider returned an error."))
    items = []
    for job in result.get("results", []):
        title = str(job.get("title") or "").strip()
        if not title:
            continue
        contract_time = str(job.get("contract_time") or "")
        description = str(job.get("description") or "")
        job_type = "part-time" if contract_time == "part_time" else "full-time" if contract_time == "full_time" else "internship" if "intern" in (title + description).lower() else "other"
        company = job.get("company", {}).get("display_name") or "Company not listed"
        salary_min, salary_max = job.get("salary_min"), job.get("salary_max")
        salary = ""
        if salary_min is not None or salary_max is not None:
            salary = "–".join(f"₹{float(value):,.0f}" for value in (salary_min, salary_max) if value is not None)
            if job.get("salary_is_predicted"):
                salary += " (estimated)"
        items.append({"id": str(job.get("id") or hashlib.sha1(f"{title}|{company}".encode()).hexdigest()), "title": title, "company": company, "location": job.get("location", {}).get("display_name") or "Location not listed", "type": job_type, "contractType": str(job.get("contract_type") or ""), "salary": salary or "Salary not listed", "posted": str(job.get("created") or ""), "description": re.sub(r"<[^>]*>", "", description).strip(), "url": str(job.get("redirect_url") or ""), "source": "Adzuna"})
    return {"configured": True, "provider": "Adzuna", "sourceUrl": "https://www.adzuna.com/", "jobs": items, "count": len(items), "total": int(result.get("count") or len(items))}
