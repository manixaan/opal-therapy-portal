/**
 * Resource Hub governance — vocabularies, access rules, review state machine
 * and attribution.
 *
 * These are the rules that keep client-derived material out of the hub and
 * keep somebody else's work from being badged as Opal's, so they are tested
 * exhaustively rather than representatively.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const G = require('../resource-governance');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '024_resource_governance.sql'), 'utf8');

describe('vocabularies stay in step with migration 024', () => {
  // The module and the CHECK constraints are two copies of the same list. If
  // they drift, the database rejects writes the code believes are valid.
  const cases = [
    ['valid_resource_source_class', G.SOURCE_CLASSES],
    ['valid_resource_rights_status', G.RIGHTS_STATUSES],
    ['valid_resource_access_tier', G.ACCESS_TIERS],
    ['valid_resource_publication_state', G.PUBLICATION_STATES],
    ['valid_resource_clinical_status', G.CLINICAL_STATUSES],
    ['valid_resource_brand_review_status', G.BRAND_REVIEW_STATUSES],
  ];

  test.each(cases)('%s lists exactly the module values', (constraint, values) => {
    const idx = MIGRATION.indexOf(constraint);
    expect(idx).toBeGreaterThan(-1);
    const block = MIGRATION.slice(idx, idx + 700);
    for (const v of values) expect(block).toContain(`'${v}'`);
    // and nothing extra: count quoted literals inside the IN (...) list
    const inList = block.slice(block.indexOf('IN ('), block.indexOf('));') + 1);
    const quoted = (inList.match(/'[a-z-]+'/g) || []).map((s) => s.replace(/'/g, ''));
    expect(quoted.sort()).toEqual(values.slice().sort());
  });
});

describe('access tiers name only what this app can enforce', () => {
  test('public and participant are NOT access tiers', () => {
    expect(G.ACCESS_TIERS).not.toContain('public');
    expect(G.ACCESS_TIERS).not.toContain('participant');
  });

  test('but they remain expressible as intended audience', () => {
    expect(G.INTENDED_AUDIENCES).toContain('participant');
    expect(G.INTENDED_AUDIENCES).toContain('parent-carer');
  });

  test('the migration also refuses them at the database level', () => {
    const idx = MIGRATION.indexOf('valid_resource_access_tier');
    const block = MIGRATION.slice(idx, idx + 400);
    expect(block).not.toContain("'public'");
    expect(block).not.toContain("'participant'");
  });
});

describe('canReadTier', () => {
  test('every role is denied excluded-private', () => {
    for (const role of Object.keys(G.ROLE_TIERS)) {
      expect(G.canReadTier(role, 'excluded-private')).toBe(false);
    }
  });

  test('read_only sees staff material only', () => {
    expect(G.canReadTier('read_only', 'staff')).toBe(true);
    expect(G.canReadTier('read_only', 'clinician')).toBe(false);
    expect(G.canReadTier('read_only', 'admin')).toBe(false);
  });

  test('therapists reach clinician tier but not admin', () => {
    expect(G.canReadTier('therapist', 'clinician')).toBe(true);
    expect(G.canReadTier('therapist', 'admin')).toBe(false);
  });

  test('owner and admin reach the admin tier', () => {
    expect(G.canReadTier('owner', 'admin')).toBe(true);
    expect(G.canReadTier('admin', 'admin')).toBe(true);
  });

  test('an unknown or absent role reaches nothing', () => {
    expect(G.tiersForRole('wizard')).toEqual([]);
    expect(G.canReadTier(undefined, 'staff')).toBe(false);
    expect(G.canReadTier(null, 'staff')).toBe(false);
  });
});

describe('isListable', () => {
  const base = { access_tier: 'staff', publication_state: 'approved' };

  test('an approved staff resource is listable by staff roles', () => {
    expect(G.isListable(base, 'therapist')).toBe(true);
  });

  test.each(['inventory', 'rights-review', 'clinical-review', 'brand-accessibility-review', 'retired'])(
    'a resource in %s never appears in a listing', (state) => {
      expect(G.isListable({ ...base, publication_state: state }, 'owner')).toBe(false);
    });

  test('excluded-private is invisible to the owner', () => {
    expect(G.isListable(
      { access_tier: 'excluded-private', publication_state: 'excluded-private' }, 'owner')).toBe(false);
  });

  test('a clinician-tier resource is hidden from read_only', () => {
    expect(G.isListable({ ...base, access_tier: 'clinician' }, 'read_only')).toBe(false);
    expect(G.isListable({ ...base, access_tier: 'clinician' }, 'therapist')).toBe(true);
  });

  test('a missing resource is not listable', () => {
    expect(G.isListable(null, 'owner')).toBe(false);
  });
});

describe('listPredicate', () => {
  test('returns null for a role with no tiers, so callers cannot fall through to "no filter"', () => {
    expect(G.listPredicate('wizard', 1)).toBeNull();
  });

  test('binds the role tiers and the listable states, and excludes private both ways', () => {
    const p = G.listPredicate('therapist', 3);
    expect(p.params[0]).toEqual(['staff', 'clinician']);
    expect(p.params[1]).toEqual(G.LISTABLE_STATES);
    expect(p.sql).toContain('$3');
    expect(p.sql).toContain('$4');
    expect(p.sql).toContain("r.access_tier <> 'excluded-private'");
    expect(p.sql).toContain("r.publication_state <> 'excluded-private'");
  });
});

describe('review state machine', () => {
  test('excluded-private is terminal from every direction', () => {
    for (const to of G.PUBLICATION_STATES) {
      expect(G.canTransition('excluded-private', to).ok).toBe(false);
    }
  });

  test('publishing is refused in this release, with a reason that says why', () => {
    expect(G.PUBLISH_ENABLED).toBe(false);
    const r = G.canTransition('approved', 'published');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/non-staff audience/i);
  });

  test('the normal review path is walkable end to end', () => {
    const path = ['inventory', 'rights-review', 'clinical-review',
      'brand-accessibility-review', 'approved'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(G.canTransition(path[i], path[i + 1])).toEqual({ ok: true });
    }
  });

  test('a reviewer can send a record back a step', () => {
    expect(G.canTransition('clinical-review', 'rights-review').ok).toBe(true);
    expect(G.canTransition('brand-accessibility-review', 'clinical-review').ok).toBe(true);
  });

  test('skipping review stages is refused', () => {
    expect(G.canTransition('inventory', 'approved').ok).toBe(false);
    expect(G.canTransition('rights-review', 'approved').ok).toBe(false);
  });

  test('unknown target states and no-op transitions are refused', () => {
    expect(G.canTransition('inventory', 'sideways').ok).toBe(false);
    expect(G.canTransition('approved', 'approved').ok).toBe(false);
  });

  test('anything can be retired, and a retired record returns to inventory', () => {
    for (const from of ['inventory', 'rights-review', 'clinical-review',
      'brand-accessibility-review', 'approved']) {
      expect(G.canTransition(from, 'retired').ok).toBe(true);
    }
    expect(G.canTransition('retired', 'inventory').ok).toBe(true);
  });
});

describe('approvalBlockers', () => {
  const clean = {
    source_class: 'opal-original',
    rights_status: 'opal-owned',
    content_owner: 'user-uuid',
    content_version: '1.0',
    review_due_at: '2027-01-01',
    clinical_status: 'clinically-reviewed',
    brand_review_status: 'approved',
  };

  test('a fully provenanced resource has no blockers', () => {
    expect(G.approvalBlockers(clean)).toEqual([]);
  });

  test('an unclassified source blocks approval', () => {
    expect(G.approvalBlockers({ ...clean, source_class: 'unknown' })[0]).toMatch(/source class/i);
  });

  test('unreviewed rights block approval', () => {
    expect(G.approvalBlockers({ ...clean, rights_status: 'unreviewed' })[0]).toMatch(/rights/i);
  });

  test.each(['restricted', 'reference-only'])('rights of %s block hosting outright', (rs) => {
    expect(G.approvalBlockers({ ...clean, rights_status: rs }).join(' ')).toMatch(/does not permit/i);
  });

  test('missing owner, version, review date or clinical review each block', () => {
    expect(G.approvalBlockers({ ...clean, content_owner: null }).join(' ')).toMatch(/content owner/i);
    expect(G.approvalBlockers({ ...clean, content_version: null }).join(' ')).toMatch(/version/i);
    expect(G.approvalBlockers({ ...clean, review_due_at: null }).join(' ')).toMatch(/review due/i);
    expect(G.approvalBlockers({ ...clean, clinical_status: 'draft' }).join(' ')).toMatch(/clinical review/i);
  });

  test('a pending brand review blocks approval — this is what holds the five wordmark drafts', () => {
    expect(G.approvalBlockers({ ...clean, brand_review_status: 'pending' }).join(' '))
      .toMatch(/brand and accessibility/i);
  });

  test('the five seeded drafts, as seeded, cannot be approved', () => {
    const seeded = {
      source_class: 'opal-original', rights_status: 'opal-owned',
      content_owner: null, content_version: '0.1', review_due_at: null,
      clinical_status: 'draft', brand_review_status: 'pending',
    };
    expect(G.approvalBlockers(seeded).length).toBeGreaterThanOrEqual(4);
  });
});

describe('attribution — no third-party work may ever wear the Opal badge', () => {
  test('only an explicit opal-original earns it', () => {
    for (const cls of G.SOURCE_CLASSES) {
      const a = G.attribution({ source_class: cls, source_publisher: 'Someone Else' });
      if (cls === 'opal-original') {
        expect(a.opalAuthored).toBe(true);
        expect(a.label).toBe('Opal Therapy');
      } else {
        expect(a.opalAuthored).toBe(false);
        expect(a.label).not.toBe('Opal Therapy');
      }
    }
  });

  test('an unclassified resource shows its publisher, never Opal', () => {
    expect(G.attribution({ source_class: 'unknown', source_publisher: 'NDIS' }))
      .toEqual({ label: 'NDIS', kind: 'unreviewed', opalAuthored: false });
  });

  test('an unclassified resource with no publisher says so honestly', () => {
    expect(G.attribution({ source_class: 'unknown' }).label).toBe('Source under review');
  });

  test('the 163 existing records, all backfilled to unknown, cannot show an Opal badge', () => {
    const backfilled = { source_class: 'unknown', rights_status: 'unreviewed', source_publisher: null };
    const a = G.attribution(backfilled);
    expect(a.opalAuthored).toBe(false);
    expect(a.label).toBe('Source under review');
  });

  test('government and instrument records keep their own publisher identity', () => {
    expect(G.attribution({ source_class: 'government-official', source_publisher: 'NDIA' }).label).toBe('NDIA');
    expect(G.attribution({ source_class: 'standardised-instrument', source_publisher: 'WHO' }).label).toBe('WHO');
  });

  test('a missing publisher never silently becomes Opal', () => {
    for (const cls of G.SOURCE_CLASSES.filter((c) => c !== 'opal-original')) {
      expect(G.attribution({ source_class: cls }).label).not.toBe('Opal Therapy');
    }
  });

  test('source_class is not treated as evidence of rights', () => {
    // An Opal-authored record with unreviewed rights still cannot be approved.
    const r = { source_class: 'opal-original', rights_status: 'unreviewed' };
    expect(G.attribution(r).opalAuthored).toBe(true);
    expect(G.approvalBlockers(r).join(' ')).toMatch(/rights/i);
  });
});

describe('who may govern — authority comes from role, never from having a session', () => {
  const IN_REVIEW = ['inventory', 'rights-review', 'clinical-review', 'brand-accessibility-review'];

  test('read_only cannot transition anything, to any state', () => {
    for (const to of G.PUBLICATION_STATES) {
      const v = G.canPerformTransition('read_only', to);
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/read-only/i);
    }
  });

  test('a therapist cannot transition anything, and is denied explicitly rather than by omission', () => {
    for (const to of G.PUBLICATION_STATES) {
      const v = G.canPerformTransition('therapist', to);
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/therapists/i);
    }
  });

  test('an admin may shepherd a record through review', () => {
    for (const to of IN_REVIEW) expect(G.canPerformTransition('admin', to).allowed).toBe(true);
    expect(G.canPerformTransition('admin', 'retired').allowed).toBe(true);
  });

  test('but only the owner may approve or publish', () => {
    for (const to of G.APPROVAL_STATES) {
      expect(G.canPerformTransition('admin', to).allowed).toBe(false);
      expect(G.canPerformTransition('owner', to).allowed).toBe(true);
    }
    expect(G.APPROVAL_STATES).toEqual(['approved', 'published']);
  });

  test('quarantine is available to every governance role — it is protective, not a fitness call', () => {
    for (const role of ['owner', 'admin']) {
      expect(G.canPerformTransition(role, 'excluded-private').allowed).toBe(true);
    }
    // ...but never to those with no governance authority at all.
    for (const role of ['therapist', 'read_only', 'nobody']) {
      expect(G.canPerformTransition(role, 'excluded-private').allowed).toBe(false);
    }
    expect(G.APPROVAL_STATES).not.toContain('excluded-private');
    expect(G.QUARANTINE_STATES).toEqual(['excluded-private']);
  });

  test('an admin cannot complete clinical review by advancing past it', () => {
    const v = G.canPerformTransition('admin', 'brand-accessibility-review', 'clinical-review');
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/clinical attestation/i);
    expect(G.canPerformTransition('owner', 'brand-accessibility-review', 'clinical-review').allowed).toBe(true);
  });

  test('an admin CAN send a record back from clinical review — that asserts nothing clinical', () => {
    expect(G.canPerformTransition('admin', 'rights-review', 'clinical-review').allowed).toBe(true);
    expect(G.canPerformTransition('admin', 'retired', 'clinical-review').allowed).toBe(true);
  });

  test('an admin CAN run the rights and brand/accessibility stages', () => {
    expect(G.canPerformTransition('admin', 'clinical-review', 'rights-review').allowed).toBe(true);
    expect(G.canPerformTransition('admin', 'brand-accessibility-review', 'rights-review').allowed).toBe(true);
  });

  test('nor can an admin assert clinical review via the field instead of the transition', () => {
    const v = G.canSetClinicalStatus('admin', 'clinically-reviewed');
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/reserved for the owner/i);
    expect(G.canSetClinicalStatus('owner', 'clinically-reviewed').allowed).toBe(true);
    // other clinical values remain ordinary review work
    expect(G.canSetClinicalStatus('admin', 'draft').allowed).toBe(true);
    expect(G.canSetClinicalStatus('therapist', 'draft').allowed).toBe(false);
  });

  test('an unknown role, an absent role and a forged one all get nothing', () => {
    for (const role of [undefined, null, '', 'reviewer', 'superuser', 'Owner ']) {
      for (const to of G.PUBLICATION_STATES) {
        expect(G.canPerformTransition(role, to).allowed).toBe(false);
      }
    }
  });

  test('role matching is case-insensitive so casing cannot escalate or lock out', () => {
    expect(G.canPerformTransition('OWNER', 'approved').allowed).toBe(true);
    expect(G.canPerformTransition('Admin', 'rights-review').allowed).toBe(true);
    expect(G.canPerformTransition('READ_ONLY', 'inventory').allowed).toBe(false);
  });

  test('holding a user id implies nothing — the policy accepts no id at all', () => {
    // (role, toState, fromState) — there is nowhere to pass an identity, so an
    // authenticated session can never be mistaken for authority.
    expect(G.canPerformTransition.length).toBe(3);
    expect(G.canPerformTransition('therapist', 'approved').allowed).toBe(false);
  });

  test('the two gates disagree exactly where they should', () => {
    // An admin passes the reviewer gate and fails the approver gate; that
    // difference is the whole point of having two.
    expect(G.canPerformTransition('admin', 'rights-review').allowed).toBe(true);
    expect(G.canPerformTransition('admin', 'approved').allowed).toBe(false);
  });
});

describe('rejection semantics', () => {
  test('returning a record for changes is a legal, non-terminal move', () => {
    expect(G.canTransition('clinical-review', 'rights-review').ok).toBe(true);
  });

  test('a rejected record lands on retired, which stays revivable by deliberate act', () => {
    expect(G.canTransition('approved', 'retired').ok).toBe(true);
    expect(G.canTransition('retired', 'inventory').ok).toBe(true);
  });

  test('retired is not a back door to approved', () => {
    expect(G.canTransition('retired', 'approved').ok).toBe(false);
    expect(G.canTransition('retired', 'published').ok).toBe(false);
  });
});

describe('file-level access — effective tier is the more restrictive of the two', () => {
  test('a file with no tier of its own inherits the resource tier', () => {
    for (const t of ['staff', 'clinician', 'admin']) {
      expect(G.effectiveAccessTier(t, null)).toBe(t);
      expect(G.effectiveAccessTier(t, undefined)).toBe(t);
      expect(G.effectiveAccessTier(t, '')).toBe(t);
    }
  });

  test('a file may NARROW access below its resource', () => {
    expect(G.effectiveAccessTier('staff', 'clinician')).toBe('clinician');
    expect(G.effectiveAccessTier('staff', 'admin')).toBe('admin');
    expect(G.effectiveAccessTier('clinician', 'admin')).toBe('admin');
  });

  test('a file may NEVER widen access above its resource', () => {
    expect(G.effectiveAccessTier('clinician', 'staff')).toBe('clinician');
    expect(G.effectiveAccessTier('admin', 'staff')).toBe('admin');
    expect(G.effectiveAccessTier('admin', 'clinician')).toBe('admin');
  });

  test('an excluded-private resource poisons every file hanging off it', () => {
    for (const t of ['staff', 'clinician', 'admin', null]) {
      expect(G.effectiveAccessTier('excluded-private', t)).toBe('excluded-private');
    }
  });

  test('an unrecognised tier on either side fails closed', () => {
    expect(G.effectiveAccessTier('staff', 'public')).toBe('excluded-private');
    expect(G.effectiveAccessTier('participant', 'staff')).toBe('excluded-private');
    expect(G.effectiveAccessTier(null, null)).toBe('excluded-private');
    expect(G.effectiveAccessTier(undefined, 'staff')).toBe('excluded-private');
  });

  test('canReadFile applies role rules to the effective tier', () => {
    // DOCX marked clinician-only on a staff resource: read_only is refused.
    expect(G.canReadFile('read_only', 'staff', 'clinician')).toBe(false);
    expect(G.canReadFile('therapist', 'staff', 'clinician')).toBe(true);
    // A staff-tier file cannot rescue a clinician-only resource for read_only.
    expect(G.canReadFile('read_only', 'clinician', 'staff')).toBe(false);
    // Nobody reads anything under an excluded-private resource.
    for (const role of ['owner', 'admin', 'therapist', 'read_only']) {
      expect(G.canReadFile(role, 'excluded-private', null)).toBe(false);
    }
  });

  test('the restrictiveness ranking matches the role table', () => {
    // staff is the broadest tier: every governance role can read it.
    expect(G.TIER_RESTRICTIVENESS.staff).toBeLessThan(G.TIER_RESTRICTIVENESS.clinician);
    expect(G.TIER_RESTRICTIVENESS.clinician).toBeLessThan(G.TIER_RESTRICTIVENESS.admin);
    expect(G.TIER_RESTRICTIVENESS.admin).toBeLessThan(G.TIER_RESTRICTIVENESS['excluded-private']);
    expect(G.tiersForRole('read_only')).toEqual(['staff']);
  });
});
