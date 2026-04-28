#!/bin/bash
# AWS CloudShell Script: Create GitHub OIDC Provider and Role for Terraform CI/CD

set -e

GITHUB_REPO="jtarang/boostlog-app"
ROLE_NAME="github-actions-boostlog-terraform-role"
PROVIDER_URL="https://token.actions.githubusercontent.com"
AUDIENCE="sts.amazonaws.com"
THUMBPRINT="1b511abead59c6ce207077c0bf0e0043b1382612"

echo "Checking if GitHub OIDC Provider already exists..."
EXISTING_PROVIDER=$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn" --output text)

if [ -z "$EXISTING_PROVIDER" ]; then
    echo "Creating GitHub OIDC Provider..."
    PROVIDER_ARN=$(aws iam create-open-id-connect-provider \
        --url "$PROVIDER_URL" \
        --thumbprint-list "$THUMBPRINT" \
        --client-id-list "$AUDIENCE" \
        --query "OpenIDConnectProviderArn" --output text)
    echo "Provider created: $PROVIDER_ARN"
else
    PROVIDER_ARN=$EXISTING_PROVIDER
    echo "Provider already exists: $PROVIDER_ARN"
fi

echo "Creating Trust Policy document..."
cat <<EOF > trust-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$PROVIDER_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "$AUDIENCE"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:$GITHUB_REPO:*"
        }
      }
    }
  ]
}
EOF

echo "Creating IAM Role: $ROLE_NAME..."
# If role already exists, this command will error, but we can safely ignore or handle it.
aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file://trust-policy.json || echo "Role already exists, moving on..."

echo "Attaching AdministratorAccess policy to role for Terraform execution..."
# Highly recommended to lock this down to least-privilege later, but Admin is standard for initial Terraform bootstrapping
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Fetch AWS Account ID to construct the Role ARN correctly
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
FULL_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"

echo "============================================================"
echo "✅ SUCCESS: OIDC Integration Complete"
echo ""
echo "Please add the following value as a GitHub Repository Secret:"
echo "Secret Name : AWS_ROLE_ARN  (and AWS_ROLE_ARN_PROD)"
echo "Secret Value: $FULL_ROLE_ARN"
echo "============================================================"

# cleanup
rm trust-policy.json
