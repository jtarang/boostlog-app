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

SECRET_KEY = aws_secrets.get("SECRET_KEY") or os.getenv("SECRET_KEY", "fallback_local_secret_key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

GITHUB_CLIENT_ID = aws_secrets.get("GITHUB_CLIENT_ID") or os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = aws_secrets.get("GITHUB_CLIENT_SECRET") or os.getenv("GITHUB_CLIENT_SECRET")
