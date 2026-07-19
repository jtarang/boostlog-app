# ─────────────────────────────────────────────────────────────────────────────
# S3 bucket for user log blobs (one per environment). Metadata stays in RDS;
# the app (backend/storage.py) uses this bucket when LOG_BUCKET is set.
#
# S3 is reached via IAM, not the VPC, so unlike RDS there's no cross-VPC/CIDR
# concern — each environment simply gets its own private bucket.
# ─────────────────────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "logs" {
  bucket = "boostlog-logs-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = { Name = "boostlog-logs-${var.environment}" }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.boostlog_key.arn
    }
  }
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Let the EC2 role read/write/delete objects in this bucket (KMS decrypt/encrypt
# is already granted on boostlog_key by the secrets-access policy in iam.tf).
data "aws_iam_policy_document" "s3_logs_access" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.logs.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.logs.arn]
  }
}

resource "aws_iam_role_policy" "s3_logs_access_policy" {
  name   = "boostlog-s3-logs-access-${var.environment}${local.name_suffix}"
  role   = aws_iam_role.ec2_role.id
  policy = data.aws_iam_policy_document.s3_logs_access.json
}
