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

# ── Security group: Postgres only from our EC2 Elastic IPs ────────────────────
resource "aws_security_group" "rds" {
  count       = local.create_rds ? 1 : 0
  name        = "boostlog-rds-sg"
  description = "Allow Postgres 5432 from boostlog EC2 Elastic IPs only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Postgres from allowlisted EIPs (prd EIP auto-added + var.db_allowed_cidrs)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = concat(["${aws_eip.web_eip.public_ip}/32"], var.db_allowed_cidrs)
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

# ── Cross-workspace read: the `dev` workspace pulls the endpoint/creds from the
#    `prd` workspace state (only when actually cutting over to RDS) ─────────────
data "terraform_remote_state" "prd" {
  count   = (!local.is_prd && var.use_rds) ? 1 : 0
  backend = "s3"
  config = {
    bucket = "boostlog-tfstate-jtarang"
    key    = "env:/prd/boostlog/terraform.tfstate" # S3 backend workspace layout
    region = "us-east-1"
  }
}
