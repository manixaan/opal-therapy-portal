'use strict';

/**
 * The Owner has been through Edit Onboarding. Every derived item's three
 * switches (required / employee returns / verified by us) start as No until
 * set there; these fixtures set them to the values the catalogue implies, so
 * the workflow tests exercise a configured practice rather than a blank one.
 */
const odb = require('../../onboarding-db');
const pdb = require('../../onboarding-pack-db');
const pack = require('../../onboarding-pack');

async function configurePackDefaults(orgId) {
  const packages = await odb.listPackages(orgId, { kind: 'package' });
  const library = await odb.listDocuments(orgId);
  const byCode = new Map(library.map((d) => [d.code, d]));
  const settings = await odb.getOnboardingSettings();
  for (const pkg of packages) {
    const version = await odb.getCurrentPackageVersion(pkg.id);
    if (!version) continue;
    const facts = pack.sampleFactsFor(pkg, settings);
    for (const phase of ['documentation', 'induction']) {
      for (const it of pack.buildDefaultItems(version.content, facts, byCode, phase)) {
        await pdb.upsertPackDefault({ organisationId: orgId, packageId: pkg.id, phase, code: it.code, action: 'override',
          patch: { required: it.required !== false, returns: it.returns === true, verifies: it.verifies === true } });
      }
    }
  }
}

module.exports = { configurePackDefaults };
