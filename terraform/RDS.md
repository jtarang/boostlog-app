# Shared RDS (managed Postgres) — one-shot setup

One `db.t4g.micro` single-AZ Postgres instance (`boostlog-shared`) hosts two
databases: **`boostlog_prd`** and **`boostlog_dev`**. It lives in the **`prd`
workspace**; the **`dev`** workspace reads its endpoint/creds via
`terraform_remote_state` and connects to the same public endpoint.

Because dev and prd are separate VPCs sharing CIDR `10.0.0.0/16` (peering
impossible), the instance is **publicly accessible, SG-locked to both EC2
Elastic IPs (auto-allowlisted), with TLS forced** (`rds.force_ssl=1`,
`sslmode=require`).

`use_rds = true` is already set in both tfvars — there are no real users, so we
cut straight over and let Alembic build the schema fresh (no data migration).

---

## Steps

**1. Apply prd — creates the instance and points prd at `boostlog_prd`.**

```bash
cd terraform
terraform workspace select prd
terraform apply -var-file=environments/prd.tfvars
```

(The dev EC2 EIP is pulled from the dev workspace state automatically, so the SG
admits both boxes with no manual IP entry.)

**2. Create the `boostlog_dev` database (one command, once).**

RDS creates only the initial `boostlog_prd`; add the second DB from an
allowlisted host (the prd EC2) over SSM, using the master creds in
`boostlog.app/shared/rds-master` and a throwaway psql container:

```bash
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=tag:Name,Values=boostlog-web-prd" \
  --parameters 'commands=[
    "C=$(aws secretsmanager get-secret-value --secret-id boostlog.app/shared/rds-master --query SecretString --output text)",
    "H=$(echo $C | jq -r .host); U=$(echo $C | jq -r .username); P=$(echo $C | jq -r .password)",
    "docker run --rm -e PGPASSWORD=$P postgres:16 psql -h $H -U $U -d boostlog_prd -c \"CREATE DATABASE boostlog_dev;\""
  ]'
```

**3. Apply dev — points dev at `boostlog_dev` on the same instance.**

```bash
terraform workspace select dev
terraform apply -var-file=environments/dev.tfvars
```

**4. Redeploy both apps** (CD, or `docker-compose --env-file .env.production up
-d --force-recreate` on each box) so they read the new `DATABASE_URL`. The app's
Alembic migrations build the schema on first connect.

Done. The in-VM `db` container is already removed from
`docker/docker-compose.prd.yml`.

---

## Notes

- **Rollback:** the `use_rds=false` path (in-VM `@db:5432`) still exists in
  Terraform, but the `db` container has been removed from the prd compose — add
  it back if you ever need to revert.
- **Engine pin:** `db_engine_version = "16.4"`. If that minor isn't offered in
  us-east-1 at apply, bump it (any `16.x`); family stays `postgres16`.
- **Cost:** `db.t4g.micro` single-AZ + 20 GB gp3 + 7-day backups ≈ **$14/mo**.
  `deletion_protection = true` + final snapshot guard against accidental loss.
- **Ordering:** prd must be applied before dev (dev reads prd's state), and
  `boostlog_dev` must exist before the dev app connects.
