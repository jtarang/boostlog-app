# ─────────────────────────────────────────────────────────────────────────────
# Shared managed Postgres (RDS db.t4g.micro, single-AZ) for dev + prd.
#
# ONE instance hosts TWO logical databases:
#   - boostlog_prd : created at provision time (db_name below)
#   - boostlog_dev : created post-provision from an allowlisted EC2 (see the
#                    runbook in terraform/RDS.md — the SG only admits our EIPs,
#                    so the CREATE DATABASE runs over SSM from the prd box).
#
# Networking: dev and prd live in SEPARATE VPCs that share CIDR 10.0.0.0/16, so
# VPC peering is impossible. The instance is therefore publicly_accessible and
# locked by security group to the two EC2 Elastic IPs, with TLS forced
# (rds.force_ssl=1). The instance is defined ONLY in the `prd` workspace; the
# `dev` workspace reads its endpoint/credentials via remote state and connects
# to the same public endpoint (see database_url in secrets.tf).
# ─────────────────────────────────────────────────────────────────────────────

locals {
  is_prd     = terraform.workspace == "prd"
  create_rds = terraform.workspace == "prd"
}

# ── Random master credentials (username can be anything; random is fine) ──────
resource "random_string" "db_username" {
  count   = local.create_rds ? 1 : 0
  length  = 10
  special = false
  numeric = false
  upper   = false
}

resource "random_password" "db_master" {
  count   = local.create_rds ? 1 : 0
  length  = 32
  special = false # keep it URL-safe so DATABASE_URL needs no escaping
}

# ── Subnet group (RDS requires >= 2 AZs; second subnet lives in vpc.tf) ───────
resource "aws_db_subnet_group" "shared" {
  count      = local.create_rds ? 1 : 0
  name       = "boostlog-db-subnet-group"
  subnet_ids = [aws_subnet.public.id, aws_subnet.public_b.id]

  tags = { Name = "boostlog-db-subnet-group" }
}

# ── Security group for the RDS instance ───────────────────────────────────────
# Two access paths, because the instance is publicly_accessible but shared across
# VPCs:
#   * prd EC2 is in THIS VPC -> VPC DNS resolves the endpoint to the private IP,
#     so it reaches RDS over the private network. The source is the EC2's private
#     IP (NOT its EIP), so we allow it by referencing the prd web SG.
#   * dev EC2 is in a DIFFERENT VPC -> it resolves to the public IP and connects
#     over the internet, so RDS sees the dev EIP -> allow it by CIDR.
resource "aws_security_group" "rds" {
  count = local.create_rds ? 1 : 0
  name  = "boostlog-rds-sg"
  # NOTE: description is immutable in AWS — changing it forces SG replacement
  # (destroy/recreate), which detaches the live RDS ENI. Keep this string
  # stable; the real behavior is documented in the comment block above.
  description = "Allow Postgres 5432 from boostlog EC2 Elastic IPs only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from the prd EC2 in this VPC (private path) via its SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  ingress {
    description = "Postgres from the dev EC2 EIP (cross-VPC public path) plus any extra db_allowed_cidrs"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = concat(
      ["${data.terraform_remote_state.dev[0].outputs.ec2_public_ip}/32"], # dev EIP (read from dev state)
      var.db_allowed_cidrs,
    )
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "boostlog-rds-sg" }
}

# ── Force TLS on all connections ──────────────────────────────────────────────
resource "aws_db_parameter_group" "shared" {
  count  = local.create_rds ? 1 : 0
  name   = "boostlog-pg16-ssl"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

# ── The instance ──────────────────────────────────────────────────────────────
resource "aws_db_instance" "shared" {
  count      = local.create_rds ? 1 : 0
  identifier = "boostlog-shared"

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100 # storage autoscaling headroom
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.boostlog_key.arn

  db_name  = "boostlog_prd" # boostlog_dev is created post-provision (see RDS.md)
  username = "boost_${random_string.db_username[0].result}"
  password = random_password.db_master[0].result

  db_subnet_group_name   = aws_db_subnet_group.shared[0].name
  vpc_security_group_ids = [aws_security_group.rds[0].id]
  parameter_group_name   = aws_db_parameter_group.shared[0].name
  publicly_accessible    = true

  multi_az                   = false # single-AZ = cheapest
  backup_retention_period    = 7
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "boostlog-shared-final"
  auto_minor_version_upgrade = true
  apply_immediately          = true

  tags = { Name = "boostlog-shared-db" }
}

# ── Dedicated secret for the DB master creds (separate from the app secret so
#    rotating one never disturbs the other) ─────────────────────────────────────
resource "aws_secretsmanager_secret" "rds_master" {
  count      = local.create_rds ? 1 : 0
  name       = "boostlog.app/shared/rds-master"
  kms_key_id = aws_kms_key.boostlog_key.id
}

resource "aws_secretsmanager_secret_version" "rds_master" {
  count     = local.create_rds ? 1 : 0
  secret_id = aws_secretsmanager_secret.rds_master[0].id
  secret_string = jsonencode({
    username = aws_db_instance.shared[0].username
    password = random_password.db_master[0].result
    host     = aws_db_instance.shared[0].address
    port     = 5432
    dbname   = "boostlog_prd"
  })
}

# ── Cross-workspace reads (S3 backend workspace layout: env:/<ws>/<key>) ──────
# prd reads the dev workspace to auto-allowlist the dev EC2 EIP on the RDS SG.
data "terraform_remote_state" "dev" {
  count   = local.create_rds ? 1 : 0
  backend = "s3"
  config = {
    bucket = "boostlog-tfstate-jtarang"
    key    = "env:/dev/boostlog/terraform.tfstate"
    region = "us-east-1"
  }
}

# dev reads the prd workspace for the shared RDS endpoint/creds when using RDS.
data "terraform_remote_state" "prd" {
  count   = (!local.is_prd && var.use_rds) ? 1 : 0
  backend = "s3"
  config = {
    bucket = "boostlog-tfstate-jtarang"
    key    = "env:/prd/boostlog/terraform.tfstate"
    region = "us-east-1"
  }
}
