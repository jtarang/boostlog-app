"""add apple_id to users

Revision ID: 018_add_apple_id
Revises: 017_add_discord_id
Create Date: 2026-07-18 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '018_add_apple_id'
down_revision: Union[str, None] = '017_add_discord_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c['name'] for c in inspector.get_columns('users')]

    if 'apple_id' not in columns:
        op.add_column('users', sa.Column('apple_id', sa.String(), nullable=True))
        op.create_index(op.f('ix_users_apple_id'), 'users', ['apple_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_apple_id'), table_name='users')
    op.drop_column('users', 'apple_id')
