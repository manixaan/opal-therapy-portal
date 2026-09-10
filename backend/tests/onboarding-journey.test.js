'use strict';

/**
 * THE THREE-STAGE PROJECTION — pure rules, no database.
 *
 * What is pinned here is the contract the Owner's board depends on: which
 * stage a record is in, who the next action belongs to, and that "overdue"
 * is computed rather than guessed. If a rule here changes, the board changes
 * meaning, so the tests are written as scenarios rather than as unit checks
 * of individual branches.
 */

const journey = require('../onboarding-journey');
const letter = require('../onboarding-offer-letter');

const NOW = new Date('2026-09-03T02:00:00Z');
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86400000);

function assignment(over = {}) {
  return {
    id: 'a1', status: 'created', applicant_name: 'Jane Smith', start_date: '2026-10-01',
    is_treating_therapist: true, role_category: 'occupational_therapist', due_at: null,
    ...over,
  };
}
const offer = (over = {}) => ({ id: 'o1', version: 1, status: 'draft', created_at: NOW, ...over });
const req = (over = {}) => ({ id: 'r', title: 'Bank details', actor: 'employee', status: 'not_started', due_at: null, ...over });
const task = (over = {}) => ({ code: 't', title: 'Task', status: 'pending', sort_order: 10, ...over });

describe('Stage 1 — Letter of Offer', () => {
  test('a new record with no offer asks the admin for the details', () => {
    const j = journey.projectJourney({ assignment: assignment(), now: NOW });
    expect(j.stage.key).toBe('offer');
    expect(j.next).toMatchObject({ actor: 'admin', action: 'edit_offer' });
    expect(j.stages[1].state).toBe('pending');
  });

  test('a drafted letter asks for the preview and Email 1; an Outlook draft asks to be sent', () => {
    expect(journey.projectJourney({ assignment: assignment(), offer: offer(), now: NOW }).next.action).toBe('prepare_email');
    const j = journey.projectJourney({ assignment: assignment(), offer: offer({ status: 'email_drafted', email_drafted_at: NOW }), now: NOW });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'send_in_outlook' });
    expect(j.counts.adminReview).toBe(1);
  });

  test('once sent the record is at stage 1.5, waiting on the employee, not on the admin', () => {
    const j = journey.projectJourney({
      assignment: assignment(), now: NOW,
      offer: offer({ status: 'sent', email_sent_at: daysFromNow(-1) }),
    });
    expect(j.stage.number).toBe(1.5);
    expect(j.stage.key).toBe('offer');
    expect(j.next.actor).toBe('employee');
    expect(j.counts.waitingOnEmployee).toBe(1);
    expect(j.counts.overdue).toBe(0);
    expect(j.attention).toBe(0);
  });

  test('no signed letter after the chase window is flagged overdue', () => {
    const j = journey.projectJourney({
      assignment: assignment(), now: NOW,
      offer: offer({ status: 'sent', email_sent_at: daysFromNow(-journey.OFFER_CHASE_DAYS - 1) }),
    });
    expect(j.overdue).toHaveLength(1);
    expect(j.attention).toBeGreaterThan(0);
  });

  test('a signed letter in hand hands the next action back to the admin to verify', () => {
    const j = journey.projectJourney({ assignment: assignment(), offer: offer({ status: 'signed_received', signed_received_at: NOW }), now: NOW });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'verify_offer' });
    expect(j.stage.number).toBe(1);
  });

  test('a declined offer blocks the stage and asks the admin to decide', () => {
    const j = journey.projectJourney({ assignment: assignment(), offer: offer({ status: 'declined', responded_at: NOW }), now: NOW });
    expect(j.stages[0].state).toBe('blocked');
    expect(j.next.action).toBe('reissue_offer');
    expect(j.counts.adminReview).toBe(1);
  });

  test('verification completes the stage; the document pack then asks the admin to review it', () => {
    const accepted = offer({ status: 'accepted', verified_at: NOW });
    const preparing = journey.projectJourney({ assignment: assignment(), offer: accepted, now: NOW });
    expect(preparing.stages[0].state).toBe('complete');
    expect(preparing.stages[0].completedAt).toBe(NOW);
    expect(preparing.stage.key).toBe('documentation');
    expect(preparing.next).toMatchObject({ actor: 'system', action: 'prepare_pack' });

    const ready = journey.projectJourney({
      assignment: assignment({ pack_prepared_at: NOW }), offer: accepted, now: NOW,
      pack: { prepared: true, draftId: null, counts: { included: 12, returns: 8, missingFiles: 2 } },
    });
    expect(ready.next).toMatchObject({ actor: 'admin', action: 'review_pack' });
    expect(ready.counts.adminReview).toBe(2); // the review itself, and the missing files
  });
});

