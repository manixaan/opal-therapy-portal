#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  STAGE 5/7: seed SYNTHETIC users into the staging database (idempotent)
#
#  Prereq: az login + staging provisioned (deploy/staging-resources.txt).
#  Usage:  bash deploy/staging-seed-synthetic.sh
#
#  Creates four fictional accounts (owner/admin/therapist/read-only, all
#  @example.test) plus one synthetic organisation. One strong password is
#  generated per run and written ONLY to deploy/staging-synthetic.local.txt
#  (gitignored). No real names, no real data, ever.
#
#  Network: the staging PG allows Azure services only. This script opens a
#  temporary firewall rule for this machine's IP, seeds, then removes it.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/staging-resources.txt # APP/RG/PG/KV/...

MYIP=$(curl -s https://api.ipify.org)
echo "── opening temporary PG firewall rule for $MYIP"
az postgres flexible-server firewall-rule create --resource-group "$RG" --server-name "$PG" \
  --name temp-seed --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none

cleanup() {
  echo "── removing temporary PG firewall rule"
  az postgres flexible-server firewall-rule delete --resource-group "$RG" --server-name "$PG" \
    --name temp-seed --yes -o none || true
}
trap cleanup EXIT

SYN_PASS=$(openssl rand -hex 10)
umask 177
printf 'password for all four synthetic users: %s\n' "$SYN_PASS" > deploy/staging-synthetic.local.txt
echo "── synthetic password written to deploy/staging-synthetic.local.txt (gitignored)"

DB_PASSWORD_VALUE=$(az keyvault secret show --vault-name "$KV" --name db-password --query value -o tsv)

DB_HOST="$PG.postgres.database.azure.com" DB_PORT=5432 DB_NAME=opal_portal \
DB_USER=opaladmin DB_PASSWORD="$DB_PASSWORD_VALUE" DB_SSL=true SYN_PASS="$SYN_PASS" \
node - <<'EOF'
const bcrypt = require('./backend/node_modules/bcryptjs');
const { Pool } = require('./backend/node_modules/pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: true },
});
(async () => {
  const hash = await bcrypt.hash(process.env.SYN_PASS, 12);
  const org = await pool.query(`
    INSERT INTO organisations (name) VALUES ('Synthetic Staging Practice')
    ON CONFLICT DO NOTHING RETURNING id`);
  const orgId = org.rows[0]?.id ||
    (await pool.query(`SELECT id FROM organisations WHERE name='Synthetic Staging Practice'`)).rows[0].id;

  const users = [
    ['synthetic.owner@example.test',     'Sig Synthetic-Owner',   'owner'],
    ['synthetic.admin@example.test',     'Ada Synthetic-Admin',   'admin'],
    ['synthetic.therapist@example.test', 'Tia Synthetic-Therapist','therapist'],
    ['synthetic.readonly@example.test',  'Rio Synthetic-Readonly','read_only'],
  ];
  for (const [email, name, role] of users) {
    await pool.query(`
      INSERT INTO users (email, password_hash, display_name, role, organisation_id,
                         is_active, account_status, email_verified)
      VALUES ($1, $2, $3, $4, $5, TRUE, 'active', TRUE)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = $2, role = $4, is_active = TRUE,
            account_status = 'active', email_verified = TRUE`,
      [email, hash, name, role, orgId]);
    console.log('✓ ' + role.padEnd(10) + email);
  }
  const n = await pool.query('SELECT COUNT(*) FROM users');
  console.log('users in staging DB: ' + n.rows[0].count);
  await pool.end();
})().catch(e => { console.error('SEED FAIL:', e.message); process.exit(1); });
EOF
echo "✓ synthetic seed complete"
