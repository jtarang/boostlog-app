"""add passkeys and reset token

Revision ID: 006_add_passkeys
Revises: 005_add_project_status
Create Date: 2026-04-26 05:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '006_add_passkeys'
down_revision: Union[str, None] = '005_add_project_status'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    
    # 1. Update Users table
    user_cols = [c['name'] for c in inspector.get_columns('users')]
    if 'webauthn_id' not in user_cols:
        op.add_column('users', sa.Column('webauthn_id', sa.String(), nullable=True))
        op.create_index(op.f('ix_users_webauthn_id'), 'users', ['webauthn_id'], unique=True)
    if 'password_reset_token' not in user_cols:
        op.add_column('users', sa.Column('password_reset_token', sa.String(), nullable=True))
        op.create_index(op.f('ix_users_password_reset_token'), 'users', ['password_reset_token'], unique=True)
    if 'password_reset_expiry' not in user_cols:
        op.add_column('users', sa.Column('password_reset_expiry', sa.DateTime(timezone=True), nullable=True))

    # 2. Create UserCredential table
    tables = inspector.get_table_names()
    if 'user_credentials' not in tables:
        op.create_table(
            'user_credentials',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('credential_id', sa.String(), nullable=False),
            sa.Column('public_key', sa.String(), nullable=False),
            sa.Column('sign_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('transports', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_user_credentials_credential_id'), 'user_credentials', ['credential_id'], unique=True)
        op.create_index(op.f('ix_user_credentials_id'), 'user_credentials', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_credentials_id'), table_name='user_credentials')
    op.drop_index(op.f('ix_user_credentials_credential_id'), table_name='user_credentials')
    op.drop_table('user_credentials')
    op.drop_index(op.f('ix_users_password_reset_token'), table_name='users')
    op.drop_column('users', 'password_reset_expiry')
    op.drop_column('users', 'password_reset_token')
    op.drop_index(op.f('ix_users_webauthn_id'), table_name='users')
    op.drop_column('users', 'webauthn_id')
