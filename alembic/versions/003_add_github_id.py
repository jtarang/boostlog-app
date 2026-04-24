"""add github_id to users and make hashed_password nullable

Revision ID: 003_add_github_id
Revises: 002_rename
Create Date: 2026-04-20 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '003_add_github_id'
down_revision: Union[str, None] = '002_rename'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add github_id column to users
    op.add_column('users', sa.Column('github_id', sa.String(), nullable=True))
    op.create_index(op.f('ix_users_github_id'), 'users', ['github_id'], unique=True)
    
    # 2. Make hashed_password nullable to support GitHub SSO users
    op.alter_column('users', 'hashed_password',
               existing_type=sa.String(),
               nullable=True)


def downgrade() -> None:
    op.alter_column('users', 'hashed_password',
               existing_type=sa.String(),
               nullable=False)
    op.drop_index(op.f('ix_users_github_id'), table_name='users')
    op.drop_column('users', 'github_id')
