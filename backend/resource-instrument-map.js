'use strict';

/**
 * Maps the catalogue's 38 controlled-instrument records onto distinct
 * instruments in the controlled register.
 *
 * ONE INSTRUMENT, MANY FILES
 * The catalogue counts files; the register counts instruments. Four COPM files
 * (booklet, rating scales, record forms, a template) are one instrument. Two
 * MoCA files (2017 instructions, 2020 test) are one instrument in two editions.
 * A proxy and a self-report WHODAS form are one instrument administered two
 * ways. Registering each file separately would inflate the register and, worse,
 * imply Opal holds four COPM licences instead of none.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * No file is uploaded for any of these. The register holds the instrument's
 * identity, publisher and licence position — never its forms, manual, items or
 * scoring rules. Several of these instruments are commercially licensed and
 * copying their content into the portal would be an infringement regardless of
 * how the file arrived in the vault.
 *
 * RIGHTS ARE NOT ASSERTED, ONLY BOUNDED
 * `rights_status` is 'restricted' where the instrument is well known to be
 * commercially published or to require certification, and 'unreviewed'
 * everywhere else. Neither value grants anything. 'restricted' is a ceiling
 * applied on conservative grounds, not a licensing determination — the brief
 * forbids inventing those, and confirming each publisher's actual terms is
 * human work that has not been done.
 */

/**
 * New register entries. Instruments already in the register (COPM, MoCA,
 * MOHOST, RUDAS, Sensory Profile, WHODAS 2.0 36-item) are absent by design —
 * they are mapped, not recreated.
 */
