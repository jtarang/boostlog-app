"""add subscription_tiers table

Revision ID: 010_add_subscription_tiers
Revises: 009_add_ai_usage
Create Date: 2026-05-04 17:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '010_add_subscription_tiers'
down_revision: Union[str, None] = '009_add_ai_usage'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('subscription_tiers',
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('token_limit', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('name')
    )


def downgrade() -> None:
    op.drop_table('subscription_tiers')
