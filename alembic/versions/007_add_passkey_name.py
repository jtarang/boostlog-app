"""add name column to user_credentials

Revision ID: 007_add_passkey_name
Revises: 006_add_passkeys
Create Date: 2026-04-26 06:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


revision: str = '007_add_passkey_name'
down_revision: Union[str, None] = '006_add_passkeys'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    cols = [c['name'] for c in inspector.get_columns('user_credentials')]
    if 'name' not in cols:
        op.add_column('user_credentials', sa.Column('name', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_credentials', 'name')
