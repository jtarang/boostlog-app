import json
from fastapi.testclient import TestClient
import os
import stripe
import time

# We set up a mock secret and generate a valid signature to test the production path
os.environ["ENVIRONMENT"] = "production"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
os.environ["DATABASE_URL"] = "sqlite:///./data/test.db"
os.environ["SKIP_AWS_FETCH"] = "true"

from backend.main import app

client = TestClient(app)

payload = {
  "id": "evt_test",
  "object": "event",
  "type": "invoice.finalized",
  "data": {
    "object": {
      "id": "in_test"
    }
  }
}
payload_str = json.dumps(payload)

# generate signature
timestamp = int(time.time())
signed_payload = f"{timestamp}.{payload_str}"
import hmac
import hashlib
sig = hmac.new(b"whsec_test", signed_payload.encode("utf-8"), hashlib.sha256).hexdigest()

headers = {
    "Stripe-Signature": f"t={timestamp},v1={sig}"
}

response = client.post("/webhooks/stripe", data=payload_str, headers=headers)
print("Status Code:", response.status_code)
print("Response Text:", response.text)

# Also check the type of event in backend
