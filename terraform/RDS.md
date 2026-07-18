# Shared RDS (managed Postgres) — standup & cutover runbook

One `db.t4g.micro` single-AZ Postgres instance (`boostlog-shared`) hosts two
databases: **`boostlog_prd`** and **`boostlog_dev`**. It lives in the **`prd`
workspace**; the **`dev`** workspace reads its endpoint/creds via
`terraform_remote_state` and connects to the same public endpoint.

Because dev and prd are separate VPCs sharing CIDR `10.0.0.0/16` (peering
impossible), the instance is **publicly accessible, locked by security group to
our EC2 Elastic IPs, with TLS forced** (`rds.force_ssl=1`, `sslmode=require`).

Cutover is controlled by the **`use_rds`** flag — no hand-editing of secrets
(Terraform owns `DATABASE_URL`, so a manual edit would be reverted on next apply).

---

## Phase 1 — Stand up the instance (no app impact)

`use_rds = false` in both tfvars, so the app keeps using the in-VM Postgres.

```bash
cd terraform
terraform workspace select prd
terraform apply -var-file=environments/prd.tfvars
```

Grab the endpoint and the dev EC2's Elastic IP:

```bash
terraform output rds_endpoint                    # in the prd workspace
terraform workspace select dev && terraform output ec2_public_ip
```

Put the **dev EIP** into `environments/prd.tfvars` so the SG admits it (the prd
EIP is added automatically):

```hcl
db_allowed_cidrs = ["<dev_eip>/32"]
```

Re-apply prd to update the security group:

```bash
terraform workspace select prd
terraform apply -var-file=environments/prd.tfvars
```

## Phase 2 — Create the `boostlog_dev` database

The initial DB `boostlog_prd` exists. Create the second one from an allowlisted
host (the prd EC2, which is in the SG). Master creds live in
`boostlog.app/shared/rds-master`. Run over SSM:

```bash
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Name,Values=boostlog-web-prd" \
  --parameters 'commands=[
    "CREDS=$(aws secretsmanager get-secret-value --secret-id boostlog.app/shared/rds-master --query SecretString --output text)",
    "HOST=$(echo $CREDS | jq -r .host); USER=$(echo $CREDS | jq -r .username); PGPASSWORD=$(echo $CREDS | jq -r .password)",
    "export PGPASSWORD",
    "psql -h $HOST -U $USER -d boostlog_prd -c \"CREATE DATABASE boostlog_dev;\""
  ]'
```

## Phase 3 — Migrate existing data (per environment)

Dump the current in-VM Postgres and load it into the matching RDS database. From
each EC2 (prd → `boostlog_prd`, dev → `boostlog_dev`):

```bash
# On the box, against the local docker `db` container:
docker compose exec -T db pg_dump -U boostuser boostlog > /tmp/boostlog.sql

# Load into RDS (use the shared master creds; sslmode required):
PGPASSWORD=<master_pass> psql "host=<rds_endpoint> user=<master_user> \
  dbname=boostlog_prd sslmode=require" < /tmp/boostlog.sql
```

Alternatively, start clean: point the app at RDS and let Alembic build the schema
(`alembic upgrade head` runs against Postgres fine — unlike local SQLite).

## Phase 4 — Flip the app to RDS

Set `use_rds = true` and apply, one environment at a time:

```bash
# prd
terraform workspace select prd
terraform apply -var-file=environments/prd.tfvars   # after setting use_rds=true

# dev (reads prd's outputs via remote state)
terraform workspace select dev
terraform apply -var-file=environments/dev.tfvars   # after setting use_rds=true
```

This rewrites `DATABASE_URL` in each env's app secret to
`postgresql://<user>:<pass>@<rds_endpoint>:5432/boostlog_{prd,dev}?sslmode=require`.
Redeploy the app (CD, or `docker-compose up -d --force-recreate`) to pick it up.

## Phase 5 — Retire the in-VM Postgres

Once verified on RDS, remove the `db` service and `postgres_data` volume from
`docker/docker-compose.prd.yml` (and the `depends_on: db` on `web`). The 10 GB
data EBS volume can shrink to uploads-only.

---

## Rollback

Set `use_rds = false` and apply — `DATABASE_URL` reverts to the in-VM container.
(Only clean before Phase 5 removes the container.)

## Cost

`db.t4g.micro` single-AZ + 20 GB gp3 + 7-day backups ≈ **$14/mo**, flat.
`deletion_protection = true` and a final snapshot guard against accidental loss.
