'use strict';

/**
 * TEMPLATES — complete an Opal master inside the portal, then take an
 * INDEPENDENT document away.
 *
 * Mounted from server.js. Every path is /api/templates/...
 *
 * ── Security, and what is deliberately NOT new here ─────────────────────────
 * This capability introduces no permission, no client-access rule and no data
 * path of its own. It reuses, unchanged:
 *
 *   requireAuth                     backend/permissions.js
 *   the clinical read/write split   the same roles the FCA and letter enforce —
 *                                   therapist and owner may write, read_only may
 *                                   read, and ADMIN IS EXCLUDED OUTRIGHT from
 *                                   client data, exactly as /api/fca is
 *   orgOf(req)                      organisation isolation; a user with no
 *                                   organisation is refused before any query
 *   searchClients / loadSploseClient / loadClientProfile
 *                                   the only client readers in the codebase
 *   loadOwnDocument                 organisation-scoped AND own-only
 *
 * A browser supplies a document id and, at creation, a client id. Neither is
 * trusted: the document is re-fetched under (organisation, creator) on every
 * request and a miss is 404 — not 403, which would confirm the row exists — and
 * the client a document resolves against is read from the STORED row, never
 * from the query string. So no request can widen its own scope.
 *
 * Nothing here writes to a master, to a client profile or to organisation
 * settings. The only table this module writes is template_documents.
 */

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();

const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const log = require('./logger').createLogger('templates');

const { searchClients } = require('./fca/client-search');
const {
  loadSploseClient, loadClientProfile, loadPortalData, loadOrganisationSettings, isUuid,
} = require('./fca/data-layers');
const { paginateForPreview } = require('./fca/preview-pagination');

const catalogue = require('./templates/catalogue');
const {
  resolveDocument, composePortalDocx, exportDocument, sectionStructure, DOCX_MIME,
} = require('./templates/compose');

const orgOf = (req) => req.user?.organisation_id || null;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('templates route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const str = (v, max) => (v === null || v === undefined ? '' : String(v)).slice(0, max).trim();

/** Longest value accepted for one field. Matches the FCA's override ceiling. */
const MAX_FIELD_CHARS = 4000;
const MAX_TITLE_CHARS = 200;
const MAX_DOCUMENTS_LISTED = 100;

// ── Guards ───────────────────────────────────────────────────────────────────
// Deliberately identical to backend/fca-routes.js. Templates resolves the same
// clinical client data, so it must not be reachable by a role that cannot
// already reach that data elsewhere.

const CLINICAL_ROLES = new Set(['therapist', 'owner']);

function requireTemplateWrite(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Completing a template is limited to treating therapists.',
    });
  }
  if (!orgOf(req)) {
    return res.status(403).json({
      error: 'no_organisation',
      message: 'Your account is not linked to an organisation.',
    });
  }
  next();
}

function requireTemplateRead(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role) && role !== 'read_only') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Completing a template is limited to treating therapists.',
    });
  }
  if (!orgOf(req)) {
    return res.status(403).json({
      error: 'no_organisation',
      message: 'Your account is not linked to an organisation.',
    });
  }
  next();
}

router.use('/api/templates', requireAuth);

// ── Audit ────────────────────────────────────────────────────────────────────

/** ids, versions and counts only — never names, never client or clinical content. */
async function audit(req, action, targetId, metadata = {}) {
  await db.logAuditEvent({
    action,
    targetType: 'template_document',
    targetId: targetId ? String(targetId) : null,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata,
  }).catch(() => {});
}

function sploseDown(res) {
  return res.status(503).json({
    error: 'splose_unavailable',
    message: 'Client data is temporarily unavailable. Please try again shortly.',
  });
}

// ── Loading one document ─────────────────────────────────────────────────────

/**
 * The document, if it belongs to this organisation AND this user. Both
 * predicates are in the WHERE clause rather than checked afterwards, so there
 * is no path that reads the row first and decides second.
 */
