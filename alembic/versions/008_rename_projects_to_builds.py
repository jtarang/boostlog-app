"""rename projects to builds

Revision ID: 008_rename_projects_to_builds
Revises: 007_add_passkey_name
Create Date: 2026-04-27 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '008_rename_projects_to_builds'
down_revision: Union[str, None] = '007_add_passkey_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename projects table to builds
    op.rename_table('projects', 'builds')
    
    # 2. Rename project_id column in datalogs to build_id
    op.alter_column('datalogs', 'project_id', new_column_name='build_id')
    
    # 3. Rename indexes if they exist
    # (Optional but good practice)
    # op.execute('ALTER INDEX ix_projects_id RENAME TO ix_builds_id')
    # op.execute('ALTER INDEX ix_projects_name RENAME TO ix_builds_name')


def downgrade() -> None:
    op.alter_column('datalogs', 'build_id', new_column_name='project_id')
    op.rename_table('builds', 'projects')
