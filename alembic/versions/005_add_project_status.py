"""add status column to projects

Revision ID: 005_add_project_status
Revises: 004_add_projects
Create Date: 2026-04-26 02:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '005_add_project_status'
down_revision: Union[str, None] = '004_add_projects'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    proj_cols = [c['name'] for c in inspector.get_columns('projects')]
    if 'status' not in proj_cols:
        op.add_column('projects', sa.Column('status', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'status')
