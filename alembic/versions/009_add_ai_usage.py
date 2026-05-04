"""add ai_usage and subscription_tier

Revision ID: 009_add_ai_usage
Revises: 62cbaef0327f
Create Date: 2026-05-04 16:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '009_add_ai_usage'
down_revision: Union[str, None] = '62cbaef0327f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add subscription_tier to users
    op.add_column('users', sa.Column('subscription_tier', sa.String(), server_default='free', nullable=False))
    
    # Create ai_usage table
    op.create_table('ai_usage',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('tokens_used', sa.Integer(), nullable=True),
        sa.Column('prompt_tokens', sa.Integer(), nullable=True),
        sa.Column('completion_tokens', sa.Integer(), nullable=True),
        sa.Column('estimated_cost', sa.Float(), nullable=True),
        sa.Column('model_used', sa.String(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ai_usage_id'), 'ai_usage', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ai_usage_id'), table_name='ai_usage')
    op.drop_table('ai_usage')
    op.drop_column('users', 'subscription_tier')
