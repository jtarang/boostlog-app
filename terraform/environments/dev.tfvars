environment          = "dev"
aws_region           = "us-east-1"
instance_type        = "t3.small"
key_name             = "my-dev-key"
domain_name          = "dev.mydomain.com"
secret_name          = "datalog/dev/secrets"

# Ensure to provide actual secure strings instead of these defaults when deploying
github_client_id     = "REPLACE_ME_DEV"
github_client_secret = "REPLACE_ME_DEV"
app_secret_key       = "SUPER_SECRET_DEV"
