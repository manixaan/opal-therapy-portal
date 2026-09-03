'use strict';

/**
 * REQUIRES YOUR ATTENTION — only what genuinely needs the Owner.
 *
 * Pure. Given what the record holds, produce the list of exceptions the
 * automation could not settle. Normal items never appear here: a document
 * that was recognised, read reliably and applied is silent.
 *
 * Each item: { kind, severity:'high'|'normal', title, detail, action:{ type, ...ids } }
 */

const KIND_LABELS = {
  unrecognised_document: 'Document could not be recognised',
  low_confidence: 'Low-confidence information',
  conflict: 'Conflicting information',
  missing_signature: 'Missing signature',
  missing_required_document: 'Missing required document',
  expired_credential: 'Expired credential',
  incorrect_document: 'Incorrect document',
  payroll_approval: 'Payroll information needs approval',
  account_setup_failed: 'Account set-up failed',
  register_check: 'Verify against the register',
};

const STATUTORY = new Set(['REQ_AHPRA', 'REQ_NDIS_SCREENING', 'REQ_WWCC', 'PACK_POLICE_CHECK']);

const toDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const fmt = (v) => { const d = toDate(v); return d ? d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : ''; };

/**
 * @param {object} p
 * @param {object[]} p.returnedDocuments rows (match_status, signature_status, pack_item_id, file_name, title, id)
 * @param {object[]} p.packItems         rows (id, code, title, status, required, employee_returns, requires_verification, returned_at, verification_status, attention_reason)
 * @param {object[]} p.fields            resolved fields (key, label, outcome, status, conflict_options, outcome_reason, confidence, value shown)
 * @param {object[]} p.credentials       rows (id, credential_type, credential_name, expiry_date, status)
 * @param {object|null} p.payroll        masked payroll view (bankStatus, bankVerifiedAt)
 * @param {object[]} p.tasks             internal tasks (code, title, status, note)
 * @param {object} p.assignment          (status, pack_due_at)
 * @param {Date} p.now
 */
function buildAttention({ returnedDocuments = [], packItems = [], fields = [], credentials = [], payroll = null, tasks = [], assignment = {}, now = new Date() }) {
  const items = [];
  const push = (kind, extra) => items.push({ kind, title: KIND_LABELS[kind], severity: 'normal', ...extra });

  // Documents nobody could place.
  for (const d of returnedDocuments) {
    if (d.status === 'archived') continue;
    if (d.match_status === 'unrecognised' || (d.match_status === 'pending' && !d.pack_item_id && d.text_status && d.text_status !== 'pending')) {
      push('unrecognised_document', {
        detail: `${d.title || d.file_name} — choose which document in the pack it answers, or archive it.`,
        action: { type: 'assign_document', returnedDocumentId: d.id },
      });
    }
  }

  // Signatures.
  for (const d of returnedDocuments) {
    if (d.status === 'archived' || d.signature_status !== 'missing' || !d.pack_item_id) continue;
    const item = packItems.find((p) => p.id === d.pack_item_id);
    if (!item || !item.employee_returns) continue;
    push('missing_signature', {
      severity: 'high',
      detail: `${item.title} came back without a signature.`,
      action: { type: 'request_again', packItemId: item.id, returnedDocumentId: d.id },
    });
  }

  // Values.
  for (const f of fields) {
    if (f.status && !['proposed'].includes(f.status)) continue;
    if (f.outcome === 'conflict') {
      push('conflict', {
        severity: 'high', title: f.title || `${f.label} conflict`,
        detail: (f.conflict_options || []).map((o) => `${o.sourceLabel}: ${o.display || o.value}`).join(' · '),
        action: { type: 'resolve_conflict', fieldId: f.id, key: f.key },
        options: f.conflict_options || [],
      });
    } else if (f.outcome === 'review') {
      push('low_confidence', {
        title: `${f.label} needs a check`,
        detail: `${f.reason || f.outcome_reason || 'Read with some doubt'}${f.value ? ` — read as “${f.value}”` : ''}.`,
        action: { type: 'confirm_field', fieldId: f.id, key: f.key },
      });
    }
  }

  // Pack items.
  const overdue = assignment.pack_due_at && toDate(assignment.pack_due_at) < now;
  for (const p of packItems) {
    if (p.status !== 'included') continue;
    if (p.verification_status === 'attention') {
      push('incorrect_document', { severity: 'high', detail: `${p.title}: ${p.attention_reason || 'the returned document does not match'}.`, action: { type: 'open_item', packItemId: p.id } });
      continue;
    }
    if (p.employee_returns && p.required && !p.returned_at && overdue && ['starter_pack_sent', 'documents_received'].includes(assignment.status)) {
      push('missing_required_document', { detail: `${p.title} has not come back (due ${fmt(assignment.pack_due_at)}).`, action: { type: 'chase', packItemId: p.id } });
      continue;
    }
    if (p.returned_at && p.requires_verification && p.verification_status === 'pending' && STATUTORY.has(p.code)) {
      push('register_check', { detail: `${p.title} is in — confirm it against the issuing register, then verify.`, action: { type: 'verify_item', packItemId: p.id } });
    }
  }

  // Credentials on the profile.
  for (const c of credentials) {
    const exp = toDate(c.expiry_date);
    if (exp && exp < now) {
      push('expired_credential', { severity: 'high', detail: `${c.credential_name} expired ${fmt(c.expiry_date)}.`, action: { type: 'open_credential', credentialId: c.id } });
    }
  }

  // Payroll.
  if (payroll && payroll.bankStatus === 'provided' && !payroll.bankVerifiedAt) {
    push('payroll_approval', { detail: `Bank details received (BSB ${payroll.bsbMasked || '—'}, account ending ${payroll.accountLast4 || '—'}). Approve them for payroll.`, action: { type: 'approve_payroll' } });
  }

  // Internal setup.
  for (const t of tasks) {
    if (t.status === 'failed') push('account_setup_failed', { severity: 'high', title: `${t.title} failed`, detail: t.note || 'See the internal setup list.', action: { type: 'open_task', taskCode: t.code } });
  }

  const order = { high: 0, normal: 1 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return items;
}

module.exports = { KIND_LABELS, STATUTORY, buildAttention };