async function loadOwnDocument(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM template_documents
      WHERE id = $1 AND organisation_id = $2 AND created_by_user_id = $3`,
    [id, orgOf(req), req.user.id]
  );
  return rows[0] || null;
}

/**
 * Everything needed to resolve the document, read fresh. The client is taken
 * from the STORED row: a request cannot name a different one.
 */
async function loadState(req, row) {
  const template = catalogue.getTemplate(row.template_id);
  if (!template) throw new Error(`unknown template_id ${row.template_id}`);

  let client = { splose: null, profile: null, currentPlan: null, goals: [] };
  if (row.splose_client_id) {
    const splose = await loadSploseClient(row.splose_client_id);
    const { profile, currentPlan, goals } = await loadClientProfile(orgOf(req), row.splose_client_id);
    client = { splose, profile, currentPlan, goals };
  }

  const therapistProfileId = isUuid(req.user.therapist_profile_id)
    ? req.user.therapist_profile_id
    : null;

  const [portal, organisation] = await Promise.all([
    loadPortalData(req.user.id, therapistProfileId),
    loadOrganisationSettings(orgOf(req)),
  ]);

  return resolveDocument({ template, row, client, portal, organisation });
}

/**
 * The section the FCA master's custom anchor sits inside — clinician-created
 * sections render there, and the editor shows them under it.
 */
const CUSTOM_ANCHOR_PARENT = 'OPAL_SECTION_ASSESSMENT_RESULTS';

/**
 * The section structure as the editor shows it — the EFFECTIVE state after
 * normalisation, never the raw stored value, so what the user sees is exactly
 * what the preview and both exports will compose with.
 */
function sectionsDescriptor(template, row) {
  if (!template.sectionCatalogue) return null;
  const byTag = template.sectionCatalogue.SECTION_BY_TAG;
  const stored = (row && row.sections && typeof row.sections === 'object'
    && !Array.isArray(row.sections)) ? row.sections : {};
  const levels = (stored.levels && typeof stored.levels === 'object') ? stored.levels : {};
  const customById = new Map(
    (Array.isArray(stored.custom) ? stored.custom : [])
      .filter((c) => c && c.id !== undefined)
      .map((c) => [String(c.id), c])
  );

  const all = sectionStructure(template, row).sections;

  const templateRows = all.filter((s) => s.kind !== 'custom')
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const meta = byTag.get(s.tag) || {};
      return {
        tag: s.tag,
        label: meta.label || s.title,
        // The heading text the document itself prints — the editor shows this
        // so its outline reads exactly as the contents page does.
        title: meta.title || s.title,
        description: meta.description || '',
        group: meta.group || 'core',
        parent: meta.parent || null,
        required: Boolean(meta.required),
        custom: false,
        included: s.included !== false,
        headingLevel: levels[s.tag] || null,
        // The size the master's own heading renders at when no override is
        // stored: top-level sections are Heading 1, nested ones Heading 2.
        defaultLevel: meta.parent ? 2 : 1,
        order: s.order,
      };
    });

  const customRows = all.filter((s) => s.kind === 'custom')
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      // The derived tag ends in the id with dashes stripped — recover the
      // stored entry so the editor gets the stable id back.
      const entry = [...customById.values()].find(
        (c) => s.tag.endsWith(String(c.id).toUpperCase().replace(/-/g, ''))
      ) || {};
      return {
        tag: s.tag,
        id: entry.id || null,
        label: s.title,
        title: s.title,
        description: entry.guidance || '',
        group: 'custom',
        // Custom sections render at the master's anchor, inside Assessment
        // Results — the panel shows them there so it mirrors the document.
        parent: CUSTOM_ANCHOR_PARENT,
        required: false,
        custom: true,
        included: true,
        headingLevel: s.headingLevel || null,
        defaultLevel: 2,
        order: s.order,
      };
    });

  // Splice customs where they actually render: after the last row belonging
  // to Assessment Results (the parent itself when it has no children shown).
  let at = templateRows.length;
  for (let i = templateRows.length - 1; i >= 0; i--) {
    const r = templateRows[i];
    if (r.tag === CUSTOM_ANCHOR_PARENT || r.parent === CUSTOM_ANCHOR_PARENT) {
      at = i + 1;
      break;
    }
  }
  templateRows.splice(at, 0, ...customRows);
  return templateRows;
}

/** The wire shape of a document instance. */
function serialiseDocument(state) {
  const { template, row, scalarData, scalarSources, missingFields } = state;
  return {
    id: row.id,
    templateId: template.id,
    templateName: template.name,
    templateVersion: row.template_version,
    title: row.title,
    clientId: row.splose_client_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groups: catalogue.fieldSpec(template).map((g) => ({
      group: g.group,
      fields: g.fields.map((f) => ({
        ...f,
        // The RESOLVED value and where it came from. Never the tag's binding
        // expression — the portal shows people values, not implementation.
        value: scalarData[f.tag] === undefined ? null : scalarData[f.tag],
        source: scalarSources[f.tag] || 'missing',
        entered: Object.prototype.hasOwnProperty.call(row.field_values || {}, f.tag),
      })),
    })),
    missingCount: missingFields.length,
    completedCount: template.scalars.length - missingFields.length,
    fieldCount: template.scalars.length,
    // Present only for templates whose structure the editor may shape (the
    // FCA); null elsewhere so the frontend renders no section panel.
    sections: sectionsDescriptor(template, row),
    // Where clinician-created sections render: the section that hosts the
    // master's custom anchor. Supplied by the server so the frontend never
    // carries a binding identifier of its own.
    customParent: template.sectionCatalogue ? CUSTOM_ANCHOR_PARENT : null,
  };
}

/**
 * Validate a client's section request against the template's own catalogue.
 *
 * Explicit rejection, not silent correction: an unknown tag is a 400 with the
 * reason rather than quietly dropped. The required-section loop below is kept
 * generic, but the Templates catalogue declares NO required sections — in this
 * editor every part of the master is negotiable (catalogue.js has the note).
 *
 * @returns {{ ok: true, value: object|null } | { ok: false, error, message }}
 */
function validateSections(template, body) {
  if (body === null) return { ok: true, value: null };   // back to the default
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_sections', message: 'Sections must be an object.' };
  }
  const cat = template.sectionCatalogue;
  if (!cat) {
    return {
      ok: false,
      error: 'sections_not_supported',
      message: 'This template has a fixed structure.',
    };
  }

  const readTags = (v, name) => {
    if (v === undefined) return { ok: true, tags: null };
    if (!Array.isArray(v)) return { ok: false, error: 'invalid_sections', message: `${name} must be an array of section tags.` };
    const tags = [];
    for (const raw of v) {
      const tag = typeof raw === 'string' ? raw.trim() : '';
      if (!cat.SECTION_BY_TAG.has(tag)) {
        return { ok: false, error: 'unknown_section', message: `This template has no section named ${String(raw).slice(0, 80)}.` };
      }
      if (!tags.includes(tag)) tags.push(tag);
    }
    return { ok: true, tags };
  };

  const selected = readTags(body.selected, 'selected');
  if (!selected.ok) return selected;
  const order = readTags(body.order, 'order');
  if (!order.ok) return order;

  if (selected.tags) {
    for (const required of cat.REQUIRED_SECTION_TAGS) {
      if (!selected.tags.includes(required)) {
        const meta = cat.SECTION_BY_TAG.get(required);
        return {
          ok: false,
          error: 'required_section',
          message: `${meta ? meta.label : required} is a required section and cannot be removed.`,
        };
      }
    }
  }

  // Clinician-created sections. Ids are server-minted: a client may echo an
  // id it was previously given (so the section stays the same section), but
  // may not invent one.
  let custom = [];
  if (body.custom !== undefined) {
    if (!Array.isArray(body.custom)) {
      return { ok: false, error: 'invalid_sections', message: 'custom must be an array.' };
    }
    if (body.custom.length > cat.MAX_CUSTOM_SECTIONS) {
      return {
        ok: false,
        error: 'too_many_sections',
        message: `A document may carry at most ${cat.MAX_CUSTOM_SECTIONS} custom sections.`,
      };
    }
    for (const raw of body.custom) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'invalid_sections', message: 'Each custom section must be an object.' };
      }
      const title = str(raw.title, cat.MAX_CUSTOM_TITLE_CHARS);
      if (!title) {
        return { ok: false, error: 'invalid_sections', message: 'A custom section needs a title.' };
      }
      if (raw.id !== undefined && raw.id !== null && !isUuid(raw.id)) {
        return { ok: false, error: 'invalid_sections', message: 'Unrecognised custom section id.' };
      }
      const level = raw.level === undefined || raw.level === null ? null : Number(raw.level);
      if (level !== null && ![1, 2, 3].includes(level)) {
        return { ok: false, error: 'invalid_sections', message: 'Heading level must be 1, 2 or 3.' };
      }
      custom.push({
        id: raw.id || crypto.randomUUID(),
        title,
        guidance: str(raw.guidance, cat.MAX_CUSTOM_GUIDANCE_CHARS) || null,
        level,
      });
    }
  }

  // Heading-level overrides for the master's own sections.
  let levels = {};
  if (body.levels !== undefined) {
    if (!body.levels || typeof body.levels !== 'object' || Array.isArray(body.levels)) {
      return { ok: false, error: 'invalid_sections', message: 'levels must be an object of section → level.' };
    }
    for (const [tag, raw] of Object.entries(body.levels)) {
      if (!cat.SECTION_BY_TAG.has(tag)) {
        return { ok: false, error: 'unknown_section', message: `This template has no section named ${tag.slice(0, 80)}.` };
      }
      if (raw === null) continue;               // back to the master's own level
      const level = Number(raw);
      if (![1, 2, 3].includes(level)) {
        return { ok: false, error: 'invalid_sections', message: 'Heading level must be 1, 2 or 3.' };
      }
      levels[tag] = level;
    }
  }

  // A field the client did not send stays null here; the PATCH handler keeps
  // the stored value for it, so saving a heading level cannot silently reset
  // the section selection (and vice versa).
  return {
    ok: true,
    value: {
      selected: selected.tags,
      order: order.tags,
      custom: body.custom !== undefined ? custom : null,
      levels: body.levels !== undefined ? levels : null,
    },
  };
}

// ── Catalogue ────────────────────────────────────────────────────────────────

router.get('/api/templates', requireTemplateRead, safe(async (req, res) => {
  res.json({ templates: catalogue.listTemplates() });
}));

router.get('/api/templates/:templateId/fields', requireTemplateRead, safe(async (req, res) => {
  const template = catalogue.getTemplate(req.params.templateId);
  if (!template) return res.status(404).json({ error: 'not_found' });
  res.json({
    template: {
      id: template.id, name: template.name, version: template.version,
      description: template.description,
    },
    groups: catalogue.fieldSpec(template),
  });
}));

// ── Clients (the same reader every generated document uses) ──────────────────

router.get('/api/templates/clients', requireTemplateRead, safe(async (req, res) => {
  let clients;
  try {
    clients = await searchClients(orgOf(req), req.query.q);
  } catch (err) {
    log.warn('splose client list unavailable', { error: err.cause || err.message });
    return sploseDown(res);
  }
  res.json({ clients });
}));

// ── Document instances ───────────────────────────────────────────────────────

router.post('/api/templates/documents', requireTemplateWrite, safe(async (req, res) => {
  const template = catalogue.getTemplate(req.body?.templateId);
  if (!template) return res.status(400).json({ error: 'unknown_template' });

  const title = str(req.body?.title, MAX_TITLE_CHARS) || template.name;

  // A client is optional: a template may be completed without binding to one,
  // and in that case no client data is read at all.
  const clientId = str(req.body?.clientId, 100) || null;
  if (clientId) {
    let client;
    try {
      client = await loadSploseClient(clientId);
    } catch (err) {
      if (err.sploseFailure) return sploseDown(res);
      throw err;
    }
    if (!client) return res.status(404).json({ error: 'not_found' });
  }

  const { rows } = await pool.query(
    `INSERT INTO template_documents
       (organisation_id, created_by_user_id, template_id, template_version, title, splose_client_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [orgOf(req), req.user.id, template.id, template.version, title, clientId]
  );

  await audit(req, 'template.document_created', rows[0].id, {
    templateId: template.id, templateVersion: template.version, clientBound: Boolean(clientId),
  });

  try {
    res.status(201).json({ document: serialiseDocument(await loadState(req, rows[0])) });
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }
}));

