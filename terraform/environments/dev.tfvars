environment   = "dev"
aws_region    = "us-east-1"
instance_type = "t3.micro"
key_name      = "dev-boostlog-app-key"
domain_name   = "dev.boostlog.app"
secret_name   = "boostlog.app/dev/secrets"

# Flip to true only after the prd workspace has stood up the shared RDS and the
# boostlog_dev database exists (see terraform/RDS.md). The dev workspace reads
# the endpoint/creds from the prd workspace state via terraform_remote_state.
use_rds = false
