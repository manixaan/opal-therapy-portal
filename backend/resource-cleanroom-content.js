'use strict';

/**
 * Content specifications for the clean-room Opal originals.
 *
 * Each was written from the clinical purpose recorded in resource-cleanroom-plan
 * and ordinary professional knowledge of what such a document must contain. No
 * source document was opened, so no sentence, table, field order or layout here
 * derives from National 360, National OT or The OT Inner Circle material.
 *
 * Every document carries the same two things: plain-language instructions for
 * the clinician using it, and an explicit statement of what it does not do.
 * The second matters more than it looks — a template that does not say "this is
 * not an assessment" gets used as one.
 *
 * All are drafts. None is clinically reviewed. The `footer` says so on the page
 * itself, because a document separated from the portal loses every other signal.
 */

const DRAFT_FOOTER = 'Opal Therapy draft, version 0.1. Not clinically reviewed and not approved for '
  + 'client use. Review and adapt for the individual before use.';

const AT_LIMITATIONS = [
  'This letter records clinical reasoning. It is not an assessment report and does not replace one.',
  'Assistive technology recommendations must follow a functional assessment and, where indicated, a trial.',
  'Confirm current NDIA evidence requirements before submitting — they change, and this template does not track them.',
  'Quotations and supplier details are the participant\'s or plan manager\'s to obtain.',
];

