'use strict';

/**
 * SERVICE AGREEMENT — PERMISSION SURFACE GUARDS.
 *
 * The route file is the boundary for this feature, and two of its rules cannot
 * be checked by exercising one endpoint at a time — they are properties of
 * EVERY endpoint, and a new route added next year is exactly what would break
 * them:
 *
 *   1. WORD IS OWNER-ONLY, everywhere. A .docx is editable, so handing one to
 *      an employee makes the agreement's wording negotiable by whoever holds
 *      the file — the single thing master versioning exists to prevent. Every
 *      route serving Word must name requireOwner.
 *   2. THE MASTER NEEDS BOTH. Publishing changes the legal document every
 *      future agreement is built from. Every mutating master route must name
 *      requireOwner AND requireMasterAuthority.
 *
 * So these are STATIC guards, in the manner of interview-surface-guards.js:
 * they read the source as text and assert the protections are present. The
 * middleware itself is then exercised for real against fake req/res objects,
 * because a guard that only checks a route mentions a function proves nothing
 * about what that function does.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_PATH = path.join(__dirname, '..', 'service-agreement-routes.js');
const ROUTES = fs.readFileSync(ROUTES_PATH, 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const {
  SERVICE_AGREEMENT_PERMISSIONS, KNOWN_PERMISSIONS, getPermissions, hasPermission,
  requireMasterAuthority, requireOwner, requirePermission,
} = require('../permissions');

/** Source with comments stripped, so prose cannot satisfy an assertion. */
const CODE = ROUTES
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * Every route definition as `{ method, routePath, guards }`, where `guards` is
 * the text between the path and the handler — i.e. the middleware chain.
 */
