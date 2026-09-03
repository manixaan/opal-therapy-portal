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
  test('a new record with no offer asks the admin to prepare one', () => {
    const j = journey.projectJourney({ assignment: assignment(), now: NOW });
    expect(j.stage.key).toBe('offer');
    expect(j.next).toMatchObject({ actor: 'admin', action: 'edit_offer' });
    expect(j.stages[1].state).toBe('pending');
  });

  test('a draft waits for approval; an approved letter waits to be sent', () => {
    expect(journey.projectJourney({ assignment: assignment(), offer: offer(), now: NOW }).next.action).toBe('approve_offer');
    expect(journey.projectJourney({ assignment: assignment(), offer: offer({ status: 'approved' }), now: NOW }).next.action).toBe('send_offer');
  });

  test('a sent letter is waiting on the employee, and is not the admin\'s problem yet', () => {
    const j = journey.projectJourney({
      assignment: assignment(), now: NOW,
      offer: offer({ status: 'sent', sent_at: daysFromNow(-1), token_expires_at: daysFromNow(13) }),
    });
    expect(j.next.actor).toBe('employee');
    expect(j.counts.waitingOnEmployee).toBe(1);
    expect(j.counts.overdue).toBe(0);
    expect(j.attention).toBe(0);
  });

  test('a sent letter with no answer after the chase window is flagged overdue', () => {
    const j = journey.projectJourney({
      assignment: assignment(), now: NOW,
      offer: offer({ status: 'sent', sent_at: daysFromNow(-journey.OFFER_CHASE_DAYS - 1), token_expires_at: daysFromNow(7) }),
    });
    expect(j.overdue).toHaveLength(1);
    expect(j.attention).toBeGreaterThan(0);
  });

  test('an expired link hands the next action back to the admin', () => {
    const j = journey.projectJourney({
      assignment: assignment(), now: NOW,
      offer: offer({ status: 'sent', sent_at: daysFromNow(-20), token_expires_at: daysFromNow(-1) }),
    });
    expect(j.next).toMatchObject({ actor: 'admin', action: 'resend_offer' });
  });

  test('a declined offer blocks the stage and asks the admin to decide', () => {
    const j = journey.projectJourney({ assignment: assignment(), offer: offer({ status: 'declined', responded_at: NOW }), now: NOW });
    expect(j.stages[0].state).toBe('blocked');
    expect(j.next.action).toBe('reissue_offer');
    expect(j.counts.adminReview).toBe(1);
  });

  test('acceptance completes the stage and, until release, asks the admin to release', () => {
    const j = journey.projectJourney({ assignment: assignment(), offer: offer({ status: 'accepted', responded_at: NOW }), now: NOW });
    expect(j.stages[0].state).toBe('complete');
    expect(j.stage.key).toBe('documentation');
    expect(j.next).toMatchObject({ actor: 'admin', action: 'release' });
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

  test('the checklist is keyed to the role — a treating therapist gets clinical supervision', () => {
    const ot = journey.buildInductionTasks(assignment(), { now: NOW });
    const admin = journey.buildInductionTasks(assignment({ is_treating_therapist: false, role_category: 'administration' }), { now: NOW });
    expect(ot.map((t) => t.code)).toContain('clinical_supervision');
    expect(admin.map((t) => t.code)).not.toContain('clinical_supervision');
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

  test('a failed task is surfaced for review before the next open one', () => {
    const tasks = [task({ code: 'portal_access', status: 'failed', note: 'blocked', sort_order: 10 }), task({ code: 'x', sort_order: 20 })];
    const j = journey.projectJourney({ assignment: assignment({ status: 'activated' }), offer: accepted, tasks, now: NOW });
    expect(j.counts.adminReview).toBe(1);
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

describe('the letter of offer', () => {
  test('renders the terms once, escaped, in both HTML and text', () => {
    const { terms } = letter.normaliseTerms({
      positionTitle: 'Occupational <Therapist>', employmentType: 'part_time', startDate: '2026-10-01',
      payBasis: 'annual', payRate: 95000, hoursPerWeek: 30.4, probationMonths: 6, workLocation: 'Fremantle',
    }, ['full_time', 'part_time', 'casual']);
    const out = letter.renderOfferLetter({ terms, applicantName: 'Jane Smith', orgName: 'Opal Therapy', issuedAt: NOW, signatoryName: 'Ann Owner' });
    expect(out.html).toContain('Occupational &lt;Therapist&gt;');
    expect(out.html).not.toContain('<Therapist>');
    expect(out.html).toContain('$95,000.00 per annum');
    expect(out.html).toContain('30.4 hours per week');
    expect(out.html).toContain('6 months');
    expect(out.text).toContain('Dear Jane,');
    expect(out.text).toContain('Ann Owner');
  });

  test('normalisation refuses what a letter cannot state', () => {
    const types = ['full_time', 'part_time', 'casual'];
    expect(letter.normaliseTerms({}, types).errors).toEqual(expect.arrayContaining(['Position is required', 'Employment type is not recognised', 'Commencement date is required']));
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', payRate: 50 }, types).errors)
      .toContain('Pay basis is required when a rate is given');
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', probationMonths: 2.5 }, types).errors)
      .toEqual(expect.arrayContaining([expect.stringMatching(/Probation/)]));
    expect(letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', hoursPerWeek: 90 }, types).errors)
      .toEqual(expect.arrayContaining([expect.stringMatching(/Standard hours/)]));
  });

  test('unknown keys never reach the snapshot', () => {
    const { terms } = letter.normaliseTerms({ positionTitle: 'OT', employmentType: 'casual', startDate: '2026-10-01', tfn: '123' }, ['casual']);
    expect(terms).not.toHaveProperty('tfn');
  });
});
