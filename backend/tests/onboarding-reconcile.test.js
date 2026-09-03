'use strict';

/**
 * RECONCILE + ATTENTION — the rules that decide what the portal trusts and
 * what it hands to the Owner. Pure, no database.
 */

const reconcile = require('../onboarding-reconcile');
const attention = require('../onboarding-attention');

const doc = (label, value, confidence = 'high', id = label) => ({ value, confidence, sourceKind: 'document', sourceLabel: label, sourceDocumentId: id, candidateId: `c-${id}` });
const offer = (value) => ({ value, confidence: 'high', sourceKind: 'offer', sourceLabel: 'Offer terms' });

describe('the three outcomes', () => {
  test('contract says 38 hours, the employee form says 30.4 — a conflict, never a choice', () => {
    const r = reconcile.reconcileField('hours_per_week', [doc('Contract', '38'), doc('Employee Form', '30.4')]);
    expect(r.outcome).toBe('conflict');
    expect(r.value).toBeNull();
    expect(r.title).toBe('Employment Hours Conflict');
    expect(r.options.map((o) => `${o.sourceLabel}: ${o.display}`)).toEqual(['Contract: 38 hours', 'Employee Form: 30.4 hours']);
  });

  test('a document disagreeing with the offer terms is a conflict too', () => {
    const r = reconcile.reconcileField('salary_annual', [doc('Contract', '95000'), offer('92000')]);
    expect(r.outcome).toBe('conflict');
    expect(r.options.map((o) => o.display)).toEqual(['$95,000 per annum', '$92,000 per annum']);
  });

  test('sources that agree, read clearly, are reliable', () => {
    const r = reconcile.reconcileField('hours_per_week', [doc('Contract', '38'), doc('Employee Form', '38.0')]);
    expect(r.outcome).toBe('reliable');
    expect(r.value).toBe('38');
    const s = reconcile.reconcileField('surname', [doc('Passport', 'Smith'), doc('Form', 'SMITH ')]);
    expect(s.outcome).toBe('reliable');
  });

  test('a doubtful reading of an important field, or any low-confidence reading, needs review', () => {
    expect(reconcile.reconcileField('date_of_birth', [doc('Form', '1990-04-03', 'medium')]).outcome).toBe('review');
    expect(reconcile.reconcileField('bsb', [doc('Form', '066-123', 'low')]).outcome).toBe('review');
    expect(reconcile.reconcileField('suburb', [doc('Form', 'Fremantle', 'low')]).outcome).toBe('review');
  });

  test('a clear reading is reliable, even alone; a legible ordinary one too', () => {
    expect(reconcile.reconcileField('date_of_birth', [doc('Passport', '1990-04-03')]).outcome).toBe('reliable');
    expect(reconcile.reconcileField('suburb', [doc('Form', 'Fremantle', 'medium')]).outcome).toBe('reliable');
    expect(reconcile.reconcileField('bsb', [doc('Form', '066-123', 'medium'), doc('Contract', '066-123', 'medium')]).outcome).toBe('reliable');
  });

  test('the record contributes what it already knows, and only document-backed fields are reconciled', () => {
    const cands = [doc('Contract', '30.4'), { key: 'hours_per_week', ...doc('Contract', '30.4') }].slice(1);
    const all = reconcile.reconcileAll(cands.map((c) => ({ key: 'hours_per_week', ...c })), { applicant_name: 'Jane Smith', hours_per_week: 38, employment_type: 'full_time', pay_basis: 'annual', pay_rate: 92000 });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: 'hours_per_week', outcome: 'conflict' });
    expect(all[0].options.map((o) => o.sourceLabel)).toEqual(['Contract', 'Offer terms']);
  });

  test('dates compare as dates, phones as digits, names without punctuation', () => {
    expect(reconcile.reconcileField('start_date', [doc('A', '2026-10-07'), doc('B', '2026-10-07')]).outcome).toBe('reliable');
    expect(reconcile.reconcileField('mobile', [doc('A', '0412 000 000'), doc('B', '0412000000')]).outcome).toBe('reliable');
    expect(reconcile.reconcileField('legal_first_name', [doc('A', "O'Brien"), doc('B', 'OBrien')]).outcome).toBe('reliable');
  });
});

