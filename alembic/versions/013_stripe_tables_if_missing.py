"""create stripe tables if missing

Revision ID: 013_stripe_tables_if_missing
Revises: 012_add_bootmod3_link
Create Date: 2026-07-17 00:00:00.000000

Databases created before the Stripe work was cherry-picked were stamped past
revision 011 while it was still a no-op stub, so Alembic will never re-run 011
to create the `payment_methods` / `user_subscriptions` tables. This migration
creates them idempotently (guarded on table existence) so already-migrated
environments pick them up. Fresh databases get the tables from 011 and skip
the creates here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '013_stripe_tables_if_missing'
down_revision: Union[str, None] = '012_add_bootmod3_link'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = inspector.get_table_names()

    if 'payment_methods' not in existing:
        op.create_table('payment_methods',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('stripe_payment_method_id', sa.String(), nullable=False),
            sa.Column('card_last_four', sa.String(), nullable=False),
            sa.Column('card_brand', sa.String(), nullable=False),
            sa.Column('exp_month', sa.Integer(), nullable=False),
            sa.Column('exp_year', sa.Integer(), nullable=False),
            sa.Column('is_default', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('stripe_payment_method_id')
        )
        op.create_index('ix_payment_methods_id', 'payment_methods', ['id'], unique=False)
        op.create_index('ix_payment_methods_stripe_payment_method_id', 'payment_methods', ['stripe_payment_method_id'], unique=True)

    if 'user_subscriptions' not in existing:
        op.create_table('user_subscriptions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('stripe_customer_id', sa.String(), nullable=True),
            sa.Column('stripe_subscription_id', sa.String(), nullable=True),
            sa.Column('tier', sa.String(), nullable=False, server_default='free'),
            sa.Column('status', sa.String(), nullable=False, server_default='inactive'),
            sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
            sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
            sa.Column('cancel_at_period_end', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id'),
            sa.UniqueConstraint('stripe_customer_id'),
            sa.UniqueConstraint('stripe_subscription_id')
        )
        op.create_index('ix_user_subscriptions_id', 'user_subscriptions', ['id'], unique=False)
        op.create_index('ix_user_subscriptions_stripe_customer_id', 'user_subscriptions', ['stripe_customer_id'], unique=True)
        op.create_index('ix_user_subscriptions_stripe_subscription_id', 'user_subscriptions', ['stripe_subscription_id'], unique=True)


def downgrade() -> None:
    # Non-destructive: these tables are owned jointly with revision 011.
    # Downgrading past 011 is what drops them; this revision is create-only.
    pass
