'use strict';

/**
 * Shared helpers for PostgreSQL integration tests.
 *
 * Every test file:
 *   const { db, truncateAll, seedUser, closePool } = require('./helpers');
 *   beforeEach(truncateAll);
 *   afterAll(closePool);
 */

const db = require('../../database'); // env.js (setupFiles) has already forced *_test

// Runtime double-check on the LIVE pool config — belt and braces on top of env.js.
const poolDbName = db.pool.options.database;
if (!poolDbName || !poolDbName.endsWith('_test')) {
  throw new Error(`INTEGRATION-TEST SAFETY: pool is connected to "${poolDbName}", not a *_test database`);
}

const ALL_TABLES = [
  'opa_messages', 'opa_conversations', 'opa_feature_knowledge',
  'sync_log', 'conflicts', 'events',
  'user_notifications', 'user_settings', 'org_settings',
  'leave_requests', 'cpd_activities', 'credentials', 'pd_documents',
  'user_invites', 'therapist_profiles',
  'outlook_delta_state', 'sessions', 'audit_logs',
  'purchase_request_events', 'purchase_requests',
  'resource_ai_drafts', 'user_resource_progress',
  'snapshot_reminders', 'snapshot_tasks', 'travel_address_overrides',
  // Resource Hub R2 (migration 011)
  'resource_collection_items', 'resource_collections', 'resource_versions',
  'policy_acknowledgements', 'learning_path_items', 'learning_paths',
  'user_learning_progress', 'resource_views', 'resource_external_sources',
  'external_sources', 'pd_events', 'cpd_entries', 'resource_feedback',
  'quiz_attempts', 'quiz_questions', 'quizzes', 'resource_quick_links',
  'search_misses',
  // Support tickets (migration 014) — children before parents
  'support_ticket_events', 'support_ticket_attachments', 'support_ticket_comments',
  'support_tickets', 'support_ticket_counters',
  // FCA report generation (018) and progress note letters (019 — the SAME
  // tables, generalised by document_type; no new tables to truncate)
  //   — children before parents
  'fca_generated_documents', 'fca_report_drafts', 'fca_section_presets',
  'fca_client_ndis_goals', 'fca_client_ndis_plans', 'fca_client_profiles',
  'fca_templates',
  // WHODAS 2.0 (migration 021) — children before parents
  'whodas_generated_documents', 'whodas_assessments', 'whodas_templates',
  // Interactive induction (migration 032)
  'tutorial_progress',
  // Owner-controlled learning (migration 033) — children before parents
  'learning_item_progress', 'learning_assignments',
  'learning_workflow_versions', 'learning_workflows',
  // Onboarding Packages (migration 034) — children before parents.
  // credentials / pd_documents / user_invites are already listed above; 034
  // only adds columns to those.
  'compliance_expiry_notices', 'organisation_compliance_records',
  'onboarding_statement_issuances', 'onboarding_acknowledgements',
  'onboarding_requirement_events', 'onboarding_requirements',
  'employee_identity_records', 'payroll_profiles',
  'employee_personal_details', 'employment_profiles',
  // Starter packs, returned documents and extraction (migration 038) —
  // children before parents, and all before onboarding_assignments.
  'onboarding_extracted_field_events', 'onboarding_extracted_fields',
  'onboarding_extraction_runs', 'onboarding_returned_documents',
  'onboarding_email_dispatches', 'onboarding_starter_packs',
  'onboarding_assignments',
  'onboarding_package_versions', 'onboarding_package_requirements',
  'onboarding_package_documents', 'onboarding_packages',
  'onboarding_requirement_templates',
  'onboarding_document_import_items', 'onboarding_document_imports',
  'onboarding_document_versions', 'onboarding_documents',
  'compliance_requirements',
  // Interview Preparation (migration 036) — one table, no children.
  'interview_records',
  'users', 'organisations',
];

async function truncateAll() {
  await db.pool.query(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

/** Insert a minimal active user and return the row. */
async function seedUser(overrides = {}) {
  const defaults = {
    email: `user-${Math.random().toString(36).slice(2, 8)}@test.invalid`,
    name: 'Test User',
    role: 'therapist',
    password_hash: '$2a$04$testhashnotreal000000000000000000000000000000000000000',
    account_status: 'active',
    email_verified: true,
    is_active: true,
    // NULL by default; pass organisation_id for routes that require a real
    // org (file delivery refuses a NULL org rather than wildcard-matching).
    organisation_id: null,
  };
  const u = { ...defaults, ...overrides };
  const { rows } = await db.pool.query(
    `INSERT INTO users (email, name, role, password_hash, account_status, email_verified, is_active, organisation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [u.email, u.name, u.role, u.password_hash, u.account_status, u.email_verified, u.is_active, u.organisation_id]
  );
  return rows[0];
}

/** Insert an organisation row and return it. */
async function seedOrganisation(name = 'Test Org') {
  const { rows } = await db.pool.query(
    'INSERT INTO organisations (name) VALUES ($1) RETURNING *', [name]
  );
  return rows[0];
}

/** Insert a session row for a user (mirrors PgSessionStore's shape). */
async function seedSession(userId, sid = `sid-${Math.random().toString(36).slice(2, 10)}`) {
  await db.pool.query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [sid, JSON.stringify({ userId, cookie: {} })]
  );
  return sid;
}

async function closePool() {
  await db.pool.end();
}

module.exports = { db, truncateAll, seedUser, seedOrganisation, seedSession, closePool };
