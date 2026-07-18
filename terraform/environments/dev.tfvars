environment   = "dev"
aws_region    = "us-east-1"
instance_type = "t3.micro"
key_name      = "dev-boostlog-app-key"
domain_name   = "dev.boostlog.app"
secret_name   = "boostlog.app/dev/secrets"

# Points at the shared RDS (boostlog_dev database). Apply the prd workspace first
# and create the boostlog_dev database once (see terraform/RDS.md); dev reads the
# endpoint/creds from the prd workspace state via terraform_remote_state.
use_rds = true