describe('Stage 2 — the document pack', () => {
  const accepted = offer({ status: 'accepted', verified_at: NOW });
  const packed = { prepared: true, draftId: 'd', counts: { included: 10, returns: 6, missingFiles: 0 } };

  test('an Outlook draft waiting is the admin\'s to send', () => {
    const j = journey.projectJourney({ assignment: assignment({ status: 'starter_pack_ready', pack_email_draft_id: 'd', pack_prepared_at: NOW }), offer: accepted, pack: packed, now: NOW });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'send_pack_in_outlook' });
  });

  test('sent shows the due date and waits on the employee; past it, overdue', () => {
    const j = journey.projectJourney({ assignment: assignment({ status: 'starter_pack_sent', pack_due_at: daysFromNow(5), pack_prepared_at: NOW }), offer: accepted, pack: packed, now: NOW });
    expect(j.next.actor).toBe('employee');
    expect(j.stages[1].summary).toMatch(/Onboarding documents sent — due \d{2}\/\d{2}\/\d{4}/);
    expect(j.counts.overdue).toBe(0);
    const late = journey.projectJourney({ assignment: assignment({ status: 'starter_pack_sent', pack_due_at: daysFromNow(-1), pack_prepared_at: NOW }), offer: accepted, pack: packed, now: NOW });
    expect(late.counts.overdue).toBe(1);
    expect(late.attention).toBeGreaterThan(0);
  });

  test('returned documents hand the next action back to the admin', () => {
    const j = journey.projectJourney({ assignment: assignment({ status: 'documents_received', pack_prepared_at: NOW }), offer: accepted, pack: packed, now: NOW });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'review_returns' });
  });

  test('verified forms open Stage 3 while supporting copies are still to come — Stage 2 stays unticked', () => {
    const rec = assignment({ status: 'documents_received', pack_prepared_at: NOW });
    const formsDone = { ...packed, counts: { included: 12, returns: 12, received: 0, verified: 3, formsOpen: 0, returnsOpen: 9 } };
    const j = journey.projectJourney({ assignment: rec, offer: accepted, pack: formsDone, tasks: [task({ code: 'portal_account' })], induction: { prepared: true, readiness: { ready: false, blockers: ['Driver\'s licence has not been returned'] } }, now: NOW });
    expect(j.stages[1]).toMatchObject({ state: 'active', formsDone: true, outstanding: 9 });
    expect(j.stages[1].summary).toMatch(/9 supporting document\(s\) still to come back/);
    expect(j.stages[2].state).toBe('active');
    expect(j.stage.key).toBe('induction');
    expect(j.waitingOnEmployee.some((i) => /9 document\(s\) still to be returned/.test(i.label))).toBe(true);

    // A form still open keeps Stage 3 waiting.
    const formOpen = { ...packed, counts: { included: 12, returns: 12, received: 0, verified: 2, formsOpen: 1, returnsOpen: 10 } };
    const k = journey.projectJourney({ assignment: rec, offer: accepted, pack: formOpen, tasks: [task({ code: 'portal_account' })], now: NOW });
    expect(k.stages[1].formsDone).toBeUndefined();
    expect(k.stages[2].state).toBe('parallel');
    expect(k.stage.key).toBe('documentation');
  });
});

describe('Stage 2 — Onboarding Documentation', () => {
  const accepted = offer({ status: 'accepted', responded_at: NOW });

  test('after release the record waits for the employee to accept the invitation', () => {
    const j = journey.projectJourney({ assignment: assignment({ status: 'invite_sent', due_at: daysFromNow(10) }), offer: accepted, now: NOW });
    expect(j.stage.key).toBe('documentation');
    expect(j.next.actor).toBe('employee');
    expect(j.waitingOnEmployee[0].overdue).toBe(false);
  });

  test('open employee items are waiting on the employee; submitted ones are the admin\'s review', () => {
    const j = journey.projectJourney({
      assignment: assignment({ status: 'in_progress' }), offer: accepted, now: NOW,
      requirements: [
        req({ id: '1', title: 'Bank details', status: 'complete', completed_at: NOW }),
        req({ id: '2', title: 'WWCC', status: 'submitted', requires_employer_verification: true, submitted_at: NOW }),
        req({ id: '3', title: 'Tax file declaration', status: 'not_started', due_at: daysFromNow(-2) }),
        req({ id: '4', title: 'Verify identity', actor: 'employer', status: 'not_started' }),
      ],
    });
    expect(j.counts).toMatchObject({ completed: 1, adminReview: 1, waitingOnEmployee: 1, internalOpen: 1, overdue: 1 });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'review' });
    expect(j.overdue[0].label).toBe('Tax file declaration');
  });

  test('corrections requested puts the ball back with the employee', () => {
    const j = journey.projectJourney({
      assignment: assignment({ status: 'corrections_required' }), offer: accepted, now: NOW,
      requirements: [req({ status: 'correction_required' })],
    });
    expect(j.next.actor).toBe('employee');
    expect(j.waitingOnEmployee[0].label).toMatch(/correction requested/);
  });

  test('ready_to_activate completes the stage and opens induction', () => {
    const j = journey.projectJourney({ assignment: assignment({ status: 'ready_to_activate' }), offer: accepted, now: NOW });
    expect(j.stages[1].state).toBe('complete');
    expect(j.stage.key).toBe('induction');
    expect(j.next.action).toBe('generate_tasks');
  });
});

