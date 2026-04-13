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
}

variable "github_client_secret" {
  description = "GitHub OAuth Client Secret"
  type        = string
  sensitive   = true
}

variable "app_secret_key" {
  description = "App SECRET_KEY for JWT"
  type        = string
  sensitive   = true
}
