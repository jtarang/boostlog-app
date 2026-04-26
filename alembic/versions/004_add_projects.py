"""add projects table and user detail columns

Revision ID: 004_add_projects
Revises: 003_add_github_id
Create Date: 2026-04-26 00:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '004_add_projects'
down_revision: Union[str, None] = '003_add_github_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    
    # 1. Update Users table
    user_cols = [c['name'] for c in inspector.get_columns('users')]
    if 'email' not in user_cols:
        op.add_column('users', sa.Column('email', sa.String(), nullable=True))
        op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    if 'full_name' not in user_cols:
        op.add_column('users', sa.Column('full_name', sa.String(), nullable=True))
    if 'settings_json' not in user_cols:
        op.add_column('users', sa.Column('settings_json', sa.Text(), nullable=True))

    # 2. Update Projects table
    tables = inspector.get_table_names()
    if 'projects' not in tables:
        op.create_table(
            'projects',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('vin', sa.String(), nullable=True),
            sa.Column('vehicle_model', sa.String(), nullable=True),
            sa.Column('customer_name', sa.String(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_projects_id'), 'projects', ['id'], unique=False)
    else:
        # Table exists, but maybe columns are missing (e.g. from an old partial manual creation)
        proj_cols = [c['name'] for c in inspector.get_columns('projects')]
        if 'vin' not in proj_cols:
            op.add_column('projects', sa.Column('vin', sa.String(), nullable=True))
        if 'vehicle_model' not in proj_cols:
            op.add_column('projects', sa.Column('vehicle_model', sa.String(), nullable=True))
        if 'customer_name' not in proj_cols:
            op.add_column('projects', sa.Column('customer_name', sa.String(), nullable=True))
        if 'notes' not in proj_cols:
            op.add_column('projects', sa.Column('notes', sa.Text(), nullable=True))
        if 'created_at' not in proj_cols:
            op.add_column('projects', sa.Column('created_at', sa.DateTime(timezone=True), nullable=True))

    # 3. Update Datalogs table
    log_cols = [c['name'] for c in inspector.get_columns('datalogs')]
    if 'project_id' not in log_cols:
        op.add_column('datalogs', sa.Column('project_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_datalogs_projects', 'datalogs', 'projects', ['project_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_datalogs_projects', 'datalogs', type_='foreignkey')
    op.drop_column('datalogs', 'project_id')
    op.drop_index(op.f('ix_projects_id'), table_name='projects')
    op.drop_table('projects')
    op.drop_column('users', 'settings_json')
    op.drop_column('users', 'full_name')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_column('users', 'email')
