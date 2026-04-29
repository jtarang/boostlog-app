locals {
  name_suffix = var.environment == "dev" ? "-v2" : ""
}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2_role" {
  name               = "boostlog-ec2-role-${var.environment}${local.name_suffix}"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

data "aws_iam_policy_document" "secrets_access" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.boostlog_secrets.arn
    ]
  }

  statement {
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [
      aws_kms_key.boostlog_key.arn
    ]
  }
}

resource "aws_iam_role_policy" "secrets_access_policy" {
  name   = "boostlog-secrets-access-${var.environment}${local.name_suffix}"
  role   = aws_iam_role.ec2_role.id
  policy = data.aws_iam_policy_document.secrets_access.json
}

data "aws_iam_policy_document" "bedrock_access" {
  statement {
    actions = [
      "bedrock:InvokeModel"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "bedrock_access_policy" {
  name   = "boostlog-bedrock-access-${var.environment}${local.name_suffix}"
  role   = aws_iam_role.ec2_role.id
  policy = data.aws_iam_policy_document.bedrock_access.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "boostlog-ec2-profile-${var.environment}${local.name_suffix}"
  role = aws_iam_role.ec2_role.name
}
