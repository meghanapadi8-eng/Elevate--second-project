import os
import sqlite3
from datetime import date, datetime

import pymysql

from backend.main import DB_PATH, initialize_database


TABLES = {
    "users": ("id", "name", "email", "password_hash", "created_at"),
    "auth_sessions": ("session_id", "user_id", "created_at"),
    "resumes": ("id", "user_id", "name", "data", "created_at", "updated_at"),
    "saved_jobs": ("id", "user_id", "job_key", "data", "created_at"),
    "applications": ("id", "user_id", "job_key", "data", "created_at", "updated_at"),
    "career_results": ("id", "user_id", "data", "updated_at"),
    "letters": ("id", "user_id", "name", "data", "created_at", "updated_at"),
    "profiles": ("user_id", "phone", "location", "headline", "bio", "website", "linkedin", "skills", "preferences", "updated_at"),
    "password_resets": ("user_id", "token_hash", "expires_at", "created_at"),
}


def sqlite_value(value):
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return value


def main():
    mysql = pymysql.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "elevate"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )
    initialize_database()
    target = sqlite3.connect(DB_PATH)
    target.execute("PRAGMA foreign_keys = ON")
    try:
        existing = [
            f"{table}={count}"
            for table in TABLES
            if (count := target.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        ]
        if existing:
            raise RuntimeError(f"{DB_PATH} already contains data ({', '.join(existing)}); refusing to merge or overwrite it.")
        with mysql.cursor() as source:
            target.execute("BEGIN")
            for table, columns in TABLES.items():
                source.execute(f"SELECT {','.join(f'`{column}`' for column in columns)} FROM `{table}`")
                rows = source.fetchall()
                if not rows:
                    continue
                placeholders = ",".join("?" for _ in columns)
                column_names = ",".join(f'"{column}"' for column in columns)
                values = [tuple(sqlite_value(row[column]) for column in columns) for row in rows]
                target.executemany(f'INSERT INTO "{table}" ({column_names}) VALUES ({placeholders})', values)
                print(f"Copied {len(rows)} rows from {table}.")
        target.commit()
        print(f"Migration complete: {DB_PATH}")
        print("Users should sign in again after migration.")
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()
        mysql.close()


if __name__ == "__main__":
    main()