function routeDefinitions(source) {
  const out = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,([\s\S]*?)safe\(/g;
  let m;
  while ((m = re.exec(source))) {
    out.push({ method: m[1], routePath: m[2], guards: m[3] });
  }
  return out;
}

const ROUTE_DEFS = routeDefinitions(CODE);

/** Minimal express doubles. */
function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function runMiddleware(mw, user) {
  const res = fakeRes();
  let nexted = false;
  mw({ user }, res, () => { nexted = true; });
  return { nexted, status: res.statusCode, body: res.body };
}

// ═══════════════════════════════════════════════════════════════════════════
//  The route file parses into something worth asserting about
// ═══════════════════════════════════════════════════════════════════════════

describe('the route surface', () => {
  it('is requireable and exports a router', () => {
    const router = require('../service-agreement-routes');
    expect(typeof router).toBe('function');
    expect(typeof router.use).toBe('function');
  });

  it('defines a substantial number of routes', () => {
    // If this collapses to a handful, the regex above stopped matching and
    // every guard below is silently passing over nothing.
    expect(ROUTE_DEFS.length).toBeGreaterThan(15);
  });

  it('is mounted in server.js', () => {
    expect(SERVER).toMatch(/require\('\.\/service-agreement-routes'\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Authentication and the permission gate
// ═══════════════════════════════════════════════════════════════════════════

describe('the authenticated surface is gated before any route runs', () => {
  it('requires a session and the access permission on the whole namespace', () => {
    expect(CODE).toMatch(/router\.use\('\/api\/service-agreements',\s*requireAuth\)/);
    expect(CODE).toMatch(
      /router\.use\('\/api\/service-agreements',\s*requirePermission\('service_agreements\.access'\)\)/
    );
  });

  it('applies both guards BEFORE the first route is defined', () => {
    const authAt = CODE.indexOf("router.use('/api/service-agreements', requireAuth)");
    const permAt = CODE.indexOf("requirePermission('service_agreements.access')");
    const firstRoute = CODE.search(/router\.(get|post|put|patch|delete)\(/);
    expect(authAt).toBeGreaterThan(-1);
    expect(permAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(firstRoute);
    expect(permAt).toBeLessThan(firstRoute);
  });

  it('mounts the gate on the exact prefix, so the signing surface is not swept in', () => {
    // '/api/service-agreement' (no plural s) would also match
    // '/api/service-agreement-signing' and lock participants out of their own
    // agreements. The prefix must be exact.
    const mounts = [...CODE.matchAll(/router\.use\('([^']+)',\s*require(?:Auth|Permission)/g)]
      .map((m) => m[1]);
    expect(mounts.length).toBeGreaterThan(0);
    for (const p of mounts) expect(p).toBe('/api/service-agreements');
  });

  it('leaves the participant signing routes unauthenticated by design', () => {
    const signingRoutes = ROUTE_DEFS.filter((r) => r.routePath.startsWith('/api/service-agreement-signing'));
    expect(signingRoutes.length).toBeGreaterThanOrEqual(4);
    for (const r of signingRoutes) {
      expect(r.guards).not.toMatch(/requireAuth|requirePermission|requireOwner/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Word is owner-only
// ═══════════════════════════════════════════════════════════════════════════

describe('every Word download is owner-only', () => {
  const docxRoutes = ROUTE_DEFS.filter((r) => r.routePath.endsWith('/docx'));

  it('finds the Word routes at all', () => {
    expect(docxRoutes.length).toBeGreaterThanOrEqual(2);
  });

  it.each(docxRoutes.map((r) => [r.method, r.routePath, r.guards]))(
    '%s %s names requireOwner',
    (_method, _routePath, guards) => {
      expect(guards).toMatch(/requireOwner/);
    }
  );

  it('serves Word to nobody else, by any other route', () => {
    // A route that SENDS Word bytes without requireOwner would bypass the rule
    // above without ever ending in '/docx'. Storing a .docx is not serving one
    // — /issue retains an owner copy it never hands out — so the test looks for
    // sendFile(..., DOCX_MIME) specifically, and reads only as far as the next
    // route so one handler's body cannot be attributed to its neighbour.
    const sending = ROUTE_DEFS.filter((r) => {
      const start = CODE.indexOf(`'${r.routePath}'`);
      const nextRoute = CODE.slice(start + 1).search(/router\.(get|post|put|patch|delete)\(/);
      const body = CODE.slice(start, nextRoute === -1 ? undefined : start + 1 + nextRoute);
      return /sendFile\([^;]*DOCX_MIME/.test(body);
    });

    // The guard is only meaningful if it found the routes it is guarding.
    expect(sending.map((r) => r.routePath).sort()).toEqual([
      '/api/service-agreements/:id/docx',
      '/api/service-agreements/master/:id/docx',
    ]);
    for (const r of sending) expect(r.guards).toMatch(/requireOwner/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The master needs owner AND the specific permission
// ═══════════════════════════════════════════════════════════════════════════

describe('mutating the master requires owner and the master permission', () => {
  const masterMutations = ROUTE_DEFS.filter(
    (r) => r.routePath.includes('/master') && ['post', 'put', 'patch', 'delete'].includes(r.method)
  );

  it('finds the mutating master routes', () => {
    // upload, publish, retire, republish, clauses
    expect(masterMutations.length).toBeGreaterThanOrEqual(5);
  });

  it.each(masterMutations.map((r) => [r.method, r.routePath, r.guards]))(
    '%s %s names requireOwner and requireMasterAuthority',
    (_method, _routePath, guards) => {
      expect(guards).toMatch(/requireOwner/);
      expect(guards).toMatch(/requireMasterAuthority/);
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════
//  The middleware actually does what the routes rely on
// ═══════════════════════════════════════════════════════════════════════════

describe('requireMasterAuthority', () => {
  it('lets through an owner who holds the permission', () => {
    const r = runMiddleware(requireMasterAuthority,
      { role: 'owner', permissions: ['service_agreements.manage_master'] });
    expect(r.nexted).toBe(true);
  });

  it('refuses an admin even when the permission was granted', () => {
    // Two checks rather than one because they refuse different mistakes: this
    // is the accidental grant in the delegation UI.
    const r = runMiddleware(requireMasterAuthority,
      { role: 'admin', permissions: ['service_agreements.manage_master'] });
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(403);
  });

  it('lets an owner through even with an empty permissions column', () => {
    // The owner holds every service-agreement permission IMPLICITLY
    // (permissions.js getPermissions), on the same footing as onboarding and
    // interviews: the practice owner is the data controller and must not be
    // able to lock themselves out of their own master. So the effective rule
    // is "owner, and nobody else" — which is what the specification asks for.
    const r = runMiddleware(requireMasterAuthority, { role: 'owner', permissions: [] });
    expect(r.nexted).toBe(true);
  });

  it('refuses a therapist who somehow acquired the permission string', () => {
    const r = runMiddleware(requireMasterAuthority,
      { role: 'therapist', permissions: ['service_agreements.manage_master'] });
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(403);
  });

  it('refuses an anonymous caller with 401, not 403', () => {
    const r = runMiddleware(requireMasterAuthority, null);
    expect(r.status).toBe(401);
  });
});

describe('requireOwner', () => {
  it('allows an owner and refuses everybody else', () => {
    expect(runMiddleware(requireOwner, { role: 'owner' }).nexted).toBe(true);
    for (const role of ['admin', 'therapist', 'read_only', 'pre_employee']) {
      const r = runMiddleware(requireOwner, { role });
      expect(r.nexted).toBe(false);
      expect(r.status).toBe(403);
    }
  });

  it('refuses an anonymous caller with 401', () => {
    expect(runMiddleware(requireOwner, null).status).toBe(401);
  });
});

describe('requirePermission on the access gate', () => {
  const mw = requirePermission('service_agreements.access');

  it('allows a user who was granted it', () => {
    expect(runMiddleware(mw, { role: 'admin', permissions: ['service_agreements.access'] }).nexted)
      .toBe(true);
  });

  it('refuses a user who was not', () => {
    const r = runMiddleware(mw, { role: 'admin', permissions: [] });
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The permission model itself
// ═══════════════════════════════════════════════════════════════════════════

describe('the service agreement permissions', () => {
  it('are exactly the three the feature defines', () => {
    expect([...SERVICE_AGREEMENT_PERMISSIONS].sort()).toEqual([
      'service_agreements.access',
      'service_agreements.manage_master',
      'service_agreements.view_all',
    ]);
  });

  it('are all in the grant allowlist', () => {
    for (const p of SERVICE_AGREEMENT_PERMISSIONS) expect(KNOWN_PERMISSIONS.has(p)).toBe(true);
  });

  it('are all held implicitly by the owner', () => {
    const owner = getPermissions('owner');
    for (const p of SERVICE_AGREEMENT_PERMISSIONS) expect(owner).toContain(p);
  });

  it('are held by NO other role out of the box', () => {
    // The point of a delegated permission: an admin is not a service-agreement
    // administrator until the Owner says so, one permission at a time.
    for (const role of ['admin', 'therapist', 'read_only', 'pre_employee']) {
      const perms = getPermissions(role);
      for (const p of SERVICE_AGREEMENT_PERMISSIONS) expect(perms).not.toContain(p);
    }
  });

  it('can be granted individually to an admin', () => {
    const perms = getPermissions('admin', ['service_agreements.access']);
    expect(perms).toContain('service_agreements.access');
    expect(perms).not.toContain('service_agreements.manage_master');
  });

  it('ignore an invented permission string in the user column', () => {
    const perms = getPermissions('admin', ['service_agreements.everything']);
    expect(perms).not.toContain('service_agreements.everything');
    expect(hasPermission(
      { role: 'admin', permissions: ['service_agreements.everything'] },
      'service_agreements.everything'
    )).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Responses do not leak stored bytes
// ═══════════════════════════════════════════════════════════════════════════

describe('a master version is never returned with its file bytes', () => {
  it('shapes the response through masterView, which omits file_data', () => {
    const start = CODE.indexOf('function masterView(');
    expect(start).toBeGreaterThan(-1);
    const body = CODE.slice(start, CODE.indexOf('\n}', start));
    expect(body).not.toMatch(/file_data/);
    // And it is what the routes actually return.
    expect(CODE).toMatch(/master:\s*masterView\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Organisation isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('organisation isolation', () => {
  it('scopes every service agreement query with IS NOT DISTINCT FROM', () => {
    // organisation_id is nullable, so `=` silently matches nothing for a user
    // whose organisation is unset — which reads as "no records" rather than
    // as the bug it is.
    const dal = fs.readFileSync(path.join(__dirname, '..', 'service-agreements', 'db.js'), 'utf8');
    const orgComparisons = [...dal.matchAll(/organisation_id\s*(=|IS NOT DISTINCT FROM)/g)]
      .map((m) => m[1]);
    expect(orgComparisons.length).toBeGreaterThan(4);
    for (const op of orgComparisons) expect(op).toBe('IS NOT DISTINCT FROM');
  });

  it('reports a record in another organisation as 404, never 403', () => {
    // Whether an agreement exists is itself information, so ids cannot be
    // probed by the shape of the refusal.
    expect(CODE).toMatch(/loadAgreement/);
    const start = CODE.indexOf('async function loadAgreement(');
    const body = CODE.slice(start, CODE.indexOf('\n}', start));
    expect(body).toMatch(/status\(404\)/);
    expect(body).not.toMatch(/status\(403\)/);
  });
});