const CLEANROOM_DOCUMENTS = [
  // ── Assistive technology letters ─────────────────────────────────────────
  {
    catalogueId: 'res-0517', slug: 'at-mid-cost-letter-funded',
    title: 'Mid-cost assistive technology — evidence letter (funding already in plan)',
    category: 'assistive-technology',
    subtitle: 'Use when the participant\'s plan already holds sufficient assistive technology funding and '
      + 'the item does not require a separate request.',
    sections: [
      { heading: 'Before you start',
        guidance: 'Delete this section before sending.',
        paragraphs: [
          'This letter records why a specific item is the right one, so the reasoning is on file if the '
            + 'purchase is later queried. Because funding is already available, you are documenting a '
            + 'decision rather than making a request.',
          'Write for a reader who does not know the participant. Avoid abbreviations and describe function '
            + 'in terms of everyday activities.',
        ] },
      { heading: 'Participant and plan details',
        fields: [
          { label: 'Participant name and NDIS number', lines: 1 },
          { label: 'Plan dates and the support budget the item will be funded from', lines: 2 },
          { label: 'Prescribing therapist, AHPRA registration and contact details', lines: 2 },
        ] },
      { heading: 'The item',
        fields: [
          { label: 'Item, model and approximate cost', lines: 2 },
          { label: 'Supplier (if already identified)', lines: 1 },
        ] },
      { heading: 'Functional need',
        guidance: 'Describe what the participant cannot currently do, not what they have been diagnosed with.',
        fields: [
          { label: 'What the participant is trying to do, and what makes it difficult now', lines: 4 },
          { label: 'Current supports or equipment, and why they are no longer sufficient', lines: 3 },
        ] },
      { heading: 'Why this item',
        fields: [
          { label: 'How this item changes the activity described above', lines: 4 },
          { label: 'Options considered and why they were not chosen', lines: 3 },
          { label: 'Trial undertaken, outcome and date (or why a trial was not required)', lines: 3 },
        ] },
      { heading: 'Risk if not provided',
        fields: [{ label: 'Consequences of continuing without this item', lines: 3 }] },
      { heading: 'Setup, training and review',
        table: { headers: ['What', 'Who', 'When'],
          rows: [['Delivery and set-up', '', ''], ['Participant or carer training', '', ''],
            ['Review of effectiveness', '', ''], ['Maintenance or replacement', '', '']] } },
    ],
    limitations: AT_LIMITATIONS,
  },
  {
    catalogueId: 'res-0518', slug: 'at-mid-cost-letter-request',
    title: 'Mid-cost assistive technology — funding request',
    category: 'assistive-technology',
    subtitle: 'Use when the participant\'s plan does not hold sufficient funding and you are asking the '
      + 'NDIA to include it.',
    sections: [
      { heading: 'Before you start',
        guidance: 'Delete this section before sending.',
        paragraphs: [
          'This letter asks for funding that does not yet exist in the plan, so it must stand on its own. '
            + 'The reader will decide from this document alone.',
          'Address reasonable and necessary explicitly. A request that describes need but never connects it '
            + 'to the participant\'s goals is the most common reason for a request being returned.',
        ] },
      { heading: 'Participant and plan details',
        fields: [
          { label: 'Participant name and NDIS number', lines: 1 },
          { label: 'Plan dates and current relevant budget', lines: 2 },
          { label: 'Prescribing therapist, AHPRA registration and contact details', lines: 2 },
        ] },
      { heading: 'What is being requested',
        fields: [
          { label: 'Item, model, quantity and quoted cost', lines: 2 },
          { label: 'Any associated set-up, delivery or training cost', lines: 2 },
        ] },
      { heading: 'Participant goals this supports',
        guidance: 'Quote the goal from the participant\'s plan wherever possible.',
        fields: [{ label: 'Plan goal, and how this item contributes to it', lines: 4 }] },
      { heading: 'Functional need and current barrier',
        fields: [
          { label: 'What the participant is unable to do safely or independently now', lines: 4 },
          { label: 'Frequency and duration of the difficulty', lines: 2 },
          { label: 'Who currently provides support, and how much', lines: 3 },
        ] },
      { heading: 'Reasonable and necessary',
        guidance: 'Address each point. Leaving one blank invites a request for more information.',
        table: { headers: ['Criterion', 'How this request meets it'],
          rows: [['Related to the disability', ''], ['Represents value for money', ''],
            ['Likely to be effective and beneficial', ''],
            ['Takes account of informal supports', ''],
            ['Not more appropriately funded by another system', '']] } },
      { heading: 'Alternatives and trial',
        fields: [
          { label: 'Options considered, including lower-cost options, and why they were not suitable', lines: 4 },
          { label: 'Trial undertaken, outcome and date', lines: 3 },
        ] },
      { heading: 'Risk if not funded',
        fields: [{ label: 'Foreseeable consequences, including any escalation in support needs or cost', lines: 4 }] },
    ],
    limitations: AT_LIMITATIONS.concat([
      'Value-for-money reasoning should reference the quoted cost against the expected duration of use.',
    ]),
  },
  {
    catalogueId: 'res-0520', slug: 'at-low-cost-letter',
    title: 'Low-cost assistive technology — record of recommendation',
    category: 'assistive-technology',
    subtitle: 'A short record for low-cost items, where a full evidence letter would be disproportionate.',
    sections: [
      { heading: 'How to use this',
        guidance: 'Delete before sending.',
        paragraphs: [
          'Low-cost items usually do not require NDIA approval, but the clinical reasoning should still be '
            + 'recorded. Keep this to one page.',
          'If the item costs more than the low-cost threshold, or needs a trial, use the mid-cost letter '
            + 'instead. Confirm the current threshold — it is set by the NDIA and changes.',
        ] },
      { heading: 'Details',
        fields: [
          { label: 'Participant name and NDIS number', lines: 1 },
          { label: 'Item and approximate cost', lines: 1 },
          { label: 'Recommending therapist and contact details', lines: 2 },
        ] },
      { heading: 'Reasoning',
        fields: [
          { label: 'Activity the participant is trying to do, and the current barrier', lines: 3 },
          { label: 'How the item helps', lines: 3 },
          { label: 'Any safety considerations or instructions for use', lines: 3 },
        ] },
      { heading: 'Review',
        fields: [{ label: 'When effectiveness will be reviewed, and by whom', lines: 2 }] },
    ],
    limitations: [
      'For low-cost items only. Confirm the current NDIA low-cost threshold before relying on this.',
      'Not a substitute for assessment where the item carries a safety risk — for example anything used '
        + 'for transfers, mobility or feeding.',
    ],
  },

  // ── Manual handling ──────────────────────────────────────────────────────
  {
    catalogueId: 'res-0521', slug: 'manual-handling-plan',
    title: 'Manual handling plan',
    category: 'assistive-technology',
    subtitle: 'Records how one participant is to be moved and supported, so every worker does it the same '
      + 'way.',
    sections: [
      { heading: 'How to use this plan',
        guidance: 'Keep this section — support workers read it.',
        paragraphs: [
          'This plan is specific to one person. Do not apply it to anyone else, and do not use it after the '
            + 'review date without a reassessment.',
          'If the participant\'s presentation differs from what is described here — more fatigue, more pain, '
            + 'reduced alertness, a new injury — stop and seek advice before transferring.',
        ] },
      { heading: 'Participant and plan control',
        fields: [
          { label: 'Participant name and date of birth', lines: 1 },
          { label: 'Assessing therapist, AHPRA registration and contact details', lines: 2 },
          { label: 'Date written  /  Review date', lines: 1 },
        ] },
      { heading: 'Relevant presentation',
        guidance: 'Only what affects handling. This is not a full clinical history.',
        fields: [
          { label: 'Weight-bearing status, strength and balance', lines: 3 },
          { label: 'Communication, comprehension and ability to follow instructions', lines: 3 },
          { label: 'Pain, fatigue, skin integrity, spasticity or other factors that vary through the day', lines: 3 },
          { label: 'Behaviours of concern relevant to close physical contact', lines: 3 },
        ] },
      { heading: 'Transfers',
        guidance: 'Complete one row per transfer the participant regularly needs.',
        table: { headers: ['Transfer', 'Method', 'Equipment', 'Workers'],
          rows: [['Bed to chair', '', '', ''], ['Chair to toilet', '', '', ''],
            ['Chair to vehicle', '', '', ''], ['Floor recovery after a fall', '', '', ''],
            ['', '', '', '']] } },
      { heading: 'Equipment',
        fields: [
          { label: 'Equipment in use, including sling type and size where applicable', lines: 3 },
          { label: 'Checks required before each use', lines: 2 },
          { label: 'Servicing schedule and who is responsible', lines: 2 },
        ] },
      { heading: 'Risks and controls',
        table: { headers: ['Risk', 'Control', 'Who acts'],
          rows: [['', '', ''], ['', '', ''], ['', '', '']] } },
      { heading: 'What to do if something goes wrong',
        fields: [
          { label: 'If the participant becomes unsafe mid-transfer', lines: 3 },
          { label: 'After a fall — immediate actions and who to notify', lines: 3 },
          { label: 'Incident reporting requirements', lines: 2 },
        ] },
      { heading: 'Acknowledgement',
        guidance: 'Every worker who supports this participant signs before providing support.',
        table: { headers: ['Worker name', 'Role', 'Date read'],
          rows: [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']] } },
    ],
    limitations: [
      'Specific to one participant at one point in time. It is not transferable and expires at the review date.',
      'Does not replace the employer\'s manual handling training or workplace health and safety obligations.',
      'Written by an occupational therapist. Where a physiotherapist has prescribed a transfer method, theirs '
        + 'takes precedence.',
      'Must be signed off by the assessing clinician before use.',
    ],
  },

  // ── Housing ──────────────────────────────────────────────────────────────
  {
    catalogueId: 'res-0522', slug: 'sda-sole-occupancy-evidence',
    title: 'Specialist disability accommodation — sole occupancy evidence',
    category: 'housing',
    subtitle: 'Sets out why a shared SDA arrangement would not meet this participant\'s needs.',
    sections: [
      { heading: 'Before you start',
        guidance: 'Delete before sending.',
        paragraphs: [
          'Sole occupancy is an exception. The reader starts from the position that shared accommodation is '
            + 'the default, so the document must show why sharing fails for this person specifically — not '
            + 'that they would prefer to live alone.',
          'Evidence carries more weight than assertion. Where a claim rests on documented history, say so '
            + 'and reference it.',
        ] },
      { heading: 'Participant details',
        fields: [
          { label: 'Participant name and NDIS number', lines: 1 },
          { label: 'Current living arrangement and how long it has been in place', lines: 3 },
          { label: 'Assessing therapist and contact details', lines: 2 },
        ] },
      { heading: 'Why a shared arrangement is not suitable',
        guidance: 'Address only the grounds that apply. Do not pad.',
        fields: [
          { label: 'Risk to other residents, with documented history where available', lines: 4 },
          { label: 'Risk to the participant arising from proximity to others', lines: 4 },
          { label: 'Sensory or environmental needs incompatible with shared living', lines: 3 },
          { label: 'Support model incompatibility — for example overnight support patterns', lines: 3 },
        ] },
      { heading: 'What has been tried',
        fields: [
          { label: 'Previous shared arrangements and their outcomes', lines: 4 },
          { label: 'Adjustments attempted and why they were not sufficient', lines: 3 },
        ] },
      { heading: 'Supporting evidence',
        table: { headers: ['Evidence', 'Author', 'Date'],
          rows: [['', '', ''], ['', '', ''], ['', '', '']] } },
      { heading: 'Design requirements',
        fields: [{ label: 'Features the dwelling must have, and the functional reason for each', lines: 4 }] },
    ],
    limitations: [
      'Evidence only. It does not determine eligibility — the NDIA does.',
      'Confirm the current SDA rules and design standards before submitting; both are periodically revised.',
      'Where behaviour support is involved, the behaviour support practitioner should contribute rather than '
        + 'the OT summarising their view.',
    ],
  },
  {
    catalogueId: 'res-0604', slug: 'emergency-social-housing-letter',
    title: 'Emergency social housing — allied health support letter',
    category: 'housing',
    subtitle: 'Supports an urgent housing application by describing functional need and risk.',
    sections: [
      { heading: 'Before you start',
        guidance: 'Delete before sending.',
        paragraphs: [
          'Housing assessors are not clinicians. Describe consequences in concrete terms — what happens, how '
            + 'often, and what it leads to.',
          'Include only what supports the housing decision. A full clinical history is neither needed nor '
            + 'appropriate to disclose.',
        ] },
      { heading: 'Details',
        fields: [
          { label: 'Client name and date of birth', lines: 1 },
          { label: 'Current address or living situation', lines: 2 },
          { label: 'Author, role, AHPRA registration and contact details', lines: 2 },
          { label: 'How long you have worked with this client', lines: 1 },
        ] },
      { heading: 'Current housing and why it is unsuitable',
        fields: [
          { label: 'Physical barriers — access, bathroom, steps, and what they prevent', lines: 4 },
          { label: 'Safety concerns arising from the current housing', lines: 3 },
          { label: 'Effect on health, function or participation', lines: 3 },
        ] },
      { heading: 'Urgency',
        fields: [
          { label: 'What makes this urgent rather than ongoing', lines: 3 },
          { label: 'Foreseeable consequence if housing does not change', lines: 3 },
        ] },
      { heading: 'What suitable housing needs',
        guidance: 'Be specific and minimal. A long list reads as a wish list and weakens the request.',
        fields: [{ label: 'Essential features, each with its functional reason', lines: 4 }] },
      { heading: 'Consent',
        fields: [{ label: 'Confirm the client consented to this letter and to the information it discloses', lines: 2 }] },
    ],
    limitations: [
      'Supports an application. It does not establish eligibility or priority.',
      'Do not disclose diagnoses or history beyond what the housing decision requires.',
      'Client consent must be obtained and recorded before sending.',
    ],
  },

  // ── Correspondence and team ──────────────────────────────────────────────
  {
    catalogueId: 'res-0613', slug: 'general-letter-template',
    title: 'General correspondence template',
    category: 'practice',
    subtitle: 'For correspondence that does not fit the portal\'s generated FCA report or progress note '
      + 'letter workflows.',
    sections: [
      { heading: 'When to use this',
        guidance: 'Delete before sending.',
        paragraphs: [
          'The portal already generates FCA reports and progress note letters from governed templates. Use '
            + 'those where they apply — they carry document control this template does not.',
          'This is for everything else: a referral, a short update to a GP, a response to a service '
            + 'coordinator.',
        ] },
      { heading: 'Letter',
        fields: [
          { label: 'Date', lines: 1 },
          { label: 'Recipient name, role and organisation', lines: 2 },
          { label: 'Subject', lines: 1 },
          { label: 'Client name and identifier', lines: 1 },
          { label: 'Body', lines: 10 },
          { label: 'Author name, role, AHPRA registration and contact details', lines: 3 },
        ] },
      { heading: 'Before sending',
        guidance: 'A short check that prevents the two commonest problems.',
        paragraphs: [
          'Confirm the client consented to this disclosure, and that the recipient is entitled to receive it.',
          'Confirm only necessary information is included. Clinical detail beyond the recipient\'s need is a '
            + 'privacy issue, not thoroughness.',
        ] },
    ],
    limitations: [
      'Not document-controlled. Anything that will be relied on as a clinical record should go through the '
        + 'portal\'s generated letter workflow instead.',
      'Check consent and disclosure scope before sending.',
    ],
  },
  {
    catalogueId: 'res-0623', slug: 'mdt-information-gathering',
    title: 'Multidisciplinary team — information gathering',
    category: 'practice',
    subtitle: 'Collects each discipline\'s current picture before a team discussion, so the meeting starts '
      + 'from shared information.',
    sections: [
      { heading: 'How to use this',
        paragraphs: [
          'Send to each contributing discipline at least a week before the meeting. Short answers are fine — '
            + 'the purpose is to surface disagreement and gaps early, not to produce reports.',
          'Where disciplines disagree, record both views rather than reconciling them in advance. The '
            + 'disagreement is usually the most useful thing in the meeting.',
        ] },
      { heading: 'Meeting details',
        fields: [
          { label: 'Participant name and identifier', lines: 1 },
          { label: 'Meeting date and purpose', lines: 2 },
          { label: 'Who is contributing, and their discipline', lines: 3 },
        ] },
      { heading: 'Each discipline completes',
        fields: [
          { label: 'Your current goals with this participant', lines: 3 },
          { label: 'What is working', lines: 3 },
          { label: 'What is not working, or has changed recently', lines: 3 },
          { label: 'Risks you are holding', lines: 3 },
          { label: 'What you need from the rest of the team', lines: 3 },
        ] },
      { heading: 'Consolidated view',
        guidance: 'Completed by the coordinator before the meeting.',
        table: { headers: ['Theme', 'Disciplines agreeing', 'Disagreement or gap'],
          rows: [['', '', ''], ['', '', ''], ['', '', '']] } },
      { heading: 'Participant and family input',
        guidance: 'Required. A team view assembled without it is incomplete.',
        fields: [
          { label: 'What the participant says matters most right now', lines: 3 },
          { label: 'Family or carer perspective, where they are involved', lines: 3 },
        ] },
    ],
    limitations: [
      'Preparation only. It is not a case note, an assessment or a care plan.',
      'Each discipline remains responsible for its own clinical decisions and documentation.',
      'Confirm consent for information sharing between services before circulating.',
    ],
  },

  // ── Paediatrics ──────────────────────────────────────────────────────────
  {
    catalogueId: 'res-0628', slug: 'paediatric-initial-interview',
    title: 'Paediatric initial interview',
    category: 'paediatrics',
    subtitle: 'Structures a first conversation with a family about their child\'s participation, routines '
      + 'and priorities.',
    sections: [
      { heading: 'How to use this',
        guidance: 'Keep this section — it changes how the conversation goes.',
        paragraphs: [
          'This is a conversation guide, not a questionnaire. Follow what the family raises rather than '
            + 'working down the page, and stop when you have enough.',
          'Ask about ordinary days. "Tell me about a school morning" surfaces more than asking whether the '
            + 'child has difficulty with dressing.',
          'The child\'s own view belongs here wherever they can give it, in whatever way they communicate.',
        ] },
      { heading: 'Who is here',
        fields: [
          { label: 'Child\'s name, date of birth and preferred name', lines: 1 },
          { label: 'Who is attending and their relationship to the child', lines: 2 },
          { label: 'Languages spoken at home, and whether an interpreter is needed', lines: 2 },
          { label: 'Referrer and reason for referral', lines: 2 },
        ] },
      { heading: 'What matters to the family',
        guidance: 'Ask first, before any history taking. It sets the priorities for everything after.',
        fields: [
          { label: 'What made you seek help now?', lines: 3 },
          { label: 'If therapy went well, what would be different in six months?', lines: 3 },
        ] },
      { heading: 'The child\'s view',
        fields: [
          { label: 'What the child enjoys, and what they find hard', lines: 3 },
          { label: 'How the child communicates preferences and distress', lines: 3 },
        ] },
      { heading: 'A day in the life',
        table: { headers: ['Part of the day', 'What happens', 'What is hard'],
          rows: [['Waking and dressing', '', ''], ['Meals', '', ''],
            ['School or early learning', '', ''], ['Play and free time', '', ''],
            ['Bath and bedtime', '', '']] } },
      { heading: 'Background',
        guidance: 'Only what is relevant. Families often repeat this to every new service; check the file first.',
        fields: [
          { label: 'Pregnancy, birth and early development, if relevant', lines: 3 },
          { label: 'Medical history, diagnoses, medication and allergies', lines: 3 },
          { label: 'Other services currently involved', lines: 3 },
        ] },
      { heading: 'Environments',
        fields: [
          { label: 'Home setup and who lives there', lines: 3 },
          { label: 'Education setting, supports in place, and how it is going', lines: 3 },
          { label: 'Community activities the child takes part in, or would like to', lines: 3 },
        ] },
      { heading: 'Next steps',
        fields: [
          { label: 'Agreed focus for assessment', lines: 3 },
          { label: 'Consent discussed, including information sharing', lines: 2 },
          { label: 'What the family will hear next, and when', lines: 2 },
        ] },
    ],
    limitations: [
      'An intake conversation, not an assessment. It does not measure anything and supports no diagnosis.',
      'Adapt for the family\'s language, culture and communication needs. Use an interpreter where needed '
        + 'rather than a family member.',
      'Where there is any child safety concern, follow Opal\'s Child Safe Practice Policy immediately — do '
        + 'not defer it to the end of the interview.',
    ],
  },

  // ── Self-care ────────────────────────────────────────────────────────────
  {
    catalogueId: 'res-0501', slug: 'oral-hygiene-support',
    title: 'Supporting daily oral care',
    category: 'self-care',
    subtitle: 'Plain-language guidance for supporting someone who needs help with tooth brushing and mouth '
      + 'care.',
    sections: [
      { heading: 'Why oral care matters',
        paragraphs: [
          'Poor oral health causes pain, tooth loss and difficulty eating. It can also make chest infections '
            + 'more likely in people who have trouble swallowing, because bacteria from the mouth reach the '
            + 'lungs.',
          'Oral care is often the first routine to be dropped when mornings are difficult. Keeping it '
            + 'going is usually easier than restarting it.',
        ] },
      { heading: 'Before you start',
        paragraphs: [
          'Ask the person how they want to be helped, and keep asking. Someone\'s mouth is a personal place '
            + 'and being helped there can feel confronting.',
          'If the person coughs, chokes or has difficulty swallowing, speak to a speech pathologist before '
            + 'using toothpaste or water in any quantity.',
        ] },
      { heading: 'Setting up',
        table: { headers: ['What to consider', 'Why it helps'],
          rows: [
            ['Sitting upright, well supported', 'Reduces the risk of swallowing water or toothpaste'],
            ['Good lighting, and a mirror if useful', 'You can see what you are doing'],
            ['Same time and place each day', 'A predictable routine needs less prompting'],
            ['Everything ready before starting', 'Keeps the routine short'],
          ] } },
      { heading: 'Equipment that can help',
        table: { headers: ['Equipment', 'When it helps'],
          rows: [
            ['Built-up or angled toothbrush handle', 'Reduced grip or wrist movement'],
            ['Electric toothbrush', 'Does the brushing motion; heavier, so not right for everyone'],
            ['Suction toothbrush', 'Where swallowing is unsafe — set up by a professional'],
            ['Non-foaming toothpaste', 'Where foam is distressing or hard to manage'],
            ['Mouth prop', 'Where the person cannot hold their mouth open; needs training first'],
          ] } },
      { heading: 'A routine that usually works',
        paragraphs: [
          'Twice a day, morning and before bed. The night one matters most, because saliva reduces overnight.',
          'Brush all surfaces of every tooth and along the gum line, using small circles, for about two '
            + 'minutes. Then brush the tongue gently.',
          'Spit out, do not rinse — leaving a little toothpaste keeps fluoride working.',
          'For dentures: clean daily with a denture brush, and leave them out overnight unless advised '
            + 'otherwise.',
        ] },
      { heading: 'If it is not going well',
        table: { headers: ['What you notice', 'What to try'],
          rows: [
            ['Refusing or turning away', 'Try a different time of day; brush alongside them rather than to them'],
            ['Sensitive to touch, taste or sound', 'Softer brush, non-foaming paste, manual instead of electric'],
            ['Forgets the steps', 'Break into single steps with a picture prompt; hand-over-hand if welcomed'],
            ['Bleeding gums', 'Keep brushing gently and arrange a dental review — bleeding usually means gum inflammation'],
            ['Pain, swelling or a broken tooth', 'Dental review promptly; do not manage this at home'],
          ] } },
      { heading: 'Plan',
        fields: [
          { label: 'Who supports oral care, and when', lines: 2 },
          { label: 'Equipment being used', lines: 2 },
          { label: 'What to do if it is refused', lines: 3 },
          { label: 'Dental appointments — last and next', lines: 2 },
        ] },
    ],
    limitations: [
      'General guidance. It is not a substitute for dental assessment and does not diagnose anything.',
      'Where swallowing is unsafe, a speech pathologist must advise before oral care is changed.',
      'Pain, bleeding that does not settle, swelling or a broken tooth need a dentist, not a changed routine.',
      'Adapt to the individual before use.',
    ],
  },
];

module.exports = { CLEANROOM_DOCUMENTS, DRAFT_FOOTER };