describe('Requires Your Attention', () => {
  const NOW = new Date('2026-09-20T00:00:00Z');
  test('lists only exceptions, most serious first', () => {
    const items = attention.buildAttention({
      now: NOW,
      assignment: { status: 'documents_received', pack_due_at: '2026-09-10' },
      returnedDocuments: [
        { id: 'd1', title: 'scan.pdf', status: 'active', match_status: 'unrecognised', signature_status: 'unknown', text_status: 'extracted' },
        { id: 'd2', title: 'contract.pdf', status: 'active', match_status: 'matched', pack_item_id: 'p1', signature_status: 'missing', text_status: 'extracted' },
        { id: 'd3', title: 'ok.pdf', status: 'active', match_status: 'matched', pack_item_id: 'p2', signature_status: 'present', text_status: 'extracted' },
      ],
      packItems: [
        { id: 'p1', code: 'PACK_CONTRACT', title: 'Contract of Employment', status: 'included', required: true, employee_returns: true, requires_verification: true, returned_at: NOW, verification_status: 'attention', attention_reason: 'Returned without a signature' },
        { id: 'p2', code: 'REQ_WWCC', title: 'Working with Children Check', status: 'included', required: true, employee_returns: true, requires_verification: true, returned_at: NOW, verification_status: 'pending' },
        { id: 'p3', code: 'REQ_AHPRA', title: 'AHPRA registration', status: 'included', required: true, employee_returns: true, requires_verification: true, returned_at: null, verification_status: 'pending' },
        { id: 'p4', code: 'REQ_FWIS', title: 'FWIS', status: 'included', required: true, employee_returns: false, requires_verification: false, returned_at: null, verification_status: 'pending' },
        { id: 'p5', code: 'PACK_FIRST_AID', title: 'First Aid', status: 'included', required: false, employee_returns: true, requires_verification: true, returned_at: null, verification_status: 'pending' },
      ],
      fields: [
        { id: 'f1', key: 'hours_per_week', label: 'Ordinary hours a week', outcome: 'conflict', status: 'proposed', title: 'Employment Hours Conflict', conflict_options: [{ sourceLabel: 'Contract', display: '38 hours' }, { sourceLabel: 'Employee Form', display: '30.4 hours' }] },
        { id: 'f2', key: 'date_of_birth', label: 'Date of birth', outcome: 'review', status: 'proposed', reason: 'Read once', value: '1990-04-03' },
        { id: 'f3', key: 'suburb', label: 'Suburb', outcome: 'reliable', status: 'applied', value: 'Fremantle' },
        { id: 'f4', key: 'surname', label: 'Surname', outcome: 'conflict', status: 'corrected', conflict_options: [] },
      ],
      credentials: [{ id: 'c1', credential_type: 'first_aid', credential_name: 'First Aid Certificate', expiry_date: '2026-01-01' }, { id: 'c2', credential_type: 'wwcc', credential_name: 'WWCC', expiry_date: '2029-01-01' }],
      payroll: { bankStatus: 'provided', bankVerifiedAt: null, bsbMasked: '066-•••', accountLast4: '5678' },
      tasks: [{ code: 'work_email', title: 'Create work email', status: 'failed', note: 'Tenant refused' }, { code: 'x', title: 'X', status: 'done' }],
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['unrecognised_document', 'missing_signature', 'conflict', 'low_confidence', 'incorrect_document', 'missing_required_document', 'register_check', 'expired_credential', 'payroll_approval', 'account_setup_failed']));
    // Settled fields, reliable fields, optional missing items and future expiries are silent.
    expect(items.filter((i) => i.kind === 'conflict')).toHaveLength(1);
    expect(items.some((i) => i.detail && i.detail.includes('Fremantle'))).toBe(false);
    expect(items.filter((i) => i.kind === 'missing_required_document').map((i) => i.detail)).toEqual([expect.stringContaining('AHPRA registration')]);
    expect(items.filter((i) => i.kind === 'expired_credential')).toHaveLength(1);
    expect(items[0].severity).toBe('high');
    expect(items[items.length - 1].severity).toBe('normal');
    const conflict = items.find((i) => i.kind === 'conflict');
    expect(conflict.title).toBe('Employment Hours Conflict');
    expect(conflict.detail).toBe('Contract: 38 hours · Employee Form: 30.4 hours');
    expect(conflict.action).toMatchObject({ type: 'resolve_conflict', fieldId: 'f1' });
  });

  test('a record with nothing wrong has nothing to show', () => {
    expect(attention.buildAttention({ now: NOW, assignment: { status: 'starter_pack_sent', pack_due_at: '2026-12-01' } })).toEqual([]);
  });
});
