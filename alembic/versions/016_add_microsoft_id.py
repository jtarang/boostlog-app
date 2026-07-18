"""add microsoft_id to users

Revision ID: 016_add_microsoft_id
Revises: 015_add_google_id
Create Date: 2026-07-18 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '016_add_microsoft_id'
down_revision: Union[str, None] = '015_add_google_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c['name'] for c in inspector.get_columns('users')]

    if 'microsoft_id' not in columns:
        op.add_column('users', sa.Column('microsoft_id', sa.String(), nullable=True))
        op.create_index(op.f('ix_users_microsoft_id'), 'users', ['microsoft_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_microsoft_id'), table_name='users')
    op.drop_column('users', 'microsoft_id')
