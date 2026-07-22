"""add recorded_at (source recording date) to datalogs

Revision ID: 020_add_recorded_at
Revises: 019_uuid_user_id
Create Date: 2026-07-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '020_add_recorded_at'
down_revision: Union[str, None] = '019_uuid_user_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('datalogs', sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('datalogs', 'recorded_at')
