environment   = "prd"
aws_region    = "us-east-1"
instance_type = "t3.micro"
key_name      = "prd-boostlog-app-key"
domain_name   = "boostlog.app"
secret_name   = "boostlog.app/prd/secrets"

# Shared RDS. Both EC2 EIPs (prd + dev) are auto-allowlisted on the SG; add any
# extra CIDRs (e.g. a workstation for psql) here. See terraform/RDS.md.
use_rds          = true
db_allowed_cidrs = []
