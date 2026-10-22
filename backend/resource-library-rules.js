'use strict';

/**
 * THE LIBRARY'S RULES, WITHOUT A DATABASE.
 *
 * Pure functions the library routes and the recycle-bin job share, kept here
 * so each rule is unit-tested once and the routes cannot drift from it:
 *
 *   validateFolderName   what a folder may be called (and why not)
 *   wouldCreateCycle     whether moving a folder would put it inside itself
 *   suffixedName         "Report (2).pdf" for Keep both
 *   purgeDue / daysLeft  the recycle bin's 90-day clock
 */

/** How long a deleted item waits in the recycle bin before it is purged. */
const RECYCLE_BIN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const FOLDER_NAME_MAX = 80;

/**
 * Letters (any script), digits, spaces and the punctuation people actually
 * use in folder names: & - _ ( ) ' ’ . , +
 * Slashes are refused outright — a slash in a name reads as a path.
 */
const FOLDER_NAME_CHARS = /^[\p{L}\p{N} &\-_()'’.,+]+$/u;

/**
 * Check a proposed folder name.
 *
 * @returns {{ok:true, name:string} | {ok:false, code:string, error:string}}
 *   `name` is the trimmed, whitespace-collapsed form to store. Each refusal
 *   says which rule failed, so a person is never left guessing.
 */
function validateFolderName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, code: 'folder_name_empty', error: 'Give the folder a name.' };
  if (name.length > FOLDER_NAME_MAX) {
    return { ok: false, code: 'folder_name_too_long', error: `Folder names can be up to ${FOLDER_NAME_MAX} characters.` };
  }
  if (/[\\/]/.test(name)) {
    return { ok: false, code: 'folder_name_slash', error: 'Folder names cannot contain a slash.' };
  }
  if (name.startsWith('.') || name.endsWith('.')) {
    return { ok: false, code: 'folder_name_dot', error: 'Folder names cannot start or end with a full stop.' };
  }
  if (!FOLDER_NAME_CHARS.test(name)) {
    return {
      ok: false,
      code: 'folder_name_characters',
      error: 'Use letters, numbers, spaces and & - _ ( ) \' . , + in folder names.',
    };
  }
  return { ok: true, name };
}

/** The comparison key for "the same name" — case-insensitive, trimmed. */
function nameKey(name) {
  return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Would making `newParentId` the parent of `folderId` create a cycle?
 *
 * True when the new parent is the folder itself or any of its descendants.
 * `parentOf` maps a folder id to its parent id (null/undefined at the top).
 * The walk is bounded, so corrupt data that already loops cannot hang it.
 */
function wouldCreateCycle(folderId, newParentId, parentOf) {
  if (!newParentId) return false;
  if (String(newParentId) === String(folderId)) return true;
  const get = typeof parentOf === 'function' ? parentOf
    : (id) => (parentOf instanceof Map ? parentOf.get(id) : (parentOf || {})[id]);
  let cursor = newParentId;
  const seen = new Set();
  while (cursor) {
    const key = String(cursor);
    if (key === String(folderId)) return true;
    if (seen.has(key)) return true; // already a loop — refuse rather than add to it
    seen.add(key);
    if (seen.size > 10000) return true;
    cursor = get(cursor);
  }
  return false;
}

/**
 * The first free "Name (n).ext" for Keep both.
 *
 * `taken` is any iterable of names already in the folder; comparison is
 * case-insensitive. "Report.pdf" → "Report (2).pdf"; "Report (2).pdf" taken
 * too → "Report (3).pdf". A name with no extension gets the suffix at the end.
 */
function suffixedName(fileName, taken) {
  const takenKeys = new Set([...(taken || [])].map(nameKey));
  const name = String(fileName || '').trim();
  if (!takenKeys.has(nameKey(name))) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  // "Report (2)" keeps counting from 2 rather than becoming "Report (2) (2)".
  const m = stem.match(/^(.*) \((\d+)\)$/);
  const base = m ? m[1] : stem;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!takenKeys.has(nameKey(candidate))) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** Is an item deleted at `deletedAt` due for purging at `now`? */
function purgeDue(deletedAt, now = new Date(), days = RECYCLE_BIN_DAYS) {
  if (!deletedAt) return false;
  const t = new Date(deletedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return new Date(now).getTime() - t >= days * DAY_MS;
}

/** Whole days an item has left in the bin (0 when it is due). */
function daysLeft(deletedAt, now = new Date(), days = RECYCLE_BIN_DAYS) {
  if (!deletedAt) return days;
  const t = new Date(deletedAt).getTime();
  if (!Number.isFinite(t)) return days;
  const left = Math.ceil((t + days * DAY_MS - new Date(now).getTime()) / DAY_MS);
  return Math.max(0, left);
}

module.exports = {
  RECYCLE_BIN_DAYS,
  FOLDER_NAME_MAX,
  validateFolderName,
  nameKey,
  wouldCreateCycle,
  suffixedName,
  purgeDue,
  daysLeft,
};
