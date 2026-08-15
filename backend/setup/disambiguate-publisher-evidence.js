#!/usr/bin/env node
'use strict';

/**
 * Separate AUTHORSHIP from CITED EVIDENCE in the Resource Hub, and record how
 * each classification was reached.
 *
 * THE PROBLEM
 * `source_publisher` has been carrying two incompatible meanings. On a
 * third-party record it means "who wrote this". On an Opal-written explainer it
 * has been used for "the source this cites" — which is how three Opal-authored
 * NDIS guides came to look, to any code reading the column, like NDIA
 * publications. One column cannot answer both questions, and the badge logic
 * has to trust it.
 *
 * WHAT THIS DOES
 *  1. For the three VERIFIED Opal-authored NDIS explainers only: sets
 *     source_publisher to Opal Therapy (the actual author) and moves the NDIA
 *     reference into provenance.evidence, where a cited source belongs.
 *     These three were confirmed by reading the documents — they contain no
 *     reproduced NDIA text and say so explicitly ("every number left to the
 *     official source", "not a substitute").
 *  2. Records classification provenance on every row classified by the earlier
 *     authority_level pass: method, timestamp and confidence.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not touch any other row whose publisher is ambiguous. Deciding
 * whether a given record's `source_publisher` means author or citation needs
 * someone to read the document; inferring it in bulk is exactly the mistake
 * that produced the current mess. Those rows keep confidence 'inferred' and
 * wait for a human.
 *
 *   node backend/setup/disambiguate-publisher-evidence.js --dry-run
 *   node backend/setup/disambiguate-publisher-evidence.js
 */

require('dotenv').config();
const { pool } = require('../database');

// Verified individually by reading the document body, not inferred.
const VERIFIED_OPAL_EXPLAINERS = [
  'NDIS Pricing and Claiming — Quick Guide',
  'What Are NDIS Supports?',
  'Would We Fund It? — Using the NDIA Guidance',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const at = new Date().toISOString();
  const verb = dryRun ? 'would' : 'did';

  // ── 1. The three verified explainers ──────────────────────────────────────
  const { rows: targets } = await pool.query(
    `SELECT id, title, source_publisher, source_title, external_url
       FROM resources
      WHERE title = ANY($1::text[])
        AND source_class = 'opal-original'
        AND source_publisher = 'National Disability Insurance Agency'`,
    [VERIFIED_OPAL_EXPLAINERS]);

  console.log(`Verified Opal-authored explainers matched: ${targets.length} of ${VERIFIED_OPAL_EXPLAINERS.length}`);
  for (const t of targets) {
    console.log(`  ${verb} rewrite: "${t.title.slice(0, 46)}"`);
    console.log(`      publisher  ${t.source_publisher}  ->  Opal Therapy`);
    console.log(`      evidence   + ${t.source_title || '(untitled source)'}`);
    if (dryRun) continue;

    await pool.query(
      `UPDATE resources
          SET source_publisher = 'Opal Therapy',
              provenance = COALESCE(provenance, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [t.id, JSON.stringify({
        evidence: [{
          role: 'cited-source',
          publisher: 'National Disability Insurance Agency',
          title: t.source_title || null,
          url: t.external_url || null,
          note: 'Referenced by this Opal-authored explainer. No NDIA text is reproduced.',
        }],
        classification: {
          sourceClass: {
            value: 'opal-original',
            method: 'human-verified-content-review',
            confidence: 'high',
            at,
            by: 'disambiguate-publisher-evidence.js',
            note: 'Document body read and confirmed Opal-authored; NDIA appears as a cited source only.',
          },
          publisher: {
            method: 'human-verified-content-review',
            confidence: 'high',
            at,
            previousValue: t.source_publisher,
            note: 'source_publisher previously held the cited source rather than the author.',
          },
        },
      })]);
  }

  // ── 2. Provenance for the inferred classification pass ────────────────────
  // Everything classified from authority_level was an inference, not a review.
  // Recording that explicitly is what stops it being mistaken for a decision
  // somebody made.
  const inferred = {
    classification: {
      sourceClass: {
        method: 'inferred-from-authority-level',
        confidence: 'medium',
        at,
        by: 'classify-resource-source-class.js',
        note: 'Derived from the pre-existing authority_level. Authorship only — implies no rights review.',
      },
    },
  };

  const sql = dryRun
    ? `SELECT COUNT(*)::int AS c FROM resources
        WHERE source_class <> 'unknown'
          AND NOT (provenance ? 'classification')`
    : `UPDATE resources
          SET provenance = COALESCE(provenance, '{}'::jsonb) || $1::jsonb
        WHERE source_class <> 'unknown'
          AND NOT (provenance ? 'classification')
        RETURNING id`;
  const res = await pool.query(sql, dryRun ? [] : [JSON.stringify(inferred)]);
  const n = dryRun ? res.rows[0].c : res.rowCount;
  console.log(`\n${verb === 'would' ? 'Would stamp' : 'Stamped'} inferred-classification provenance on ${n} row(s).`);

  const { rows: left } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM resources WHERE source_class = 'unknown'`);
  const { rows: amb } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM resources
      WHERE source_class = 'opal-original' AND source_publisher IS NOT NULL
        AND source_publisher <> 'Opal Therapy'`);

  console.log(`Still unclassified, awaiting a human: ${left[0].c}`);
  console.log(`Opal-authored rows whose publisher is still ambiguous (left alone deliberately): ${amb[0].c}`);

  await pool.end();
}

main().catch((err) => {
  console.error('disambiguation failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
