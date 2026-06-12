"""stub: stripe models (applied on other branch, no-op here)

Revision ID: 011_add_stripe_models
Revises: 010_add_subscription_tiers
Create Date: 2026-05-10 00:00:00.000000

This revision was created on a diverging branch that added Stripe-related
models. The database already contains those changes if it was stamped with
this revision ID. This file is a no-op stub so Alembic can locate the
revision and continue applying any remaining migrations on this branch.
"""
from typing import Sequence, Union


revision: str = '011_add_stripe_models'
down_revision: Union[str, None] = '010_add_subscription_tiers'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