describe('Stage 3 — Internal Induction & Access', () => {
  const accepted = offer({ status: 'accepted', responded_at: NOW });

  test('the checklist is internal set-up only — no manager follow-ups; the role changes the systems wording', () => {
    const ot = journey.buildInductionTasks(assignment(), { now: NOW });
    const admin = journey.buildInductionTasks(assignment({ is_treating_therapist: false, role_category: 'administration' }), { now: NOW });
    expect(ot.map((t) => t.code)).not.toContain('clinical_supervision');
    expect(ot.map((t) => t.code)).not.toContain('first_week_checkin');
    expect(ot.find((t) => t.code === 'systems_access').title).toMatch(/clinical system access/);
    expect(admin.find((t) => t.code === 'systems_access').title).toBe('Grant system access');
    expect(ot.find((t) => t.code === 'portal_access').automation).toBe('activate_portal_access');
    // Every task carries a stable code, so regeneration never duplicates.
    expect(new Set(ot.map((t) => t.code)).size).toBe(ot.length);
  });

  test('portal access is the first thing asked for while the record is ready to activate', () => {
    const tasks = [task({ code: 'portal_access', automation: 'activate_portal_access', sort_order: 10 }), task({ code: 'work_email', sort_order: 20 })];
    const j = journey.projectJourney({ assignment: assignment({ status: 'ready_to_activate' }), offer: accepted, tasks, now: NOW });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'activate', taskCode: 'portal_access' });
    expect(j.counts.internalOpen).toBe(2);
  });

  test('after activation the next open task, with its assignee, is the next line', () => {
    const tasks = [
      task({ code: 'portal_access', status: 'done', sort_order: 10 }),
      task({ code: 'work_email', title: 'Create work email', sort_order: 20, assignee_name: 'Sam', due_at: daysFromNow(-1) }),
    ];
    const j = journey.projectJourney({ assignment: assignment({ status: 'activated' }), offer: accepted, tasks, now: NOW });
    expect(j.next.label).toBe('Create work email (Sam)');
    expect(j.overdue.map((o) => o.label)).toContain('Create work email');
  });

  test('a failed task is the next thing to resolve; Requires Your Attention carries it', () => {
    const tasks = [task({ code: 'portal_access', status: 'failed', note: 'blocked', sort_order: 10 }), task({ code: 'x', sort_order: 20 })];
    const j = journey.projectJourney({ assignment: assignment({ status: 'activated' }), offer: accepted, tasks, now: NOW,
      attention: [{ kind: 'account_setup_failed', title: 'Activate portal access failed', detail: 'blocked', severity: 'high', action: { type: 'open_task', taskCode: 'portal_access' } }] });
    expect(j.counts.adminReview).toBe(1);
    expect(j.adminReview[0].attentionKind).toBe('account_setup_failed');
    expect(j.next.taskCode).toBe('portal_access');
  });

  test('every task done on an activated record means complete, with nothing to do', () => {
    const tasks = [task({ code: 'a', status: 'done' }), task({ code: 'b', status: 'skipped' })];
    const j = journey.projectJourney({ assignment: assignment({ status: 'activated' }), offer: accepted, tasks, now: NOW });
    expect(j.stage.key).toBe('complete');
    expect(j.next.actor).toBe('none');
    expect(j.attention).toBe(0);
  });
});

describe('the whole record', () => {
  test('a commencement date in the past with onboarding incomplete is overdue', () => {
    const j = journey.projectJourney({ assignment: assignment({ start_date: '2026-08-01' }), offer: offer(), now: NOW });
    expect(j.overdue.some((o) => o.kind === 'record')).toBe(true);
    expect(j.daysToStart).toBeLessThan(0);
  });

  test('a cancelled record is closed and asks for nothing', () => {
    const j = journey.projectJourney({ assignment: assignment({ status: 'cancelled' }), offer: offer(), now: NOW });
    expect(j.closed).toBe(true);
    expect(j.stage.key).toBe('closed');
    expect(j.attention).toBe(0);
  });
});

describe('the offer terms', () => {
  test('normalisation refuses what a letter cannot state', () => {
    const types = ['full_time', 'part_time', 'casual'];
    expect(letter.normaliseTerms({}, types).errors).toEqual(expect.arrayContaining(['Position is required', 'Employment type is not recognised', 'Commencement date is required']));
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', payRate: 50 }, types).errors)
      .toContain('Pay basis is required when a rate is given');
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', probationMonths: 2.5 }, types).errors)
      .toEqual(expect.arrayContaining([expect.stringMatching(/Probation/)]));
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', hoursPerWeek: 90 }, types).errors)
      .toEqual(expect.arrayContaining([expect.stringMatching(/Standard hours/)]));
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', superannuationRate: 45 }, types).errors)
      .toEqual(expect.arrayContaining([expect.stringMatching(/Superannuation/)]));
  });

  test('unknown keys never reach the snapshot; letter particulars do', () => {
    const { terms } = letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', tfn: '123', payCycle: 'Monthly', offerClosingDate: '2026-10-10' }, ['casual']);
    expect(terms).not.toHaveProperty('tfn');
    expect(terms).toMatchObject({ payCycle: 'Monthly', offerClosingDate: '2026-10-10' });
  });
});
