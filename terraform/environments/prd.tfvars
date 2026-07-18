environment   = "prd"
aws_region    = "us-east-1"
instance_type = "t3.micro"
key_name      = "prd-boostlog-app-key"
domain_name   = "boostlog.app"
secret_name   = "boostlog.app/prd/secrets"

# Shared RDS. Flip use_rds to true only AFTER the instance is stood up and data
# is migrated (see terraform/RDS.md). db_allowed_cidrs must list the DEV EC2
# Elastic IP as x.x.x.x/32 (the prd EIP is added automatically).
use_rds          = false
db_allowed_cidrs = [] # e.g. ["<dev_eip>/32"]
