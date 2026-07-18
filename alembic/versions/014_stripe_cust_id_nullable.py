"""make user_subscriptions.stripe_customer_id nullable

Revision ID: 014_stripe_cust_id_nullable
Revises: 013_stripe_tables_if_missing
Create Date: 2026-07-17 00:00:00.000000

Some databases created `user_subscriptions` with stripe_customer_id NOT NULL
(before that column was made nullable). Because 013 only creates the table
*if missing*, those databases kept the NOT NULL constraint, which breaks
inserting a subscription row before a real Stripe customer exists (the row is
created with stripe_customer_id = NULL and filled in later). This migration
drops the NOT NULL constraint idempotently.

Postgres-only: SQLite fallback databases already create the column nullable
(SQLite also can't ALTER COLUMN in place), so this is a no-op there.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '014_stripe_cust_id_nullable'
down_revision: Union[str, None] = '013_stripe_tables_if_missing'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return

    inspector = sa.inspect(bind)
    if 'user_subscriptions' not in inspector.get_table_names():
        return

    col = next(
        (c for c in inspector.get_columns('user_subscriptions') if c['name'] == 'stripe_customer_id'),
        None,
    )
    if col is not None and col.get('nullable') is False:
        op.alter_column(
            'user_subscriptions',
            'stripe_customer_id',
            existing_type=sa.String(),
            nullable=True,
        )


def downgrade() -> None:
    # Intentionally not re-adding NOT NULL: existing rows may legitimately hold
    # NULL stripe_customer_id, which would make the constraint un-restorable.
    pass
