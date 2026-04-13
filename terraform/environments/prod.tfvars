environment          = "prod"
aws_region           = "us-east-1"
instance_type        = "t3.medium" # Upgrade to g4dn.xlarge if deploying Ollama
key_name             = "my-prod-key"
domain_name          = "mydomain.com"
secret_name          = "boostlog/prod/secrets"

github_client_id     = "REPLACE_ME_PROD"
github_client_secret = "REPLACE_ME_PROD"
app_secret_key       = "SUPER_SECRET_PROD"
