/**
 * SYNC UTILITIES
 *
 * Shared helpers used by both routes.js and server.js so classifyEventType
 * does not have to be duplicated or cross-required across circular dependencies.
 */

/**
 * Map an Outlook category label to the app's event_type enum
 * ('therapy', 'leave', 'cpd', 'travel', 'admin', 'lunch', 'meeting',
 * 'teams_meeting', 'report', 'outlook'). The mapping is forgiving
 * (substring + case-insensitive) so users' real Outlook category names
 * (e.g. "Therapy Session", "MDT Meeting") still classify correctly.
 * Returns 'outlook' as the safe default so uncategorised events are
 * clearly distinguishable from app-created events.
 */
function classifyEventType(categories = [], isTeams = false) {
  if (isTeams) return 'teams_meeting';
  if (!Array.isArray(categories) || categories.length === 0) return 'outlook';

  const blob = categories.join('|').toLowerCase();

  // Opal Therapy exact category names (checked first)
  if (/client\s*appointment/.test(blob))  return 'therapy';      // face-to-face, full rate, needs location
  if (/case\s*management/.test(blob))     return 'report';       // billable, full rate, no location needed
  if (/report\s*writing/.test(blob))      return 'report';       // billable, full rate, no location needed
  if (/travel/.test(blob))               return 'travel';        // billable, half rate
  if (/admin/.test(blob))                return 'admin';         // non-billable
  if (/business\s*related/.test(blob))   return 'admin';         // non-billable
  if (/cancellation/.test(blob))         return 'admin';         // non-billable
  if (/do\s*not\s*book/.test(blob))      return 'admin';         // non-billable block
  if (/\bpd\b|professional\s*dev/.test(blob)) return 'cpd';      // non-billable CPD
  if (/meeting/.test(blob))              return 'meeting';       // non-billable

  // Generic fallbacks
  if (/leave|holiday|annual|sick|ooo/.test(blob)) return 'leave';
  if (/lunch|break/.test(blob))          return 'lunch';
  if (/therapy|session|assessment|initial/.test(blob)) return 'therapy';
  return 'outlook';
}

module.exports = { classifyEventType };
