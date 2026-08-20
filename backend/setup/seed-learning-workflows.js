'use strict';

/**
 * SEED LEARNING WORKFLOWS — DEVELOPMENT / SYNTHETIC ENVIRONMENTS ONLY
 *
 * Idempotent seed of four representative Owner-authored learning workflow
 * TEMPLATES (migration 033) so the Learning admin console and My Learning
 * player have something to demonstrate:
 *
 *   - New Starter — Occupational Therapist   (induction)
 *   - New Graduate Occupational Therapist    (induction)
 *   - Admin Starter                          (induction)
 *   - Rural & Remote Starter                 (rural_remote)
 *
 * Templates only — NO assignments are seeded (assigning is the Owner's
 * deliberate act, and seeding fake assignments would fabricate employee
 * records). Nothing is published either: versions are cut automatically on
 * first assignment.
 *
 * HUMAN EDITS ARE NEVER CLOBBERED: rows are matched by title within the
 * organisation scope and only INSERTED when absent — an existing row,
 * whatever its state, is left untouched and reported as preserved.
 *
 * Organisation scope: the 'Opal Therapy' organisation when it exists (it is
 * created by seed-users.js, which runs first in every synthetic environment),
 * otherwise NULL — matching how the dev accounts are scoped.
 *
 *   node backend/setup/seed-learning-workflows.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'therapy_scheduler',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

const k = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

const item = (type, title, body, extra) => Object.assign(
  { key: k('i'), type, title, body: body || '', required: true }, extra || {});

const WORKFLOWS = [
  {
    title: 'New Starter — Occupational Therapist',
    category: 'induction',
    description: 'Core induction for every occupational therapist joining Opal Therapy.',
    sections: [
      {
        key: k('s'), title: 'Welcome to Opal Therapy',
        items: [
          item('content', 'Welcome and how we work', 'Welcome to the team! This induction walks you through how Opal Therapy runs: our values, the people you will work with, and the systems you will use every day.\n\nWork through each section in order — your progress saves automatically.', { minutes: 5 }),
          item('content', 'Organisational structure', 'Who does what at Opal Therapy, who to ask about scheduling, clinical questions, and equipment.', { minutes: 5 }),
          item('acknowledgement', 'Code of conduct', 'Read the code of conduct below, then confirm your acknowledgement.', {
            minutes: 10,
            ack_statement: 'I have read and understood the Opal Therapy Code of Conduct and agree to work in accordance with it.',
          }),
        ],
      },
      {
        key: k('s'), title: 'Privacy and compliance',
        items: [
          item('content', 'Privacy and confidentiality', 'Client information is health information. This module covers what you may collect, where it must live, and what must never leave our systems.', { minutes: 10 }),
          item('acknowledgement', 'Privacy undertaking', 'Confirm the privacy undertaking below.', {
            minutes: 3,
            ack_statement: 'I understand my privacy and confidentiality obligations, including that client information is only accessed for clinical purposes and never stored outside approved systems.',
          }),
          item('quiz', 'Privacy knowledge check', 'A short check of the privacy module.', {
            minutes: 5,
            quiz: {
              passThreshold: 80,
              questions: [
                {
                  question: 'A client’s parent asks for a copy of a report about the other parent’s session. What do you do?',
                  options: [
                    'Send it — they are family',
                    'Decline and escalate to the practice owner before releasing anything',
                    'Read it to them over the phone',
                  ],
                  correctIndex: 1,
                },
                {
                  question: 'Where may session notes be stored?',
                  options: [
                    'In approved practice systems only',
                    'On my personal laptop for convenience',
                    'In a private notebook',
                  ],
                  correctIndex: 0,
                },
              ],
            },
          }),
        ],
      },
      {
        key: k('s'), title: 'Working here',
        items: [
          item('task', 'Set up your portal profile', 'Complete your profile in the portal: display name, phone, work locations, and upload your credentials.', { minutes: 10 }),
          item('content', 'Scheduling and travel', 'How appointments, travel blocks and the logbook work — and what to check before you drive.', { minutes: 10 }),
        ],
      },
    ],
  },
  {
    title: 'New Graduate Occupational Therapist',
    category: 'induction',
    description: 'Extended induction for new graduate OTs: supervision, clinical documentation and NDIS fundamentals.',
    sections: [
      {
        key: k('s'), title: 'Foundations',
        items: [
          item('content', 'Your supervision structure', 'Your supervision schedule, who your supervisor is, and how to raise clinical questions between sessions.', { minutes: 5 }),
          item('content', 'NDIS fundamentals', 'Plans, goals, supports and how OT services fit into a participant’s NDIS plan.', { minutes: 15 }),
        ],
      },
      {
        key: k('s'), title: 'Clinical documentation',
        items: [
          item('content', 'Session notes that stand up', 'What a defensible session note contains, and what does not belong in one.', { minutes: 10 }),
          item('quiz', 'Documentation knowledge check', '', {
            minutes: 5,
            quiz: {
              passThreshold: 80,
              questions: [
                {
                  question: 'When should a session note be written?',
                  options: ['Within the practice’s documentation window, as soon as practicable', 'At the end of the month', 'Only if something notable happened'],
                  correctIndex: 0,
                },
              ],
            },
          }),
          item('acknowledgement', 'Documentation standard', 'Confirm you have read the documentation standard.', {
            ack_statement: 'I have read the clinical documentation standard and will document sessions in accordance with it.',
          }),
        ],
      },
    ],
  },
  {
    title: 'Admin Starter',
    category: 'induction',
    description: 'Induction for administration staff: systems, scheduling, privacy at the front desk.',
    sections: [
      {
        key: k('s'), title: 'Systems and scheduling',
        items: [
          item('content', 'The portal and the calendar', 'The systems you will use daily and how the practice calendar is organised.', { minutes: 10 }),
          item('task', 'Shadow a booking', 'Sit with a senior admin while they take a booking end to end, then note two things that surprised you.', { minutes: 30 }),
        ],
      },
      {
        key: k('s'), title: 'Privacy at the front desk',
        items: [
          item('content', 'Privacy for administration', 'Phone enquiries, waiting-room conversations and what may be confirmed to whom.', { minutes: 10 }),
          item('acknowledgement', 'Privacy undertaking', '', {
            ack_statement: 'I understand my privacy obligations in an administration role, including verification before disclosing any client information.',
          }),
        ],
      },
    ],
  },
  {
    title: 'Rural & Remote Starter',
    category: 'rural_remote',
    description: 'Working safely and effectively on rural and remote service runs.',
    sections: [
      {
        key: k('s'), title: 'Rural service delivery',
        items: [
          item('content', 'How rural runs work', 'Multi-day runs, accommodation, kit lists and how travel time is recorded.', { minutes: 10 }),
          item('content', 'Working in community', 'Cultural safety, working in schools and homes, and who to call when plans change.', { minutes: 15 }),
        ],
      },
      {
        key: k('s'), title: 'Safety',
        items: [
          item('content', 'Vehicle and journey safety', 'Journey plans, check-ins, fatigue rules and what to do when a road is closed.', { minutes: 10 }),
          item('acknowledgement', 'Journey safety acknowledgement', '', {
            ack_statement: 'I will follow the journey management procedure on every rural run, including check-ins and fatigue limits.',
          }),
        ],
      },
    ],
  },
];

async function main() {
  const orgRow = await pool.query(
    "SELECT id FROM organisations WHERE name = 'Opal Therapy' LIMIT 1");
  const orgId = orgRow.rows[0] ? orgRow.rows[0].id : null;

  let created = 0;
  let preserved = 0;
  for (const wf of WORKFLOWS) {
    const { rows } = await pool.query(
      `SELECT id FROM learning_workflows
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND title = $2`, [orgId, wf.title]);
    if (rows.length) { preserved += 1; continue; }
    await pool.query(
      `INSERT INTO learning_workflows (organisation_id, title, description, category, draft_content)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, wf.title, wf.description, wf.category, JSON.stringify({ sections: wf.sections })]);
    created += 1;
  }
  console.log(`Learning workflow templates: ${created} created, ${preserved} preserved (already present)` +
    ` in organisation ${orgId || 'NULL'}.`);
}

main()
  .catch((err) => { console.error('seed-learning-workflows failed:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
