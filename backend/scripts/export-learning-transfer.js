#!/usr/bin/env node
/**
 * Reads the LOCAL learning tables and writes a self-contained SQL script that
 * loads them into ANOTHER portal database (staging), remapping the things
 * that legitimately differ between databases:
 *   - organisation_id  → the target's single organisation
 *   - created_by / published_by → the target's owner user
 *   - resource ids     → resolved on the target BY SLUG (resource ids are
 *                        random per database; slugs are unique per org)
 * Rows already present on the target (same workflow title, same path key)
 * are skipped, mirroring the app's own import behaviour. Everything runs in
 * one transaction and prints a summary; nothing is deleted.
 *
 * Usage (from backend/):  DB_NAME=therapy_scheduler node scripts/export-learning-transfer.js > learning-transfer.sql
 *  Then, from a machine that can reach the target database:
 *    psql "host=<pg host> dbname=<db> user=<user> sslmode=require" -f learning-transfer.sql
 */
const { Client } = require('pg');

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

(async () => {
  const c = new Client({ host: 'localhost', database: process.env.DB_NAME || 'therapy_scheduler', user: process.env.DB_USER || undefined });
  await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;

  const paths = await q('SELECT * FROM learning_paths ORDER BY sort_order, name');
  const items = await q('SELECT * FROM learning_path_items ORDER BY path_id, sort_order');
  const wfs = await q('SELECT * FROM learning_workflows ORDER BY created_at');
  const vers = await q('SELECT * FROM learning_workflow_versions ORDER BY workflow_id, version');

  // Every resource id referenced anywhere → slug (local lookup)
  const ids = new Set(items.map((i) => i.resource_id));
  const re = /"resource_id"\s*:\s*"([0-9a-f-]{36})"/g;
  for (const w of wfs) for (const m of JSON.stringify(w.draft_content).matchAll(re)) ids.add(m[1]);
  for (const v of vers) for (const m of JSON.stringify(v.content).matchAll(re)) ids.add(m[1]);
  const slugRows = await q('SELECT id, slug, title FROM resources WHERE id = ANY($1::uuid[])', [[...ids]]);
  const slugOf = new Map(slugRows.map((r) => [r.id, r.slug]));
  const missing = [...ids].filter((id) => !slugOf.get(id));
  if (missing.length) console.error(`WARNING: ${missing.length} referenced resource(s) have no slug locally; they cannot be remapped:`, missing.join(', '));

  const out = [];
  const p = (s) => out.push(s);
  p(`-- Learning tables transfer, generated ${new Date().toISOString()} from local "${c.database}"`);
  p(`-- paths=${paths.length} path_items=${items.length} workflows=${wfs.length} versions=${vers.length} resources_referenced=${ids.size}`);
  p('\\set ON_ERROR_STOP on');
  p('BEGIN;');
  p(`
CREATE TEMP TABLE xfer_resource_map (local_id uuid PRIMARY KEY, slug text NOT NULL, target_id uuid) ON COMMIT DROP;
CREATE TEMP TABLE xfer_paths      (LIKE learning_paths INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE xfer_path_items (LIKE learning_path_items INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE xfer_workflows  (LIKE learning_workflows INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE xfer_versions   (LIKE learning_workflow_versions INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE xfer_ctx (org uuid, owner_user uuid) ON COMMIT DROP;`);

  p('-- resource slug map (local id → slug); target id resolved below');
  for (const [id, slug] of slugOf) if (slug) p(`INSERT INTO xfer_resource_map (local_id, slug) VALUES (${lit(id)}, ${lit(slug)});`);

  const cols = (rows) => Object.keys(rows[0]);
  const emit = (table, rows) => {
    if (!rows.length) return;
    const cs = cols(rows);
    for (const r of rows) p(`INSERT INTO ${table} (${cs.join(', ')}) VALUES (${cs.map((k) => lit(r[k])).join(', ')});`);
  };
  emit('xfer_paths', paths);
  emit('xfer_path_items', items);
  emit('xfer_workflows', wfs);
  emit('xfer_versions', vers);

  p(`
-- ── Resolve target context ──────────────────────────────────────────────────
INSERT INTO xfer_ctx SELECT
  (SELECT o.id FROM organisations o ORDER BY (SELECT count(*) FROM users u WHERE u.organisation_id = o.id) DESC, o.created_at LIMIT 1),
  (SELECT id FROM users WHERE role = 'owner' AND is_active IS DISTINCT FROM FALSE ORDER BY created_at LIMIT 1);
DO $$ BEGIN
  IF (SELECT org FROM xfer_ctx) IS NULL THEN
    RAISE EXCEPTION 'target has no organisation row';
  END IF;
  IF (SELECT owner_user FROM xfer_ctx) IS NULL THEN
    RAISE EXCEPTION 'target has no active owner user to own the imported workflows';
  END IF;
END $$;

UPDATE xfer_resource_map m SET target_id = r.id
  FROM resources r WHERE r.slug = m.slug AND r.organisation_id = (SELECT org FROM xfer_ctx);

-- ── Rewrite embedded resource ids in workflow content by slug ───────────────
DO $$
DECLARE m RECORD;
BEGIN
  FOR m IN SELECT local_id, target_id FROM xfer_resource_map WHERE target_id IS NOT NULL AND target_id <> local_id LOOP
    UPDATE xfer_workflows SET draft_content = replace(draft_content::text, m.local_id::text, m.target_id::text)::jsonb
      WHERE draft_content::text LIKE '%' || m.local_id::text || '%';
    UPDATE xfer_versions SET content = replace(content::text, m.local_id::text, m.target_id::text)::jsonb
      WHERE content::text LIKE '%' || m.local_id::text || '%';
  END LOOP;
END $$;

-- ── Learning paths (skip keys already on the target) ────────────────────────
INSERT INTO learning_paths (id, organisation_id, key, name, description, target_role, sort_order, is_active, created_at)
SELECT p.id, c.org, p.key, p.name, p.description, p.target_role, p.sort_order, p.is_active, p.created_at
  FROM xfer_paths p, xfer_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM learning_paths t WHERE t.organisation_id = c.org AND t.key = p.key);

INSERT INTO learning_path_items (id, path_id, resource_id, sort_order, required)
SELECT i.id, i.path_id, m.target_id, i.sort_order, i.required
  FROM xfer_path_items i
  JOIN xfer_resource_map m ON m.local_id = i.resource_id AND m.target_id IS NOT NULL
 WHERE EXISTS (SELECT 1 FROM learning_paths t WHERE t.id = i.path_id)
   AND NOT EXISTS (SELECT 1 FROM learning_path_items t WHERE t.path_id = i.path_id AND t.resource_id = m.target_id)
ON CONFLICT DO NOTHING;

-- ── Workflows (skip titles already on the target, case-insensitive) ─────────
INSERT INTO learning_workflows (id, organisation_id, title, description, category, status, draft_content, current_version, created_by, created_at, updated_at, archived_at)
SELECT w.id, c.org, w.title, w.description, w.category, w.status, w.draft_content, w.current_version, c.owner_user, w.created_at, w.updated_at, w.archived_at
  FROM xfer_workflows w, xfer_ctx c
 WHERE NOT EXISTS (SELECT 1 FROM learning_workflows t
                    WHERE t.organisation_id IS NOT DISTINCT FROM c.org
                      AND lower(trim(t.title)) = lower(trim(w.title)));

INSERT INTO learning_workflow_versions (id, workflow_id, version, title, description, category, content, published_by, published_at)
SELECT v.id, v.workflow_id, v.version, v.title, v.description, v.category, v.content, c.owner_user, v.published_at
  FROM xfer_versions v, xfer_ctx c
 WHERE EXISTS (SELECT 1 FROM learning_workflows t WHERE t.id = v.workflow_id)
ON CONFLICT DO NOTHING;

-- ── Summary ─────────────────────────────────────────────────────────────────
SELECT 'resources mapped by slug' AS what, count(target_id) || ' of ' || count(*) AS result FROM xfer_resource_map
UNION ALL SELECT 'paths now on target', count(*)::text FROM learning_paths WHERE id IN (SELECT id FROM xfer_paths)
UNION ALL SELECT 'path items now on target', count(*)::text || ' of ' || (SELECT count(*) FROM xfer_path_items) FROM learning_path_items WHERE path_id IN (SELECT id FROM xfer_paths)
UNION ALL SELECT 'workflows now on target', count(*)::text || ' of ' || (SELECT count(*) FROM xfer_workflows) FROM learning_workflows WHERE id IN (SELECT id FROM xfer_workflows)
UNION ALL SELECT 'workflow titles skipped (already present)', count(*)::text FROM xfer_workflows w WHERE NOT EXISTS (SELECT 1 FROM learning_workflows t WHERE t.id = w.id)
UNION ALL SELECT 'versions now on target', count(*)::text FROM learning_workflow_versions WHERE id IN (SELECT id FROM xfer_versions)
UNION ALL SELECT 'unmapped resource slugs (not on target)', string_agg(slug, ', ') FROM xfer_resource_map WHERE target_id IS NULL;

COMMIT;`);

  process.stdout.write(out.join('\n') + '\n');
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