const NEW_INSTRUMENTS = [
  { key: 'modified-interest-checklist', abbreviation: 'MIC', name: 'Modified Interest Checklist',
    rightsHolder: 'Model of Human Occupation Clearinghouse, University of Illinois Chicago',
    rights: 'unreviewed',
    notes: 'MOHO-family checklist. The Clearinghouse distributes some instruments without charge and others '
      + 'under licence; which applies here has not been confirmed.' },

  { key: 'alsfrs-r', abbreviation: 'ALSFRS-R', name: 'ALS Functional Rating Scale — Revised',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Two catalogued files (a guide and the scale). Widely reproduced in the literature, which is not '
      + 'the same as permission to redistribute.' },

  { key: 'berg-balance-scale', abbreviation: 'BBS', name: 'Berg Balance Scale',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Commonly used clinically; publisher and reuse terms not confirmed.' },

  { key: 'braden-scale', abbreviation: 'Braden', name: 'Braden Scale for Predicting Pressure Sore Risk',
    rightsHolder: 'Prevention Plus (Barbara Braden and Nancy Bergstrom)', rights: 'restricted',
    notes: 'Copyright is asserted by the authors and permission is normally required for reproduction. Two '
      + 'catalogued copies, one a Word document.' },

  { key: 'carer-burden-scale', abbreviation: 'Carer Burden', name: 'Carer Burden Scale',
    rightsHolder: 'Not identified', rights: 'unreviewed',
    notes: 'The catalogue itself flags the publisher as unverified. Several distinct instruments share this '
      + 'name — identify which one before any use.' },

  { key: 'fim', abbreviation: 'FIM', name: 'Functional Independence Measure',
    rightsHolder: 'Uniform Data System for Medical Rehabilitation', rights: 'restricted',
    notes: 'Commercially licensed and requires credentialed administration. Do not reproduce the scoring '
      + 'tool.' },

  { key: 'falls-efficacy-scale', abbreviation: 'FES', name: 'Falls Efficacy Scale',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Multiple versions exist (original, FES-I, Short FES-I). The catalogued edition is not identified.' },

  { key: 'lawton-iadl', abbreviation: 'Lawton IADL', name: 'Lawton Instrumental Activities of Daily Living Scale',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Widely reproduced; permission terms not confirmed.' },

  { key: 'waterlow-score', abbreviation: 'Waterlow', name: 'Waterlow Pressure Ulcer Risk Assessment',
    rightsHolder: 'Judy Waterlow', rights: 'unreviewed',
    notes: 'Distributed by the author with conditions. Confirm before any reproduction.' },

  { key: 'kica', abbreviation: 'KICA', name: 'Kimberley Indigenous Cognitive Assessment',
    rightsHolder: 'University of Western Australia / WA Centre for Health and Ageing', rights: 'restricted',
    notes: 'Culturally specific instrument developed with and for Aboriginal communities. Use carries '
      + 'cultural-safety obligations as well as licensing ones; both need confirming.' },

  { key: 'zarit-burden-interview', abbreviation: 'ZBI', name: 'Zarit Burden Interview',
    rightsHolder: 'Mapi Research Trust', rights: 'restricted',
    notes: 'Distribution is administered by Mapi Research Trust and normally requires registration.' },

  { key: 'care-and-needs-scale', abbreviation: 'CANS', name: 'Care and Needs Scale',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Catalogued copy is a 2017 form. Confirm the current version before use.' },

  { key: 'dass-42', abbreviation: 'DASS-42', name: 'Depression Anxiety Stress Scales (42-item)',
    rightsHolder: 'Psychology Foundation of Australia / UNSW', rights: 'unreviewed',
    notes: 'The DASS is made freely available for research and clinical use by the authors, but that '
      + 'permission has not been confirmed against a current source for this edition.' },

  { key: 'fast-unidentified', abbreviation: 'FAST', name: 'FAST (instrument not yet identified)',
    rightsHolder: 'Not identified', rights: 'unreviewed',
    notes: 'The catalogue flags the publisher and version as unverified. "FAST" names several unrelated '
      + 'instruments (Functional Assessment Staging Tool; a stroke recognition tool; an alcohol screening '
      + 'test). Two catalogued files. Identify the instrument before any use.' },

  { key: 'honos', abbreviation: 'HoNOS', name: 'Health of the Nation Outcome Scales',
    rightsHolder: 'Royal College of Psychiatrists', rights: 'restricted',
    notes: 'Licensed by the Royal College of Psychiatrists; training is normally required.' },

  { key: 'mmse', abbreviation: 'MMSE', name: 'Mini-Mental State Examination',
    rightsHolder: 'Psychological Assessment Resources (PAR)', rights: 'restricted',
    notes: 'Copyright is actively enforced by PAR and per-use purchase is normally required. Do not '
      + 'reproduce.' },

  { key: 'modified-barthel-index', abbreviation: 'MBI', name: 'Modified Barthel Index',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Several modified versions exist; the catalogued edition is not identified.' },

  { key: 'pcans-2', abbreviation: 'PCANS-2', name: 'Paediatric Care and Needs Scale (version 2)',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Catalogued copy is "Form D". Confirm publisher and current version.' },

  { key: 'whodas-2.0-child-youth', abbreviation: 'WHODAS 2.0 C&Y',
    name: 'WHO Disability Assessment Schedule 2.0 — Child and Youth',
    rightsHolder: 'World Health Organization', rights: 'unreviewed',
    notes: 'A DISTINCT instrument from the adult 36-item WHODAS already registered, not another edition of '
      + 'it. WHO requires registration for WHODAS use; that registration has not been confirmed.' },

  { key: 'fatigue-severity-scale', abbreviation: 'FSS', name: 'Fatigue Severity Scale',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'The catalogued file also contains the Epworth Sleepiness Scale, which is separately licensed by '
      + 'its author. Two instruments in one document — separate them before any use.' },

  { key: 'life-skills-profile-16', abbreviation: 'LSP-16', name: 'Life Skills Profile-16',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Used in Australian mental health outcome reporting; reuse terms not confirmed.' },

  { key: 'pomodatt', abbreviation: 'POMODATT',
    name: 'Performance and Outcome Measure of Driving and Assistive Technology Training',
    rightsHolder: 'Not confirmed', rights: 'unreviewed',
    notes: 'Two catalogued files (forms and manual) — one instrument. A manual is the most licence-sensitive '
      + 'part of an instrument and must not be hosted.' },
];

/**
 * Every one of the 38 catalogue records → the instrument it belongs to.
 * Keys not in NEW_INSTRUMENTS refer to entries already in the register.
 */
const RECORD_TO_INSTRUMENT = {
  'res-0071': 'modified-interest-checklist',
  'res-0504': 'alsfrs-r',
  'res-0505': 'alsfrs-r',
  'res-0508': 'berg-balance-scale',
  'res-0509': 'braden-scale',
  'res-0617': 'braden-scale',
  'res-0510': 'carer-burden-scale',
  'res-0513': 'fim',
  'res-0514': 'falls-efficacy-scale',
  'res-0524': 'lawton-iadl',
  'res-0534': 'waterlow-score',
  'res-0588': 'kica',
  'res-0591': 'zarit-burden-interview',
  // Adolescent/Adult Sensory Profile — an edition within the registered
  // Sensory Profile family, not a separate register entry.
  'res-0592': 'sensory-profile',
  'res-0593': 'sensory-profile',
  'res-0595': 'copm',
  'res-0596': 'copm',
  'res-0597': 'copm',
  'res-0598': 'copm',
  'res-0600': 'care-and-needs-scale',
  'res-0603': 'dass-42',
  'res-0605': 'fast-unidentified',
  'res-0606': 'fast-unidentified',
  'res-0608': 'honos',
  'res-0615': 'mmse',
  'res-0616': 'mohost',
  'res-0618': 'moca',
  'res-0619': 'moca',
  'res-0620': 'modified-barthel-index',
  'res-0627': 'pcans-2',
  'res-0630': 'rudas',
  // Proxy and self-report administrations of one registered instrument.
  'res-0637': 'whodas-2.0-36',
  'res-0638': 'whodas-2.0-36',
  // Child and Youth is a different instrument, so it gets its own entry.
  'res-0636': 'whodas-2.0-child-youth',
  'res-0644': 'fatigue-severity-scale',
  'res-0646': 'life-skills-profile-16',
  'res-0647': 'pomodatt',
  'res-0648': 'pomodatt',
};

/** Instrument keys expected to exist already. Used to assert no duplicates. */
const PRE_EXISTING_KEYS = ['copm', 'moca', 'mohost', 'rudas', 'sensory-profile', 'whodas-2.0-36'];

module.exports = { NEW_INSTRUMENTS, RECORD_TO_INSTRUMENT, PRE_EXISTING_KEYS };