router.get('/api/templates/documents', requireTemplateRead, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, template_id, template_version, title, splose_client_id, created_at, updated_at
       FROM template_documents
      WHERE organisation_id = $1 AND created_by_user_id = $2
      ORDER BY updated_at DESC
      LIMIT ${MAX_DOCUMENTS_LISTED}`,
    [orgOf(req), req.user.id]
  );
  res.json({
    documents: rows.map((r) => {
      const t = catalogue.getTemplate(r.template_id);
      return {
        id: r.id,
        templateId: r.template_id,
        templateName: t ? t.name : r.template_id,
        templateVersion: r.template_version,
        title: r.title,
        clientId: r.splose_client_id || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }),
  });
}));

router.get('/api/templates/documents/:id', requireTemplateRead, safe(async (req, res) => {
  const row = await loadOwnDocument(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  try {
    res.json({ document: serialiseDocument(await loadState(req, row)) });
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }
}));

/**
 * Save this document's own answers.
 *
 * Only tags the MASTER declares are accepted; anything else is refused rather
 * than stored, so a caller cannot write arbitrary content into a document
 * through a key the template never had. A blank value DELETES the entry, which
 * returns the field to whatever the portal resolves — clearing an override is
 * how a user goes back to the authoritative value.
 */
router.patch('/api/templates/documents/:id', requireTemplateWrite, safe(async (req, res) => {
  const row = await loadOwnDocument(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const template = catalogue.getTemplate(row.template_id);
  if (!template) return res.status(404).json({ error: 'not_found' });

  const next = { ...(row.field_values || {}) };

  if (req.body?.fieldValues !== undefined) {
    const incoming = req.body.fieldValues;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'invalid_field_values' });
    }
    const unknown = Object.keys(incoming).filter((t) => !template.catalogue.SCALAR_BY_TAG.has(t));
    if (unknown.length) {
      return res.status(400).json({
        error: 'unknown_field',
        message: `This template has no field named ${unknown[0]}.`,
      });
    }
    for (const [tag, raw] of Object.entries(incoming)) {
      const value = str(raw, MAX_FIELD_CHARS);
      if (value === '') delete next[tag];
      else next[tag] = value;
    }
  }

  const title = req.body?.title !== undefined
    ? (str(req.body.title, MAX_TITLE_CHARS) || row.title)
    : row.title;

  // Section structure, only for templates that offer one (the FCA). The
  // stored value is re-normalised on every compose, so even a value written
  // past this validation could not remove a required section — this check
  // exists to tell the user, not to be the only guard.
  let sections = row.sections || null;
  if (req.body?.sections !== undefined) {
    const checked = validateSections(template, req.body.sections);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error, message: checked.message });
    }
    if (checked.value === null) {
      sections = null;                            // back to the master's default
    } else {
      // Field-wise merge: an omitted field keeps what the document already
      // holds, so one panel's save cannot reset another's.
      const prior = (row.sections && typeof row.sections === 'object') ? row.sections : {};
      const allTags = template.sectionCatalogue.SECTIONS.map((s) => s.tag);
      sections = {
        selected: checked.value.selected ?? prior.selected ?? allTags,
        order: checked.value.order ?? prior.order ?? allTags,
        custom: checked.value.custom ?? prior.custom ?? [],
        levels: checked.value.levels ?? prior.levels ?? {},
      };
    }
  }

  // Write ONLY the columns this request carried. Two saves can overlap — the
  // debounced field autosave and a section change land on separate
  // connections — and a full-row rewrite would let whichever commits last
  // revert the other's column from its stale read. Column-scoped SETs make
  // overlapping single-column saves commute.
  const sets = ['updated_at = NOW()'];
  const params = [row.id];
  if (req.body?.fieldValues !== undefined) {
    params.push(JSON.stringify(next));
    sets.push(`field_values = $${params.length}::jsonb`);
  }
  if (req.body?.title !== undefined) {
    params.push(title);
    sets.push(`title = $${params.length}`);
  }
  if (req.body?.sections !== undefined) {
    params.push(sections === null ? null : JSON.stringify(sections));
    sets.push(`sections = $${params.length}::jsonb`);
  }

  const { rows } = await pool.query(
    `UPDATE template_documents
        SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *`,
    params
  );

  await audit(req, 'template.document_updated', row.id, {
    templateId: row.template_id,
    fieldsHeld: Object.keys(next).length,
    sectionsShaped: sections !== null,
  });

  try {
    res.json({ document: serialiseDocument(await loadState(req, rows[0])) });
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }
}));

router.delete('/api/templates/documents/:id', requireTemplateWrite, safe(async (req, res) => {
  const row = await loadOwnDocument(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  await pool.query('DELETE FROM template_documents WHERE id = $1', [row.id]);
  await audit(req, 'template.document_deleted', row.id, { templateId: row.template_id });
  res.json({ ok: true });
}));

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * The live preview: the composed, still-portal-bound .docx, rendered in the
 * browser by the vendored docx-preview. Nothing is stored — the bytes are
 * composed on demand and streamed, so there is no preview artefact holding
 * client data to expire, leak or clean up.
 *
 * This is the IN-PORTAL document, so it legitimately still carries the
 * master's own prompts for anything outstanding. The export boundary is what
 * removes them, and it runs only on the export routes below.
 */
router.get('/api/templates/documents/:id/preview.docx', requireTemplateRead, safe(async (req, res) => {
  const row = await loadOwnDocument(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let buffer;
  try {
    const state = await loadState(req, row);
    buffer = await paginateForPreview(await composePortalDocx(state));
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }

  res.setHeader('Content-Type', DOCX_MIME);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', 'inline; filename="preview.docx"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(buffer);
}));

// ── Export: the boundary ─────────────────────────────────────────────────────

async function sendExport(req, res, format) {
  const row = await loadOwnDocument(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let out;
  try {
    out = await exportDocument(await loadState(req, row), format);
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    if (err.exportBoundaryBreach) {
      // The document could not be proven free of portal bindings, so it is not
      // sent. Failing the download is the correct outcome: an export that still
      // depends on Opal, or that carries Opal's field names, is the one thing
      // this capability must never produce.
      log.error('template export boundary breach', {
        documentId: row.id, templateId: row.template_id, problems: err.problems,
      });
      return res.status(500).json({
        error: 'export_failed',
        message: 'This document could not be prepared for download. Please contact support.',
      });
    }
    throw err;
  }

  await audit(req, 'template.document_exported', row.id, {
    templateId: row.template_id, format, unfinishedFields: out.unfinished.length,
  });

  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Length', String(out.buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(out.buffer);
}

router.get('/api/templates/documents/:id/export.docx', requireTemplateRead,
  safe((req, res) => sendExport(req, res, 'docx')));

router.get('/api/templates/documents/:id/export.pdf', requireTemplateRead,
  safe((req, res) => sendExport(req, res, 'pdf')));

module.exports = router;
