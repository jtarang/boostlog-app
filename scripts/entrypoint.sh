#!/bin/sh

set -e

# Wait for database container to be ready
echo "Waiting for database to be ready..."
python3 << END
import sys
import time
import sqlalchemy
import os

db_url = os.getenv("DATABASE_URL")
if not db_url or "sqlite" in db_url:
    print("Skipping DB wait (SQLite or no URL)")
    sys.exit(0)

# Fix for SQLAlchemy 1.4+ which requires 'postgresql://' instead of 'postgres://'
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = sqlalchemy.create_engine(db_url)
retries = 30
while retries > 0:
    try:
        connection = engine.connect()
        connection.close()
        print("Database is ready!")
        sys.exit(0)
    except Exception as e:
        print(f"Database not ready yet... ({e})")
        time.sleep(1)
        retries -= 1

print("Failed to connect to database. Exiting.")
sys.exit(1)
END

# Apply database migrations
echo "Applying database migrations..."
alembic upgrade head

# Execute the main command
echo "Starting application..."
exec "$@"
