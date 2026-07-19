"""convert users.id and all user_id FKs to UUID (String)

⚠️  DESTRUCTIVE — this drops and recreates all application tables. An integer
PK cannot be converted to a UUID in place (the values don't cast and every FK
would need remapping), so with no production data to preserve we simply rebuild
the schema from the current (UUID) models. The lifespan re-seeds the demo user
and subscription tiers on next startup. Do NOT apply this against a database
whose data you care about.

Revision ID: 019_uuid_user_id
Revises: 018_add_apple_id
Create Date: 2026-07-19 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "019_uuid_user_id"
down_revision: Union[str, None] = "018_add_apple_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from backend.db import Base
    import backend.models  # noqa: F401  register all tables on Base.metadata

    conn = op.get_bind()
    Base.metadata.drop_all(bind=conn)   # drops only model tables (alembic_version is untouched)
    Base.metadata.create_all(bind=conn)  # rebuild with UUID user ids


def downgrade() -> None:
    # Irreversible: the models now define UUID ids, so there's no integer schema
    # to restore to. Recreate branches would need the pre-019 models.
    raise NotImplementedError("019_uuid_user_id is a one-way schema reset")
