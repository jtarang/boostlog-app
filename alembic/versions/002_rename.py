"""rename original_name to display_name and add source_filename

Revision ID: 002_rename
Revises: 001_initial
Create Date: 2026-04-19 04:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_rename'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename original_name to display_name
    op.alter_column('datalogs', 'original_name', new_column_name='display_name')
    
    # 2. Add source_filename (initially nullable)
    op.add_column('datalogs', sa.Column('source_filename', sa.String(), nullable=True))
    
    # 3. Populate source_filename from display_name
    op.execute("UPDATE datalogs SET source_filename = display_name")
    
    # 4. Make it NOT NULL
    op.alter_column('datalogs', 'source_filename', nullable=False)


def downgrade() -> None:
    op.alter_column('datalogs', 'display_name', new_column_name='original_name')
    op.drop_column('datalogs', 'source_filename')
