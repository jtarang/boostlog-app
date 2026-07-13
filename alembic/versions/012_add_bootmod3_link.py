"""add bootmod3 linked-account columns to users

Revision ID: 012_add_bootmod3_link
Revises: 011_add_stripe_models
Create Date: 2026-07-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '012_add_bootmod3_link'
down_revision: Union[str, None] = '011_add_stripe_models'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('bootmod3_tokens', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('bootmod3_email', sa.String(), nullable=True))
    op.add_column('users', sa.Column('bootmod3_linked_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'bootmod3_linked_at')
    op.drop_column('users', 'bootmod3_email')
    op.drop_column('users', 'bootmod3_tokens')
