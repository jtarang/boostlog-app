import json
import os

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv

load_dotenv()

RP_ID = os.getenv("RP_ID", "localhost")
RP_NAME = "Boostlog"

UPLOAD_DIR = "data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_HOSTS = [
    h.strip()
    for h in os.getenv(
        "ALLOWED_HOSTS",
        "boostlog.app,*.boostlog.app,localhost,127.0.0.1,testserver",
    ).split(",")
    if h.strip()
]

# CORS origins allowed to call the API. Includes the Capacitor native webview
# origins (iOS: capacitor://localhost, Android: http(s)://localhost).
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "https://boostlog.app,capacitor://localhost,http://localhost,https://localhost",
    ).split(",")
    if o.strip()
]


def get_secret(secret_name):
    if os.getenv("SKIP_AWS_FETCH") == "true":
        return None

    region_name = os.getenv("AWS_REGION", "us-east-1")
    try:
        session = boto3.session.Session()
        client = session.client(service_name="secretsmanager", region_name=region_name)
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        if "SecretString" in get_secret_value_response:
            return get_secret_value_response["SecretString"]
    except (ClientError, NoCredentialsError) as e:
        print(f"Boto3 Error getting secret {secret_name} (bypassing due to local environment): {e}")
    return None


aws_secrets_str = get_secret(os.getenv("AWS_SECRET_NAME", "boostlog.app/prd/secrets"))
aws_secrets = json.loads(aws_secrets_str) if aws_secrets_str else {}

# When set, user log blobs are stored in this S3 bucket instead of local disk
# (see backend/storage.py). Metadata always stays in the DB.
LOG_BUCKET = aws_secrets.get("LOG_BUCKET") or os.getenv("LOG_BUCKET")

# Transactional email (Resend). Unset → email is a no-op (local dev/tests).
# MAIL_FROM e.g. "boostLog <noreply@boostlog.app>" (domain must be verified).
RESEND_API_KEY = aws_secrets.get("RESEND_API_KEY") or os.getenv("RESEND_API_KEY")
MAIL_FROM = aws_secrets.get("MAIL_FROM") or os.getenv("MAIL_FROM")

SECRET_KEY = aws_secrets.get("SECRET_KEY") or os.getenv("SECRET_KEY", "fallback_local_secret_key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

GITHUB_CLIENT_ID = aws_secrets.get("GITHUB_CLIENT_ID") or os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = aws_secrets.get("GITHUB_CLIENT_SECRET") or os.getenv("GITHUB_CLIENT_SECRET")

# OAuth / SSO (handled by fastapi-sso in backend/auth/sso.py).
GOOGLE_CLIENT_ID = aws_secrets.get("GOOGLE_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = aws_secrets.get("GOOGLE_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET")

MICROSOFT_CLIENT_ID = aws_secrets.get("MICROSOFT_CLIENT_ID") or os.getenv("MICROSOFT_CLIENT_ID")
MICROSOFT_CLIENT_SECRET = aws_secrets.get("MICROSOFT_CLIENT_SECRET") or os.getenv("MICROSOFT_CLIENT_SECRET")
# "common" allows both work/school (Entra) and personal Microsoft accounts.
MICROSOFT_TENANT = aws_secrets.get("MICROSOFT_TENANT") or os.getenv("MICROSOFT_TENANT", "common")

DISCORD_CLIENT_ID = aws_secrets.get("DISCORD_CLIENT_ID") or os.getenv("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = aws_secrets.get("DISCORD_CLIENT_SECRET") or os.getenv("DISCORD_CLIENT_SECRET")

# Apple ("Sign in with Apple"). No static client secret — it's an ES256 JWT
# signed at request time from the .p8 key (see backend/auth/sso.py).
# APPLE_CLIENT_ID is the Services ID (e.g. app.boostlog.web). APPLE_PRIVATE_KEY
# is the .p8 contents, base64-encoded so it survives single-line env/tfvars.
APPLE_CLIENT_ID = aws_secrets.get("APPLE_CLIENT_ID") or os.getenv("APPLE_CLIENT_ID")
APPLE_TEAM_ID = aws_secrets.get("APPLE_TEAM_ID") or os.getenv("APPLE_TEAM_ID")
APPLE_KEY_ID = aws_secrets.get("APPLE_KEY_ID") or os.getenv("APPLE_KEY_ID")
APPLE_PRIVATE_KEY_B64 = aws_secrets.get("APPLE_PRIVATE_KEY_B64") or os.getenv("APPLE_PRIVATE_KEY_B64")

# Base URL used to build each provider's redirect URI as
# {base}/api/auth/{provider}/callback. Must exactly match the redirect URIs
# registered with each provider (per environment). Defaults to local dev.
OAUTH_REDIRECT_BASE = (
    aws_secrets.get("OAUTH_REDIRECT_BASE")
    or os.getenv("OAUTH_REDIRECT_BASE", "http://localhost:8000")
).rstrip("/")

# Feature flags per email (lowercased). Add an email → list[str] entry to grant
# flags. The list is embedded in the JWT so no extra DB call is needed per
# request. Supported flags: "palette_switcher"
FEATURE_FLAGS: dict[str, list[str]] = {
    "jaytarang92@gmail.com": ["palette_switcher"],
}
