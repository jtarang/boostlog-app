variable "environment" {
  description = "Deployment environment (dev, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR block for the public subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "subnet_b_cidr" {
  description = "CIDR block for the second public subnet (AZ b), required for the RDS subnet group"
  type        = string
  default     = "10.0.2.0/24"
}

# ── Shared RDS (managed Postgres) ────────────────────────────────────────────
variable "db_instance_class" {
  description = "RDS instance class for the shared Postgres"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "RDS Postgres engine version (must match parameter group family postgres16)"
  type        = string
  default     = "16.4"
}

variable "db_allowed_cidrs" {
  description = "Extra CIDRs (e.g. the dev EC2 Elastic IP as x.x.x.x/32) allowed to reach RDS on 5432. The prd EIP is added automatically."
  type        = list(string)
  default     = []
}

variable "use_rds" {
  description = "When true, DATABASE_URL points at the shared RDS instead of the in-VM Postgres container. Flip per environment to cut over."
  type        = bool
  default     = false
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}

variable "ec2_ami_ssm_parameter" {
  description = "SSM Parameter path for the EC2 AMI"
  type        = string
  default     = "/aws/service/debian/release/bookworm/latest/amd64"
}

variable "key_name" {
  description = "EC2 Key pair name for SSH access"
  type        = string
}

variable "domain_name" {
  description = "The domain name for the new Route53 zone"
  type        = string
}

variable "secret_name" {
  description = "Name of the secret in Secrets Manager"
  type        = string
}

variable "github_client_id" {
  description = "GitHub OAuth Client ID"
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_client_secret" {
  description = "GitHub OAuth Client Secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_id" {
  description = "Google OAuth Client ID — set in GitHub Secrets (GOOGLE_CLIENT_ID)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth Client Secret — set in GitHub Secrets (GOOGLE_CLIENT_SECRET)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "microsoft_client_id" {
  description = "Microsoft (Entra) OAuth Client ID — set in GitHub Secrets (MICROSOFT_CLIENT_ID)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "microsoft_client_secret" {
  description = "Microsoft (Entra) OAuth Client Secret — set in GitHub Secrets (MICROSOFT_CLIENT_SECRET)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_client_key" {
  description = "App SECRET_KEY for JWT (deprecated/unused as it's now auto-generated)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_tunnel_token" {
  description = "Cloudflare Tunnel Token for secure access"
  type        = string
  sensitive   = true
  default     = ""
}

variable "db_password" {
  description = "Postgres database password — set this in GitHub Secrets (DB_PASSWORD) and edit directly in AWS Secrets Manager to rotate"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_publishable_key" {
  description = "Stripe publishable key (pk_...) — set in GitHub Secrets (STRIPE_PUBLISHABLE_KEY)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_secret_key" {
  description = "Stripe secret key (sk_...) — set in GitHub Secrets (STRIPE_SECRET_KEY)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_price_id_pro" {
  description = "Stripe price ID for the Pro tier (price_...) — environment-specific (sandbox vs live)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_price_id_tuner" {
  description = "Stripe price ID for the Tuner tier (price_...) — environment-specific (sandbox vs live)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret (whsec_...) — from the webhook endpoint in the Stripe Dashboard"
  type        = string
  sensitive   = true
  default     = ""
}
