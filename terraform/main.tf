terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "INSERT_YOUR_BUCKET_NAME_HERE"
    key            = "datalog/terraform.tfstate"
    region         = "us-east-1"
    # dynamodb_table = "terraform-locks" # Uncomment to enable state locking
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "Datalog"
      ManagedBy   = "Terraform"
    }
  }
}
