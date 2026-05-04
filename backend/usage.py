from datetime import datetime, timezone
from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import HTTPException
from backend.models import User, AIUsage, SubscriptionTier
import litellm

# Default fallbacks if DB is empty or tier is missing
DEFAULT_LIMITS = {
    "free": 50_000,
    "pro": 5_000_000,
    "enterprise": 100_000_000,
}

def get_monthly_usage(db: Session, user_id: int):
    """
    Returns the total tokens used by the user in the current calendar month.
    """
    now = datetime.now(timezone.utc)
    first_of_month = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    
    usage = db.query(func.sum(AIUsage.tokens_used)).filter(
        AIUsage.user_id == user_id,
        AIUsage.timestamp >= first_of_month
    ).scalar()
    
    return usage or 0

def check_usage_limit(db: Session, user: User):
    """
    Verifies if the user has enough tokens left in their monthly quota.
    Raises 402 Payment Required if limit is reached.
    """
    tier_name = user.subscription_tier or "free"
    
    # Try to fetch limit from DB
    tier_config = db.query(SubscriptionTier).filter(SubscriptionTier.name == tier_name).first()
    if tier_config:
        limit = tier_config.token_limit
    else:
        limit = DEFAULT_LIMITS.get(tier_name, DEFAULT_LIMITS["free"])
    
    current_usage = get_monthly_usage(db, user.id)
    
    if current_usage >= limit:
        raise HTTPException(
            status_code=402, 
            detail=f"Monthly AI token limit reached for your {tier_name} plan. Please upgrade for more access."
        )
    return True

def record_usage(db: Session, user_id: int, response):
    """
    Extracts usage from LiteLLM response and saves it to the database.
    """
    try:
        usage_data = getattr(response, "usage", None)
        if not usage_data:
            return
        
        # Calculate cost using LiteLLM's internal pricing data
        try:
            cost = litellm.completion_cost(completion_response=response)
        except Exception:
            cost = 0.0
            
        new_usage = AIUsage(
            user_id=user_id,
            tokens_used=usage_data.total_tokens,
            prompt_tokens=usage_data.prompt_tokens,
            completion_tokens=usage_data.completion_tokens,
            estimated_cost=cost,
            model_used=response.model
        )
        db.add(new_usage)
        db.commit()
    except Exception as e:
        print(f"Error recording AI usage: {e}")
        db.rollback()
