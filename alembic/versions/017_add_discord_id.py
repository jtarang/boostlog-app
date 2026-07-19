"""add discord_id to users

Revision ID: 017_add_discord_id
Revises: 016_add_microsoft_id
Create Date: 2026-07-18 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '017_add_discord_id'
down_revision: Union[str, None] = '016_add_microsoft_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c['name'] for c in inspector.get_columns('users')]

    if 'discord_id' not in columns:
        op.add_column('users', sa.Column('discord_id', sa.String(), nullable=True))
        op.create_index(op.f('ix_users_discord_id'), 'users', ['discord_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_discord_id'), table_name='users')
    op.drop_column('users', 'discord_id')
