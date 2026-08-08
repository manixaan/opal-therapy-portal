'use strict';

/**
 * R2 CONTENT — NDIS KNOWLEDGE + CLINICAL GUIDES
 *
 * NDIS resources always point to the official source and never hard-code
 * dollar amounts. Clinical guides are first-pass internal drafts: practical,
 * person-centred, strengths-based, free of proprietary assessment content
 * and free of funding guarantees.
 *
 * Plain data module. No database access. Australian English. No emojis.
 */

const VERIFIED_LINE =
  'Information current as verified on 8 August 2026. Always check the linked official source where a current regulatory or funding decision is required.';

const CLINICAL_LINE =
  'This guide supports clinical reasoning at Opal Therapy. It does not replace professional judgement, supervision, jurisdiction-specific requirements or current official guidance, and it is never a guarantee of any funding outcome.';

// ── External source registry ────────────────────────────────────────────────

const externalSources = [
  {
    key: 'ndis-code-of-conduct',
    name: 'NDIS Code of Conduct',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndis-commission.gov.au/about/ndis-code-conduct',
    authority: 'official_regulatory',
  },
  {
    key: 'ndis-practice-standards',
    name: 'NDIS Practice Standards',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndis-commission.gov.au/rules-and-standards/ndis-practice-standards',
    authority: 'official_regulatory',
  },
  {
    key: 'ndis-worker-orientation',
    name: 'NDIS Worker Orientation Module',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndis-commission.gov.au/workers/training-course',
    authority: 'official_regulatory',
  },
  {
    key: 'ndis-practice-alerts',
    name: 'NDIS Commission Practice Alerts',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndis-commission.gov.au/resources',
    authority: 'official_regulatory',
  },
  {
    key: 'ndis-pricing-arrangements',
    name: 'NDIS Pricing Arrangements and Price Limits',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/pricing-arrangements',
    authority: 'official_regulatory',
    effectiveDate: '2026-07-01',
  },
  {
    key: 'ndis-support-catalogue',
    name: 'NDIS Support Catalogue 2026-27',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/pricing-arrangements',
    authority: 'official_regulatory',
    effectiveDate: '2026-07-01',
  },
  {
    key: 'ndis-would-we-fund-it',
    name: 'Would We Fund It (NDIA guidance)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/understanding/supports-funded-ndis/would-we-fund-it',
    authority: 'official_regulatory',
  },
  {
    key: 'ndis-supports-funded',
    name: 'Supports funded by the NDIS',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/understanding/supports-funded-ndis',
    authority: 'official_regulatory',
  },
  {
    key: 'ndis-provider-pack',
    name: 'NDIS Provider resources',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers',
    authority: 'official_regulatory',
  },
  {
    key: 'ahpra-code-of-conduct',
    name: 'Code of conduct (shared code)',
    publisher: 'Ahpra and the National Boards',
    url: 'https://www.ahpra.gov.au/Resources/Code-of-conduct.aspx',
    authority: 'official_regulatory',
    effectiveDate: '2022-06-29',
  },
  {
    key: 'ahpra-register',
    name: 'Register of practitioners',
    publisher: 'Ahpra',
    url: 'https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx',
    authority: 'official_regulatory',
  },
  {
    key: 'otboard-competencies',
    name: 'Australian occupational therapy competency standards 2018',
    publisher: 'Occupational Therapy Board of Australia',
    url: 'https://www.occupationaltherapyboard.gov.au/Codes-Guidelines/Competencies.aspx',
    authority: 'official_regulatory',
    effectiveDate: '2019-01-01',
  },
  {
    key: 'otboard-cpd-standard',
    name: 'Registration standard: Continuing professional development',
    publisher: 'Occupational Therapy Board of Australia',
    url: 'https://www.occupationaltherapyboard.gov.au/Registration-Standards.aspx',
    authority: 'official_regulatory',
  },
  {
    key: 'otboard-pii-standard',
    name: 'Registration standard: Professional indemnity insurance arrangements',
    publisher: 'Occupational Therapy Board of Australia',
    url: 'https://www.occupationaltherapyboard.gov.au/Registration-Standards.aspx',
    authority: 'official_regulatory',
  },
  {
    key: 'otaus',
    name: 'Occupational Therapy Australia',
    publisher: 'Occupational Therapy Australia',
    url: 'https://otaus.com.au',
    authority: 'professional_body',
  },
];

// ── NDIS resources (§12) ────────────────────────────────────────────────────

const ndis = [
  {
    slug: 'ndis-code-of-conduct',
    title: 'NDIS Code of Conduct — Summary',
    description: 'What the Code requires of every provider and worker, registered or not.',
    contentType: 'ndis_guide',
    authority: 'official_regulatory',
    minutes: 6,
    sourcePublisher: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'NDIS Code of Conduct',
    externalUrl: 'https://www.ndis-commission.gov.au/about/ndis-code-conduct',
    sources: ['ndis-code-of-conduct'],
    content: `# NDIS Code of Conduct — Summary

The NDIS Code of Conduct applies to **all** providers and workers delivering NDIS supports — registered and unregistered alike. There is no exemption for small providers, sole traders or subcontractors: if you deliver NDIS supports, the Code binds you personally, and it binds Opal as a provider.

## What the Code requires

In delivering supports, providers and workers must:

1. **Act with respect for individual rights** — to freedom of expression, self-determination and decision-making, in accordance with relevant laws and conventions.
2. **Respect privacy** of people with disability.
3. **Provide supports safely and competently**, with care and skill.
4. **Act with integrity, honesty and transparency.**
5. **Promptly raise and act on concerns** about matters that may affect the quality and safety of supports.
6. **Take all reasonable steps to prevent and respond to violence, exploitation, neglect and abuse** of people with disability.
7. **Take all reasonable steps to prevent and respond to sexual misconduct.**

## How this lands at Opal

- The Code is the floor, not the ceiling. Opal's policy suite (privacy, consent, boundaries, incident management, child safety) is how these obligations become daily behaviour.
- Element 5 is personal: seeing a quality or safety concern and staying silent is itself a breach. Use the Clinical Escalation Pathway and the Incident Management Policy.
- The NDIS Commission can act on Code breaches by workers directly, including banning orders. Registration status does not shield anyone.

## Complaints

Participants can complain about supports to the NDIS Commission at any time, and we tell them so plainly — see the Complaints and Feedback Policy.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-practice-standards',
    title: 'NDIS Practice Standards — What They Are and How Opal Uses Them',
    description: 'The standards for registered providers, used at Opal as an internal quality benchmark.',
    contentType: 'ndis_guide',
    authority: 'official_regulatory',
    minutes: 6,
    sourcePublisher: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'NDIS Practice Standards',
    externalUrl: 'https://www.ndis-commission.gov.au/rules-and-standards/ndis-practice-standards',
    sources: ['ndis-practice-standards'],
    content: `# NDIS Practice Standards — What They Are and How Opal Uses Them

## Who they formally apply to

The NDIS Practice Standards **formally apply to registered NDIS providers** — they are the benchmark against which registered providers are audited. Nothing in this resource implies that Opal Therapy is a registered NDIS provider; registration status is a matter of fact confirmed by the practice owner, and obligations that turn on it require verification: Requires legal/regulatory verification.

## Why we read them anyway

Opal chooses to use the Practice Standards as an **internal quality benchmark**. They are a well-constructed description of what good, safe service provision looks like, and holding ourselves against a standard we are not compelled to meet is cheap insurance and honest practice.

## The shape of the Standards

The core module covers four broad areas:

1. **Rights and responsibilities** — person-centred supports, individual values and beliefs, privacy and dignity, independence and informed choice, freedom from violence, abuse, neglect, exploitation and discrimination.
2. **Governance and operational management** — governance arrangements, risk and incident management, complaints, human resources, continuity of supports.
3. **Provision of supports** — access, planning, service agreements, responsive support provision, transitions.
4. **Support provision environment** — safe environment, participant money and property, management of medication and waste where relevant.

Supplementary modules address higher-risk supports (for example specialist behaviour support and high-intensity daily personal activities) that sit outside Opal's current scope.

## Using them at Opal

- When reviewing a policy or process, ask: would this satisfy the corresponding Practice Standard outcome? If not, why not?
- Quality gaps identified against the Standards go into the same review loop as incidents and complaints.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-support-catalogue-2026-27',
    title: 'NDIS Support Catalogue 2026-27',
    description: 'The official catalogue of support items, effective 1 July 2026.',
    contentType: 'external_link',
    authority: 'official_regulatory',
    minutes: 3,
    sourcePublisher: 'National Disability Insurance Agency',
    sourceTitle: 'NDIS Support Catalogue 2026-27',
    externalUrl: 'https://www.ndis.gov.au/providers/pricing-arrangements',
    sourceEffective: '2026-07-01',
    sources: ['ndis-support-catalogue'],
    content: `# NDIS Support Catalogue 2026-27

The Support Catalogue is the NDIA's official machine-readable list of support items: item numbers, names, registration groups, units and applicable price limits. The 2026-27 catalogue took effect on 1 July 2026.

## When to use it

- Confirming the exact support item number and unit for claiming or quoting.
- Checking whether an item exists for a service you are describing in a report or service agreement.
- Verifying which price limit applies (national, remote, very remote) for an item.

## How to use it

Always download the current catalogue from the NDIA pricing arrangements page rather than working from a saved copy — items are added, ended and re-priced within a year. The catalogue is the companion to the Pricing Arrangements and Price Limits document; the two are read together.

No dollar figures are reproduced in this resource deliberately: the catalogue itself is the only current answer to any pricing question.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-pricing-arrangements-2026-27',
    title: 'NDIS Pricing Arrangements and Price Limits (from 1 July 2026)',
    description: 'The official pricing rules for NDIS supports — the source of truth for all price questions.',
    contentType: 'external_link',
    authority: 'official_regulatory',
    minutes: 3,
    sourcePublisher: 'National Disability Insurance Agency',
    sourceTitle: 'NDIS Pricing Arrangements and Price Limits 2026-27',
    externalUrl: 'https://www.ndis.gov.au/providers/pricing-arrangements',
    sourceEffective: '2026-07-01',
    sources: ['ndis-pricing-arrangements'],
    content: `# NDIS Pricing Arrangements and Price Limits (from 1 July 2026)

The Pricing Arrangements and Price Limits (PAPL) document is the NDIA's official statement of pricing rules: price limits, claiming rules, travel and non-face-to-face provisions, cancellation rules and definitions. The current edition took effect on 1 July 2026.

## The one rule at Opal

**No pricing question is ever answered from memory or from an internal document.** Every dollar figure, percentage and rule is checked against the current PAPL at the linked source at the time the answer matters. This resource intentionally contains no dollar amounts, because any amount written here would eventually be wrong.

## What the PAPL governs

- Maximum prices for price-limited supports, including therapy supports.
- Geographic loadings for remote and very remote delivery.
- Claiming rules: provider travel, non-face-to-face supports, report writing, short-notice cancellations.
- Definitions that agreements and claims depend on.

For a plain-language orientation to these concepts (without numbers), read the Pricing and Claiming Quick Guide in this hub — then check the PAPL for the current figures.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-pricing-claiming-quick-guide',
    title: 'NDIS Pricing and Claiming — Quick Guide',
    description: 'The concepts behind NDIS pricing and claiming, with every number left to the official source.',
    contentType: 'ndis_guide',
    authority: 'internal',
    minutes: 8,
    sources: ['ndis-pricing-arrangements', 'ndis-support-catalogue'],
    externalUrl: 'https://www.ndis.gov.au/providers/pricing-arrangements',
    sourcePublisher: 'National Disability Insurance Agency',
    sourceTitle: 'NDIS Pricing Arrangements and Price Limits 2026-27',
    content: `# NDIS Pricing and Claiming — Quick Guide

This guide explains the **concepts** you need to reason about pricing and claiming. It deliberately contains no dollar amounts, rates or percentages: every numeric question is answered by one action — **check the current NDIS Pricing Arrangements and Price Limits at the linked source.**

## Support item

Services are claimed against support items — coded entries in the Support Catalogue with a defined unit (usually an hour for therapy). The item number determines the applicable rules and price limit. Check current price: see the linked source.

## Unit and price limit

A price limit is the maximum claimable per unit for price-limited supports. Charging below the limit is always permitted. What the limit currently is for any item: check current price at the linked source.

## National, remote and very remote prices

Price limits vary by geography. Delivery in areas classified remote or very remote attracts higher limits, recognising the real cost of distance. Which classification applies is determined by the NDIA's geography tooling, and the current loadings are in the PAPL. Check current price: see the linked source.

## Non-face-to-face supports

Time spent on a participant's supports without the participant present (for example, preparing tailored materials) can be claimable when it meets the PAPL's conditions — directly related to the participant, agreed, and delivering value against their goals. The conditions and any limits: check the current PAPL.

## Provider travel

Travel time to deliver supports can be claimable within rules covering when travel may be claimed, how it is apportioned across participants on a circuit, and caps that differ by geography. Rural circuits make apportionment genuinely important — plan claims when planning the circuit. Current rules and caps: check the current PAPL.

## Report writing

Assessment and report time is claimable within the rules for the relevant items. What can be claimed, under which item, and any conditions: check the current PAPL.

## Short-notice cancellations

The PAPL defines when a cancellation is short notice and what may be claimed. Definitions and claimable proportions have changed over the years — never quote them from memory. Check the current PAPL, and ensure service agreements match it.

## The habit that keeps us honest

Before any conversation involving money — quoting, service agreements, plan reviews, family questions — open the current PAPL and catalogue. "Let me confirm the current figure" is a professional answer; a remembered number is a liability.

${VERIFIED_LINE}`,
  },
  {
    slug: 'what-are-ndis-supports',
    title: 'What Are NDIS Supports?',
    description: 'How the NDIS frames fundable supports, and how to reason about appropriateness.',
    contentType: 'ndis_guide',
    authority: 'internal',
    minutes: 6,
    sources: ['ndis-supports-funded'],
    externalUrl: 'https://www.ndis.gov.au/understanding/supports-funded-ndis',
    sourcePublisher: 'National Disability Insurance Agency',
    sourceTitle: 'Supports funded by the NDIS',
    content: `# What Are NDIS Supports?

Understanding how the NDIS frames fundable supports helps us write recommendations that are honest, useful and well-reasoned. This article orients; it is **not a substitute for NDIA guidance**, and it is never a promise about any individual funding decision.

## The frame

NDIS funding is for supports that relate to a participant's disability and help them pursue their goals — supports that are, in the scheme's language, reasonable and necessary. Funding decisions weigh whether a support:

- relates to the participant's disability support needs;
- represents value for money relative to alternatives;
- is likely to be effective and beneficial, having regard to good practice;
- takes account of what it is reasonable for families, communities and other services (health, education) to provide.

## Plan circumstances matter

The same support can be appropriate for one participant and not another — or appropriate this year and not next. Funding follows the individual plan: the participant's goals, current supports, evidence and circumstances. This is why our reports argue from **this person's** function and goals, never from "the NDIS funds X".

## What this means for our writing

1. **Recommend against goals, not categories.** Connect every recommendation to the participant's stated goals and demonstrated functional need.
2. **Show the reasoning.** Value for money and effectiveness are arguments to make, not boxes to assert — comparisons and expected outcomes belong in the report.
3. **Mind the boundaries.** Supports more appropriately provided by health, education or family responsibility sit outside the scheme; acknowledging boundaries honestly strengthens credibility.
4. **Never guarantee.** Decisions belong to the NDIA delegate. We provide evidence and reasoning; we do not promise outcomes, in writing or in conversation.

For the NDIA's own guidance and current lists of what the scheme does and does not fund, use the linked official source.

${VERIFIED_LINE}`,
  },
  {
    slug: 'would-we-fund-it',
    title: 'Would We Fund It? — Using the NDIA Guidance',
    description: 'How to use the NDIA worked examples when reasoning about supports.',
    contentType: 'ndis_guide',
    authority: 'internal',
    minutes: 5,
    sources: ['ndis-would-we-fund-it'],
    externalUrl: 'https://www.ndis.gov.au/understanding/supports-funded-ndis/would-we-fund-it',
    sourcePublisher: 'National Disability Insurance Agency',
    sourceTitle: 'Would we fund it',
    content: `# Would We Fund It? — Using the NDIA Guidance

The NDIA publishes "Would we fund it" guidance: worked examples showing how funding criteria apply to real support types — equipment, therapies, everyday items and services. It is one of the most useful public windows into NDIA reasoning, and one of the most misused.

## What it is

Each example walks a support type through the funding considerations: relation to disability, effectiveness and good practice, value for money, and what falls to other systems or ordinary family life. Reading a handful of examples teaches the **shape** of the reasoning faster than any summary.

## What it is not

- **Not a promise.** An example showing a support being funded is never a guarantee for any individual participant — plan circumstances decide, case by case.
- **Not a prohibition.** An example showing a support declined does not make it unfundable for a participant whose circumstances differ materially.
- **Not a substitute for the current guidance.** Examples are updated; always read them live at the source, not from memory or screenshots.

## Using it well at Opal

1. Before recommending an unusual or contested support, read the nearest examples and note how the criteria were weighed.
2. Structure your written justification to answer the same considerations the examples answer — that is the reasoning a delegate applies.
3. Where an example appears to cut against your recommendation, address the difference in circumstances explicitly rather than hoping nobody notices.
4. In conversations with families, use the guidance to explain how decisions are made — while being clear the decision is the NDIA's, not ours.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-provider-pack',
    title: 'NDIS Provider Resources',
    description: 'The NDIA provider page: news, systems, guides and the provider toolkit.',
    contentType: 'external_link',
    authority: 'official_regulatory',
    minutes: 3,
    sourcePublisher: 'National Disability Insurance Agency',
    sourceTitle: 'NDIS provider resources',
    externalUrl: 'https://www.ndis.gov.au/providers',
    sources: ['ndis-provider-pack'],
    content: `# NDIS Provider Resources

The NDIA's provider page is the entry point for official provider-facing material: pricing announcements, system guides, provider news, and the toolkit documents that accompany scheme changes.

## When to check it

- At the start of each quarter, and whenever a pricing or scheme change is announced, for the current provider pack and guidance.
- When onboarding to or troubleshooting NDIA systems and portals.
- When a family or plan manager mentions a scheme change you have not heard of — verify at the source before responding.

Provider news published here is the official record of changes; social media summaries and forum posts are not.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-quality-practice-alerts',
    title: 'NDIS Commission Practice Alerts',
    description: 'The Commission alert series on high-risk practice issues — worth a standing subscription.',
    contentType: 'external_link',
    authority: 'official_regulatory',
    minutes: 3,
    sourcePublisher: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'Practice alerts and resources',
    externalUrl: 'https://www.ndis-commission.gov.au/resources',
    sources: ['ndis-practice-alerts'],
    content: `# NDIS Commission Practice Alerts

The NDIS Commission publishes practice alerts and related resources on high-risk issues observed across the sector — topics such as choking and mealtime management, medication safety, pressure injuries, and transitions between services. They distil incident learnings into short, practice-ready guidance.

## How Opal uses them

- Alerts relevant to our caseload (mealtime, pressure care, equipment safety) are reviewed when published and raised at the team meeting.
- Where an alert touches an active client, the treating therapist reviews the client's situation against it and documents the check.
- Alerts count as excellent CPD reading — log them with a reflection in your CPD tracker.

This resource is a pointer to the collection at the official source; individual alerts are always read there, in their current form.

${VERIFIED_LINE}`,
  },
  {
    slug: 'ndis-worker-orientation-module',
    title: 'NDIS Worker Orientation Module',
    description: 'The Commission online orientation for NDIS workers — part of Opal onboarding.',
    contentType: 'course',
    authority: 'official_regulatory',
    minutes: 5,
    cpdEligible: true,
    cpdHours: 1,
    sourcePublisher: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'Worker Orientation Module: Quality, Safety and You',
    externalUrl: 'https://www.ndis-commission.gov.au/workers/training-course',
    sources: ['ndis-worker-orientation'],
    content: `# NDIS Worker Orientation Module

The NDIS Commission's online Worker Orientation Module ("Quality, Safety and You") introduces the NDIS, the Code of Conduct, and what respectful, safe support provision looks like from the participant's perspective. It ends with a certificate of completion.

## Who completes it

Whether the module is legally mandatory for a given worker depends on the provider's registration status and applicable requirements: Requires legal/regulatory verification. **Opal treats it as an onboarding resource regardless** — it is free, well made, takes around 90 minutes, and sets a shared floor of understanding across every role, clinical and administrative.

## At Opal

1. Complete the module at the linked official source during your first weeks.
2. Save your completion certificate and upload it to your portal profile documents.
3. Log it in your CPD tracker with a brief reflection — it is CPD-eligible learning.

${VERIFIED_LINE}`,
  },
];

// ── Clinical guides — major (§19) ───────────────────────────────────────────

const clinicalMajor = [
  {
    slug: 'clinical-note-quality',
    title: 'Clinical Note Quality',
    description: 'What separates a defensible, useful clinical note from an adequate one.',
    contentType: 'clinical_guide',
    minutes: 10,
    content: `# Clinical Note Quality

A clinical note has three readers: the future you who must recall the episode, the colleague who may take over the care, and the external reader — participant, auditor, tribunal — who may one day weigh what you did. A quality note serves all three without being rewritten for any of them.

## The standard, restated

The Clinical Documentation Standard sets the floor: same-day writing, attribution, factual accuracy, completeness, respectful language, transparent corrections. This guide is about the craft above the floor.

## Specificity is the whole game

Compare:

> "Worked on fine motor skills. Good session."

> "Practised shoelace tying using the two-loop method introduced last session. Jai completed the sequence independently twice of five attempts (previously zero of five), losing the sequence at the crossover step. He stayed with the task eight minutes with one prompt to return. Mum observed the practice sequence and will support daily practice before school."

The second note takes ninety seconds longer and contains everything the first note only gestures at: intervention, dosage, measured response, the specific sticking point, family involvement and the between-session plan. Write the second note.

## Observation before interpretation

State what you saw, then what you make of it, and keep the two visibly separate: "Ella left the table four times during the twenty-minute task (observation). Her exits followed each new task demand, which is consistent with escape-motivated avoidance of fine motor demands (interpretation)." Interpretation without its observation base is opinion; observation without interpretation is a security camera. Notes need both, in that order.

## Person-first, strengths-honest

Person-first and strengths-based language is our standard, and it must remain honest. Recording strengths does not mean softening difficulties — a note that under-describes functional impact fails the participant at their next plan review. Describe difficulty plainly and respectfully: "Marcus requires full physical assistance for all transfers" is respectful; "Marcus is wheelchair-bound and unable to do transfers" is neither accurate nor respectful.

## Quotes carry weight

The participant's own words, marked as quotes, are among the most powerful content a note can hold — for goals ("I want to make my own lunch"), for risk ("some days I don't see the point"), and for consent conversations. Quote sparingly and exactly.

## Risk gets its own line

Every contact note answers the risk question, even when the answer is "no risk concerns observed this contact". A silent note is ambiguous forever; a one-line answer is evidence you looked.

## The plan makes the note actionable

End with what happens next: who does what, before when, and when the next contact is. A note without a plan ends an episode; a note with a plan continues one.

## Common failure modes

1. **The heroic reconstruction** — five notes written Friday afternoon for a week of sessions. Accuracy decays by the hour; write same-day.
2. **The template ghost** — headings completed with boilerplate that could describe any client. If a sentence could sit in any chart, it is not yet a clinical record.
3. **The advocacy note** — written to argue for funding rather than record events. Record honestly; argue in the report, from honest records.
4. **The euphemism spiral** — softening real difficulties until the record no longer supports the support needs it should evidence.

${CLINICAL_LINE}`,
  },
  {
    slug: 'writing-functional-impact',
    title: 'Writing Functional Impact',
    description: 'The chain from diagnosis to support requirement, with worked examples.',
    contentType: 'clinical_guide',
    minutes: 12,
    content: `# Writing Functional Impact

Reports fail most often at one point: the gap between a diagnosis and a support recommendation, crossed with a hand-wave. Functional impact writing is how that gap gets bridged with reasoning a reader can follow and a delegate can rely on.

## The chain

Every functional impact statement walks five links:

**Diagnosis → impairment → functional impact → participation consequence → support requirement**

- **Diagnosis** names the condition.
- **Impairment** names what the condition affects in this person — the specific body function or structure.
- **Functional impact** names what the impairment does to activity performance — observed and measured where possible.
- **Participation consequence** names what that costs the person in daily life: the roles, routines and settings affected.
- **Support requirement** names what is needed to close the gap, and why this support at this intensity.

A reader should be able to run a finger down the chain and never encounter a leap. If any link is missing, the recommendation is an assertion, not an argument.

## Worked example one — paediatric

> **Diagnosis:** Cerebral palsy (spastic diplegia, GMFCS III).
> **Impairment:** Increased lower-limb muscle tone and reduced selective motor control, with reduced standing balance.
> **Functional impact:** Ruby, aged 7, mobilises indoors with a posterior walker and requires adult assistance for all transfers to and from the floor. She fatigues after approximately 50 metres and cannot manage steps without full assistance. Observed across home and school visits in June 2026; consistent with parent and teacher report.
> **Participation consequence:** Ruby cannot move between her classroom and the library or playground without an adult, which excludes her from unstructured play with peers at recess — the setting where her class friendships are formed. At home she cannot get to the backyard independently.
> **Support requirement:** [The recommendation follows — equipment, environmental modification and therapy, each justified against exactly this picture, with intensity and expected outcome.]

Note what the example does: it measures (50 metres, all transfers), it locates evidence (settings, dates, informants), and its participation consequence is specific and human — recess friendships, the backyard — not "reduced community participation".

## Worked example two — adult

> **Diagnosis:** Schizophrenia, with a significant psychosocial disability.
> **Impairment:** Persistent difficulties with initiation, planning and sustained attention; symptom exacerbation under stress.
> **Functional impact:** Daniel, 34, can complete individual domestic tasks when prompted at each step, but does not initiate them: without prompting, meals are missed and washing accumulates for weeks. He managed two of six planned community outings independently during the assessment month, withdrawing when transport was disrupted. Reported by Daniel and his mother; consistent with observation across four home visits.
> **Participation consequence:** Daniel's tenancy is at risk — two property inspections have failed — and his stated goal of returning to part-time work is blocked less by skills than by the initiation and routine difficulties that also affect his home life.
> **Support requirement:** [Recommendation follows — support intensity and skill-building justified by the initiation picture specifically, with the tenancy and work goals as the outcome frame.]

Note the shape: capability with prompting versus without is the load-bearing distinction for psychosocial disability, and it is stated with numbers and sources, not adjectives.

## Habits that keep the writing honest

1. **Measure what you claim.** Distances, frequencies, prompt levels, durations. "Requires significant support" means nothing a delegate can weigh; "requires verbal prompting at each step of a four-step task" does.
2. **Best day and worst day.** Fluctuating conditions need both described, and the support requirement reasoned against the realistic range, not the best day a review meeting happens to see.
3. **Distinguish won't, can't and hasn't-had-the-chance.** Performance versus capacity versus opportunity — conflating them produces recommendations that miss.
4. **Anchor to the person's goals.** Participation consequences matter because they block this person's stated life, and the report should say so in their words where possible.

${CLINICAL_LINE}`,
  },
  {
    slug: 'fca-workflow',
    title: 'Functional Capacity Assessment Workflow',
    description: 'The twelve-step Opal workflow from referral to delivered FCA report.',
    contentType: 'clinical_guide',
    minutes: 12,
    content: `# Functional Capacity Assessment Workflow

A functional capacity assessment is Opal's most consequential document type: it shapes funding, supports and sometimes housing for years. This workflow makes the quality repeatable. Twelve steps, from referral to delivery.

## 1. Clarify the referral question

Before anything is booked: what decision will this report inform, who requested it, and what questions must it answer? An FCA written to the wrong question is wasted regardless of its quality. Record the purpose in the file.

## 2. Confirm scope, consent and logistics

Service agreement in place, fees and funding confirmed against current pricing (check the PAPL — never from memory), informed consent obtained per the Consent Policy, and settings planned: an FCA observed only in a clinic room describes a person who does not exist.

## 3. Gather and review existing information

Previous reports, current plan and goals, school or workplace input, other providers' findings — with consent. List what you relied on; the report will cite it. Do not re-assess what is current and credible elsewhere.

## 4. Plan the assessment battery

Choose domains and tools against the referral question: standardised measures where they add defensible structure, skilled observation where tools cannot reach. Check licensing and your competence for each tool (see the Assessment Tool Directory). Plan for fatigue and fluctuation — multiple shorter sessions beat one heroic one.

## 5. Interview the participant and key informants

The person's own account of their days, goals and frustrations comes first — in their words, quoted where powerful. Informants (family, teachers, support workers) fill the times of day and settings you will never see. Ask for the worst day, not just the shown day.

## 6. Observe function in real settings

The heart of the FCA: watch actual task performance where life happens — the kitchen, the bathroom doorway, the classroom, the bus stop. Record prompt levels, time taken, fatigue effects, safety events and what the person does when something goes wrong.

## 7. Administer standardised assessment

Deliver planned tools to standard, note any deviations and their effect on interpretation. Scores support the functional picture; they never replace it.

## 8. Synthesise: build the functional impact chains

For each relevant domain, run the chain from Writing Functional Impact: diagnosis → impairment → functional impact → participation consequence → support requirement. Reconcile conflicts between sources honestly — naming a discrepancy strengthens the report.

## 9. Draft the report

Use the FCA Report Skeleton. Person-first opening the participant would recognise, transparent sources, findings by domain, the functional impact summary carrying the argument, and recommendations that are numbered, specific and justified (see Clinical Recommendations). No funding guarantees, anywhere.

## 10. Review the draft against the checklist

Self-review, then practice review per the report workflow: does every recommendation trace to findings? Are measurements present? Would the participant recognise and could they read their own report? Is any AI-drafted text fully verified (Responsible AI Policy)?

## 11. Feed back to the participant

Walk the participant (and chosen supports) through the findings before finalising. Corrections of fact are gold; disagreements with interpretation are recorded respectfully. Surprising a family with a report they first see at a plan meeting is a process failure.

## 12. Finalise, deliver and file

Final proof, sign, deliver through approved channels to consented recipients, file with the assessment records, and book any agreed review point. Log the time honestly against the correct items — checking current claiming rules at the source.

${CLINICAL_LINE}`,
  },
  {
    slug: 'goal-writing',
    title: 'Goal Writing',
    description: 'NDIS participant goals versus therapy goals, and how to write both well.',
    contentType: 'clinical_guide',
    minutes: 9,
    content: `# Goal Writing

Two kinds of goals live in our work, and most goal-writing confusion comes from blending them.

## Participant goals are the person's

NDIS participant goals belong to the participant — they are life directions, written in the person's own voice, often broad: "I want to make friends at school." "I want to live in my own place." We do not write these for people; we help people articulate them, and we treat them as the fixed stars therapy navigates by. They are not required to be measurable, and making them clinical strips them of ownership.

## Therapy goals are ours, built underneath

Therapy goals are the clinical machinery we construct under a participant goal: specific, measurable, time-bound changes in function that move the person toward their goal. One participant goal usually spawns several therapy goals in sequence.

> **Participant goal:** "I want to make my own lunch." (Amara, 12)
> **Therapy goal 1:** Within 8 weeks, Amara will prepare a cold lunch (sandwich, fruit, drink) with supervision only, using the visual sequence, on 4 of 5 school mornings.
> **Therapy goal 2:** Within 16 weeks, Amara will prepare the same lunch independently, with the visual sequence available, on 4 of 5 mornings.

## What a good therapy goal contains

1. **The person and the occupation** — a real activity in a real setting, not a body function. "Improve fine motor skills" is not a goal; it is a hope with no address.
2. **The support level** — independence is not the only worthy endpoint; "with supervision only" or "with setup assistance" are honest, meaningful targets.
3. **A measure** — frequency, prompt level, duration or accuracy that an uninvolved person could verify.
4. **A timeframe** — long enough to be achievable, short enough to force review.

## Writing goals with people, not for them

- Start from the person's words and keep them visible: the therapy goal above should still smell like lunch, not like a clinic.
- Offer the trade-offs honestly: faster progress on fewer goals versus slower on many. Families choose better than we assume.
- For children, seek the child's own version too — it is frequently different from the parent's, and both matter.
- Revisit goals when life changes, not only at review dates. A goal nobody cares about anymore is administrative debt.

## Failure modes

- **The therapist's goal in disguise** — technically measurable, emotionally nobody's. If the family cannot say why the goal matters, restart.
- **The unmeasurable participant goal, forced** — participant goals do not need SMART surgery; build measurable therapy goals underneath instead.
- **Goal drift in notes** — sessions logged against goals they no longer serve. Note-writing time is goal-audit time.

${CLINICAL_LINE}`,
  },
  {
    slug: 'clinical-recommendations',
    title: 'Writing Clinical Recommendations',
    description: 'Recommendations that are specific, justified and implementable.',
    contentType: 'clinical_guide',
    minutes: 9,
    content: `# Writing Clinical Recommendations

Recommendations are the part of a report that people act on — or fail to act on. Everything else exists to make this section trustworthy.

## Anatomy of a recommendation

Each recommendation states:

1. **What** — the support, service, equipment or modification, specifically. "Occupational therapy" is a profession; "weekly 60-minute OT sessions targeting independent morning routine, delivered at home, for 16 weeks, then review" is a recommendation.
2. **How much and how long** — frequency, duration and review point, with the dose reasoned, not ritual. Why weekly? Why 16 weeks? One sentence of dosage rationale sets a defensible report apart.
3. **Why** — the link back to the functional findings and the participant's goals, explicitly. The reader should never have to reconstruct your reasoning from twenty pages back.
4. **Who and where** — delivery setting and any required competencies (for example, equipment prescription review by an appropriately experienced clinician).
5. **Expected outcome** — what will be different if the recommendation is implemented, in participation terms, and how anyone will know.

## Ordering and numbering

Number recommendations and order them by importance, not by category habit. Delegates and planners read numbered lists; they act on the top of them. If safety-critical items exist, they come first and say why.

## Alternatives and value

Where a cheaper or simpler alternative exists and was rejected, say so and say why: "A standard shower chair was trialled and is unsafe for Marcus because… ". Pre-empting the obvious question is the difference between a recommendation that survives scrutiny and one that bounces.

## The lines we do not cross

- **No funding guarantees.** We recommend; delegates decide. Phrases like "the NDIS will fund" or "this must be approved" do not appear in Opal reports — "it is recommended that funding be considered for…" carries the clinical weight without the false promise.
- **No recommendations outside competence.** Equipment and modification recommendations beyond your experience are referred, jointly assessed, or explicitly framed as requiring specialist review — see Wheelchair and Seating for the model.
- **No orphan recommendations.** Anything recommended must trace to a finding. If the assessment did not examine it, the report does not recommend it.

## The implementability test

Before finalising, read each recommendation as the person who must act on it: a plan manager, a school principal, an equipment supplier, a parent on a hard week. Is it specific enough to purchase, schedule or build? If any actor would need to phone you to ask what you meant, revise it.

${CLINICAL_LINE}`,
  },
  {
    slug: 'at-assessment-workflow',
    title: 'Assistive Technology Assessment Workflow',
    description: 'From functional need to AT recommendation, trial and review.',
    contentType: 'clinical_guide',
    minutes: 10,
    content: `# Assistive Technology Assessment Workflow

Assistive technology succeeds when it matches the person, the task and the environment — and fails expensively when any of the three is guessed. This workflow keeps the match honest.

## 1. Start from function, not catalogue

The referral is a functional problem ("cannot transfer safely", "cannot communicate wants at school"), not a product request. Even when a family arrives asking for a specific item, step back to the task and goal first — sometimes the requested item is right, and now you can say why.

## 2. Assess the person-task-environment triangle

- **Person:** relevant capacities and constraints — physical, sensory, cognitive, and importantly preferences and tolerance. Equipment that embarrasses its user becomes garage equipment.
- **Task:** exactly what needs doing, where it breaks down, and what level of independence is the goal.
- **Environment(s):** every setting the AT must work in — measure doorways, transport, storage, and consider every user (a hoist has carers as users too).

## 3. Consider the low-tech option first

The credibility of every AT recommendation rests on the simpler options having been genuinely considered. Task modification, routine change, off-the-shelf items — document what was considered and why it does or does not suffice. This is also the value-for-money reasoning funders rightly expect.

## 4. Shortlist and involve suppliers appropriately

Shortlist candidate solutions on clinical grounds before supplier involvement. Suppliers bring product knowledge worth having; prescription decisions remain clinical and conflict-free (see the Conflict of Interest Policy — no commissions, options offered where reasonable).

## 5. Trial in the real environment

A trial in the home, school or community setting where the AT must work — not the showroom. Use the Equipment Trial Guide: define success measures before the trial starts, involve the daily users, run it long enough to expose real-life friction, and record outcomes against the measures.

## 6. Decide, and write the justification

The recommendation follows Clinical Recommendations structure: the functional need, options considered, trial outcomes, the selected solution with specifications, training and maintenance needs, and expected participation outcomes. Cost information is quoted from supplier quotes, and claiming or funding pathways are checked against current official guidance — never asserted from memory, never guaranteed.

## 7. Plan implementation, training and review

Delivery is the midpoint, not the end: fitting and setup, training for the participant and everyone who supports the AT's use, integration into routines, and a scheduled review — because bodies, tasks and environments change. Record who owns maintenance and what the escalation path is when something breaks in week one, which is when things break.

## Safety boundaries

Complex seating, pressure care surfaces, home modifications with structural implications and high-risk transfers equipment have specialist dimensions — involve or refer to appropriately experienced clinicians rather than stretching. See Wheelchair and Seating, Pressure Management and Home Modifications for where those lines sit.

${CLINICAL_LINE}`,
  },
  {
    slug: 'wheelchair-seating-overview',
    title: 'Wheelchair and Seating — Overview',
    description: 'High-level orientation, with clear deferral to specialist assessment.',
    contentType: 'clinical_guide',
    minutes: 8,
    content: `# Wheelchair and Seating — Overview

Wheelchair and seating provision is a specialist area within occupational therapy. This overview orients generalist clinicians to the territory — and is explicit about its boundary: **complex wheelchair and seating prescription is deferred to clinicians with specific competence in seating assessment.** Getting this wrong causes pressure injuries, postural deterioration and abandoned equipment.

## Why seating is different

A wheelchair is not one decision but a system of them: mobility base, seating and postural supports, pressure management, transport compatibility, environment fit and growth or change over time. The interactions are where the risk lives — a cushion choice affects posture, which affects function, which affects pressure distribution.

## What a generalist can and should do

1. **Recognise need early.** Flag deteriorating posture, discomfort, skin changes, reduced sitting tolerance, or equipment the person has outgrown — early referral protects months of function.
2. **Contribute the functional picture.** The seating specialist needs exactly what we do well: how the person spends their day, the tasks the chair must serve, every environment it must work in, transfers, transport and the goals that matter.
3. **Check the basics on review visits.** Is the equipment being used as set up? Are supports where they were fitted? Any skin concerns reported (escalate immediately — see Pressure Management)? Is anything broken or outgrown?
4. **Coordinate.** Own the referral, the information flow with consent, and the follow-through — specialist assessment works best inside a well-coordinated episode.

## What is deferred to specialist assessment

- Prescription of complex manual or powered wheelchairs and configured seating systems.
- Postural assessment for custom or configured supports.
- Pressure risk assessment where risk is elevated or a history of pressure injury exists.
- Scripting changes to existing complex systems.

"Deferred" means genuinely handed to, or jointly conducted with, a clinician with seating competence — not rubber-stamped.

## Red flags for immediate action

Skin redness or breakdown related to sitting, new pain in sitting, sudden postural change, or equipment failure affecting safety: act the same day — escalate per the Clinical Escalation Pathway, involve the specialist and supplier, and document.

${CLINICAL_LINE}`,
  },
  {
    slug: 'school-based-ot',
    title: 'School-Based Occupational Therapy',
    description: 'Working effectively inside schools: partnership, participation and practicality.',
    contentType: 'clinical_guide',
    minutes: 10,
    content: `# School-Based Occupational Therapy

School is where children do their most public occupational performance, six hours a day. Therapy that works there multiplies; therapy that ignores the setting evaporates on the drive home.

## The stance: guest and partner

We are guests in a system with its own expertise, pressures and rhythms. The teacher knows this classroom; we know this child's function. The work succeeds where those meet.

- Book visits through the school's process, sign in, and respect timetables — arriving during assessment week uninvited costs a term of goodwill.
- Establish the consent picture before the first visit: parental consent for the school contact, and clarity about what will be shared with whom.
- Feed back to both teacher and family after every visit, within consent. The child does not benefit from a therapist-teacher channel the family cannot see, nor the reverse.

## Assess participation, not just performance

Classroom observation looks at the child in context: the demands of this classroom, this teacher's style, the desk setup, the playground, transitions, mealtimes. Often the highest-value finding is an environment-task mismatch, not a child deficit — the pencil grip matters less than the fact that handwriting demands peak right after the sensory chaos of lunch.

## Intervene through the setting

1. **Prefer strategies the classroom can absorb.** A two-minute movement break for the whole class survives; a special routine for one child that costs the teacher attention mostly does not. Whole-class wins remove stigma and get maintained.
2. **Coach the adults who are there daily.** Teachers and education assistants deliver more therapy minutes than we ever will — see Caregiver Coaching for the method; it applies to classrooms directly.
3. **Make recommendations implementable by this school.** Equipment that fits the room, strategies that fit the timetable, wording that fits school planning documents. Ask what is feasible rather than prescribing into a vacuum.
4. **Withdraw thoughtfully.** Pull-out sessions have their place (skill acquisition needing low distraction), but the default is building skills where they are used.

## Write for the school audience too

School-facing summaries are short, practical and free of clinical jargon: what helps this child, what to watch for, what to try first when things wobble. One page a relief teacher could act on beats five pages nobody rereads.

## When school and family disagree

It happens: about priorities, about diagnosis, about what the child can do. Hold the child's participation as the shared ground, document perspectives fairly, and avoid becoming either side's advocate against the other — see the Professional Boundaries Policy, and bring persistent conflicts to supervision.

${CLINICAL_LINE}`,
  },
  {
    slug: 'emotional-regulation',
    title: 'Emotional Regulation — Intervention Guide',
    description: 'Supporting regulation development without compliance framing.',
    contentType: 'clinical_guide',
    minutes: 10,
    content: `# Emotional Regulation — Intervention Guide

Emotional regulation work at Opal starts from one commitment: **regulation is a developmental capacity we help build, not a behaviour we extract.** The goal is a person who can weather and recover from big feelings with the right support — never a quieter, more convenient child. If an intervention's real success measure is adult convenience, it is not our intervention.

## Reframe the referral

Referrals often arrive as behaviour complaints: meltdowns, refusal, aggression. Translate before treating: behaviour is communication and overflow. The clinical questions are — what is this nervous system carrying, what skills are still developing, what in the environment exceeds current capacity, and what does support look like?

## Assess the whole picture

- **Regulation demands:** map the day for demand peaks — transitions, sensory load, social complexity, hunger, fatigue. Patterns usually explain more than diagnoses do.
- **Sensory contribution:** many regulation difficulties have a sensory processing dimension — see Sensory Regulation. Assess rather than assume.
- **Co-regulation available:** regulation develops through co-regulation. Assess what the adults around the child have capacity for — and what they need themselves.
- **The child's experience:** ask, at their level. Children often know exactly what overwhelms them; nobody has asked without an agenda before.

## Intervention: bodies before strategies, connection before content

1. **Reduce the mismatch first.** Adjust environments and demands so the child spends more time within capacity — regulation skills are learnt in the regulated zone, not during flooding. This is not "lowering expectations"; it is building the training conditions.
2. **Build co-regulation.** Coach the key adults in reading early signs, lending calm (voice, pace, proximity), and connecting before correcting. An adult's regulation is the intervention the child borrows.
3. **Grow body awareness.** Interoception work — noticing the body's signals with curiosity, without judgement — underpins self-regulation. Playful, concrete, never a test.
4. **Introduce strategies as tools the child owns.** Breathing, movement breaks, retreat spaces and sensory tools are offered, practised when calm, and framed as the child's own kit — not imposed mid-crisis, and never contingent on "good behaviour". A retreat space a child is sent to is a punishment; one they choose is a skill.
5. **Practise recovery, not just prevention.** Coming back from dysregulation — repair, re-entry, no shame — is a skill families and classrooms can learn as a routine.

## Language matters clinically

Notes and reports describe regulation development and support needs — "became overwhelmed during the transition and needed ten minutes of co-regulation to recover" — not compliance vocabulary ("non-compliant", "attention-seeking", "manipulative"). The record shapes how every future reader treats this child.

## Escalate what is beyond scope

Regulation difficulties entangled with trauma, self-harm, or risk to others need coordinated care — bring these to supervision early, refer where indicated, and use the Clinical Escalation Pathway for anything urgent.

${CLINICAL_LINE}`,
  },
  {
    slug: 'executive-functioning',
    title: 'Executive Functioning — Understanding and Assessment',
    description: 'What executive functions are, how difficulties present, and how to assess meaningfully.',
    contentType: 'clinical_guide',
    minutes: 10,
    content: `# Executive Functioning — Understanding and Assessment

Executive functions are the management system of daily life: the capacities that let a person hold a goal in mind, start moving toward it, resist the detour, notice it is going wrong and adjust. When they are compromised, the cost lands on ordinary days — mornings, homework, tenancies, jobs — often in people whose intelligence makes the struggle invisible.

## The working map

- **Inhibition** — stopping the impulse, filtering the distraction.
- **Working memory** — holding and using information across the span of a task.
- **Cognitive flexibility** — shifting between demands, tolerating plan changes.
- **Initiation** — starting, without which every other skill idles.
- **Planning and organisation** — sequencing steps, managing materials and time.
- **Self-monitoring** — noticing how it is going and correcting course.

These develop through the mid-twenties and develop differently in ADHD, autism, acquired brain injury, FASD and psychosocial conditions — and they are profoundly state-dependent: stress, fatigue and low interest degrade them in everyone, dramatically in our clients.

## How difficulties actually present

Rarely as "an executive function problem". Instead: the teenager called lazy who cannot start homework alone but works well alongside someone; the adult with a spotless plan who never begins it; the child who melts down at every unexpected timetable change; the man whose kitchen fills with half-finished tasks. The referral usually names character ("unmotivated", "disorganised", "defiant") — assessment's first job is to re-describe character as function.

## Assessing meaningfully

1. **Real tasks in real settings.** Observe a genuine multi-step occupation — cooking, packing a school bag, planning an outing — and record where it breaks: initiation? sequence? distraction? recovery from error? The breakdown point is the treatment target.
2. **Performance across conditions.** Same task with and without prompting, with and without structure, morning versus afternoon. The gap between supported and unsupported performance is the clinical finding funders most need to understand.
3. **Informant and self-report.** Daily-life informants see what sessions cannot. Where standardised EF questionnaires or assessments are used, choose within competence and licensing (see the Assessment Tool Directory) — and let scores support the functional story, never substitute for it.
4. **Strengths deliberately.** Every EF profile has intact machinery — interests that summon focus, routines that work, environments where the person flies. Intervention is built from these, so assessment must find them.

## Writing it up

Run the functional impact chain (see Writing Functional Impact): name the EF impairment, evidence its functional impact with observed specifics and prompt levels, land the participation consequence (tenancy, school, work, relationships), and let support requirements follow. "Requires external structure to initiate and sequence multi-step tasks" opens doors that "poor executive function" leaves shut.

For intervention approaches, continue to Executive Function Intervention.

${CLINICAL_LINE}`,
  },
  {
    slug: 'clinical-risk-assessment',
    title: 'Clinical Risk Assessment',
    description: 'Risk, likelihood, consequence, controls and review — plus when to escalate.',
    contentType: 'clinical_guide',
    minutes: 10,
    content: `# Clinical Risk Assessment

Risk assessment in community practice is not a form; it is a discipline of seeing clearly and acting proportionately, written down. This guide gives the structure Opal uses for clinical risks — falls, choking, pressure injury, absconding, medication misadventure, equipment failure, harm to or from others — and the escalation line that runs through all of it.

## The five-part structure

For each identified risk, record:

1. **Risk** — what could happen, specifically, to whom. "Falls" is a category; "fall on the outside steps during morning school departure when unsupervised" is a risk you can treat.
2. **Likelihood** — how probable, given history and current conditions. Anchor in evidence: near misses, frequency, informant report. Rate it simply (unlikely / possible / likely / almost certain) and say why.
3. **Consequence** — how bad if it happens, for this person. A minor stumble for one person is a fracture risk for another. Rate (minor / moderate / major / severe) with the reasoning visible.
4. **Controls** — what reduces likelihood or consequence, in preference order: eliminate the hazard, change the environment or task, add equipment, add supervision or procedure, train the people. State what is **already in place** versus what is **recommended** — conflating those misleads every reader.
5. **Review** — when this assessment is looked at again, and what would trigger earlier review (a change in condition, an incident, a new environment).

Likelihood and consequence together set priority: high-likelihood/high-consequence risks lead the recommendations and get the fastest review cycles.

## Doing it well

- **Assess with the person, not about them.** Dignity of risk is real: competent adults are entitled to informed choices we would not make. Our job is to ensure the risk is understood and mitigated to the level the person accepts — and to document that conversation, not to eliminate all risk by eliminating all living.
- **Fluctuation is part of the assessment.** Assess the realistic range, including the bad days, and say which conditions the controls assume.
- **Controls must be liveable.** A control the family cannot sustain is a fiction on paper. Design with the people who will operate it daily.
- **Near misses are data.** Ask about them explicitly; they are the risk register writing itself.

## Escalation

Risk assessment has a hard edge where documentation stops being enough:

- **Immediate danger** → 000, make safe, then the practice owner. Document after.
- **Urgent risk identified during assessment** (disclosure of abuse, acute deterioration, imminent-harm situations) → Clinical Escalation Pathway the same day, before the paperwork.
- **Risk exceeding your scope or confidence** → supervision now, not at the scheduled session; joint assessment or referral where indicated.
- **Risks involving reportable matters** → obligations may apply (mandatory reporting, NDIS reportable incidents): Requires legal/regulatory verification — escalate to the practice owner immediately rather than resolving alone.

A risk assessment that identified serious risk and ended in filing, not action, is worse than none: it is documented foreknowledge.

${CLINICAL_LINE}`,
  },
];

// ── Clinical guides — shorter (§19) ─────────────────────────────────────────

const clinicalShort = [
  {
    slug: 'functional-observation',
    title: 'Functional Observation',
    description: 'Skilled observation of real task performance — the core OT assessment method.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Functional Observation

Skilled observation of a person doing a real task in a real setting is occupational therapy's signature assessment method — often more decision-relevant than any score.

## Set it up honestly

- Observe the actual occupation in its actual context: breakfast in the kitchen it happens in, writing at the school desk, the transfer in the real bathroom.
- Minimise your distortion of the scene: brief the person, position unobtrusively, resist helping. The performance you want is the one that happens without you.
- One task observed well beats four skimmed. Plan what you must see against the referral question.

## What to record

- **Task sequence and breakdown points** — where exactly performance falters: initiation, sequencing, a physical demand, a decision point.
- **Prompt levels** — what input restored performance (none, gesture, verbal, demonstration, physical assistance) and how often.
- **Time and fatigue** — duration, pace changes, quality decay across the task.
- **Compensations** — the workarounds the person has built; they are both assessment findings and intervention assets.
- **Safety events and near misses** — factually, with context.
- **The person's own commentary** — quoted; how the task feels from inside is data observation cannot reach.

## Interpretation discipline

Record observation first, interpretation second, visibly separated (see Clinical Note Quality). One observation is a sample, not a verdict — note the conditions (time of day, who was present, a good day or bad day by report) and triangulate with informants before generalising.

${CLINICAL_LINE}`,
  },
  {
    slug: 'evidence-informed-practice',
    title: 'Evidence-Informed Practice',
    description: 'Using evidence honestly in everyday clinical decisions.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Evidence-Informed Practice

Evidence-informed practice is a habit of asking "why am I choosing this?" and being comfortable saying the answer aloud — to a family, a funder or a tribunal.

## The three-legged stool

Every clinical decision stands on best available evidence, clinical expertise, and the person's values and circumstances. Remove any leg and it falls: evidence without the person's context is a protocol; preference without evidence is a habit; evidence plus context without expertise is a search result.

## The everyday loop

1. **Ask a focused question** — about this person and this decision, not the whole field.
2. **Look efficiently** — recent syntheses and reputable guidelines first; you are triangulating, not writing a thesis.
3. **Appraise briefly** — who was studied, does it resemble this person, how big and how certain is the effect?
4. **Integrate and decide with the person** — evidence is an input to shared decision-making, not a trump card.
5. **Measure what happens** — your outcome data for this person is the evidence that settles whether to continue.

## When evidence is thin

Much of community OT practice outruns its evidence base. That is not a licence for anything, nor a reason for paralysis: reason transparently from mechanism and adjacent evidence, say plainly in reports that evidence is emerging, set a review point, and measure. Honest uncertainty documented is stronger than false confidence.

## Red flags

Interventions sold with testimonials rather than data, claims of dramatic effects across unrelated conditions, pressure to buy proprietary certification — apply the appraisal habit hardest where marketing is loudest. Log your appraisal reading as CPD with a reflection.

${CLINICAL_LINE}`,
  },
  {
    slug: 'adl-assessment-overview',
    title: 'ADL Assessment — Overview',
    description: 'Assessing activities of daily living across settings and support levels.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# ADL Assessment — Overview

Activities of daily living — personal care, feeding, mobility within the home, toileting, dressing, hygiene — are where independence is most personal. Assessing them well is equal parts method and tact.

## Method

1. **Interview first, observe second.** Start with the person's account of a typical day, then observe the tasks that matter most to the referral question — performed where and when they really happen, morning routines especially.
2. **Record support level per task, not overall.** The useful finding is granular: independent with setup for upper-body dressing, physical assistance for lower-body; supervision for shower transfers because of one step. Blanket ratings hide exactly what plans need to know.
3. **Note the difference between capacity and habit.** Some tasks are done for the person by routine rather than necessity. Distinguish "cannot", "does not currently" and "has never had the chance" — each points to a different intervention.
4. **Capture fluctuation and fatigue.** ADL performance at 7 am after a bad night is the performance that determines support needs.
5. **Use standardised measures within competence where they add structure** (see the Assessment Tool Directory), and let observation lead.

## Tact

ADL assessment enters bathrooms and bedrooms. Explain why, obtain consent for each observed task, offer alternatives (informant report, partial observation) where observation is intrusive, and preserve dignity relentlessly — the assessment is never worth degrading the person it serves.

## Writing it up

Findings run the functional impact chain: task, current performance and support level, consequence for participation and independence, and what would change it. Specific, measured, respectful.

${CLINICAL_LINE}`,
  },
  {
    slug: 'cognitive-assessment-overview',
    title: 'Cognitive Assessment — Overview',
    description: 'The OT contribution to understanding cognition in daily function.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Cognitive Assessment — Overview

Occupational therapy's cognitive assessment question is functional: how does this person's thinking support or limit what they need and want to do? We assess cognition-in-occupation, complementing — never duplicating — neuropsychological assessment.

## Scope and boundaries

- OT cognitive assessment informs support planning, safety decisions and intervention design. Diagnostic questions, capacity determinations with legal weight, and detailed cognitive profiling belong with the appropriate specialists — contribute to them, do not substitute for them.
- Use standardised cognitive screens and functional cognitive assessments only within your training and the tool's licensing (see the Assessment Tool Directory).

## The functional method

1. **Occupation as the test.** Observe multi-step real tasks — meal preparation is the classic — and record where cognition shows itself: following the sequence, handling interruption, safety judgement, error detection and correction, adapting when an ingredient is missing.
2. **Vary support and structure.** Performance with a written list versus without; with prompting versus alone. The support-performance gap is the finding.
3. **Triangulate.** Informants describe the pattern across weeks — missed medications, repeated questions, lost bills — that one visit cannot show. Recent changes matter more than absolute level.
4. **Context and confounds.** Fatigue, pain, low mood, hearing, language and anxiety all masquerade as cognitive impairment. Note them, and time assessment fairly.

## Safety findings act fast

Cognitive findings with immediate safety weight — stove use, medication management, driving, wandering — are not filed for the report. Address interim safety with the person and family the same day, and escalate per the Clinical Escalation Pathway where risk is urgent.

${CLINICAL_LINE}`,
  },
  {
    slug: 'ef-assessment-overview',
    title: 'Executive Function Assessment — Overview',
    description: 'A quick-reference method for assessing EF in daily life.',
    contentType: 'clinical_guide',
    minutes: 5,
    content: `# Executive Function Assessment — Overview

A condensed method companion to Executive Functioning — Understanding and Assessment. Use that guide for the full picture; use this as the checklist.

## The four moves

1. **Real multi-step task, observed.** Cooking, packing, planning an outing. Record the exact breakdown point: initiation, plan, sequence, distraction, error recovery. The breakdown point is the treatment target.
2. **Vary the conditions.** Same task with structure versus without; prompted versus independent; preferred versus non-preferred. The gap between conditions is the clinical finding — and the funding-relevant one.
3. **Get the week-scale picture.** Informant and self-report of daily life: mornings, deadlines, bills, appointments. Standardised EF questionnaires within competence and licensing add structure (see the Assessment Tool Directory).
4. **Find the intact machinery.** Interests that summon sustained attention, routines that run reliably, environments where performance normalises. Intervention will be built from these.

## Reporting reminders

- Re-describe character words from the referral ("lazy", "defiant") as function, with evidence.
- Prompt levels and support-performance gaps, stated numerically where possible.
- Run the chain: impairment → functional impact → participation consequence → support requirement.
- State-dependence noted: stress, fatigue and interest change EF performance, and the assessment should say under which conditions it sampled.

${CLINICAL_LINE}`,
  },
  {
    slug: 'occupational-performance-assessment',
    title: 'Occupational Performance Assessment',
    description: 'Assessing the fit between person, occupation and environment.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Occupational Performance Assessment

Occupational performance assessment asks the profession's central question: how well can this person do the occupations that make up their life, in the environments where they live it — and what explains the gaps?

## Start with the occupational profile

Before measuring anything, understand the life: roles, routines, meaningful occupations, history, environments, and what the person wants to be different. The profile decides what is worth assessing; without it, assessment is a fishing trip.

## Assess the transaction, not the parts

Performance emerges from person, occupation and environment together. A "dressing problem" may be a shoulder problem, a sequencing problem, a clothing-choice problem, a bedroom-layout problem or a morning-time-pressure problem — and the intervention differs completely for each. Observe the real transaction (see Functional Observation) and locate the mismatch before attributing it.

## Choose measures that serve the question

- Self-report and goal-setting measures capture the person's priorities and perceived performance — powerful for outcomes over time.
- Observational performance measures add structure to what you watch.
- Component measures (strength, range, cognition) explain, but never define, performance.

Select within competence and licensing (see the Assessment Tool Directory), and let every measure earn its administration time by changing a decision.

## Synthesise toward action

The output is not a list of scores; it is an explanation: which occupations matter and are limited, what best explains each limitation, what strengths and environmental assets are in play, and where intervention gets the most participation per unit of effort. That synthesis, run through the functional impact chain, is what reports and plans are built from.

${CLINICAL_LINE}`,
  },
  {
    slug: 'sensory-regulation',
    title: 'Sensory Regulation',
    description: 'Understanding sensory processing differences and supporting regulation.',
    contentType: 'clinical_guide',
    minutes: 7,
    content: `# Sensory Regulation

Sensory processing differences shape how safe, organised and available a person feels, moment to moment. Supporting sensory regulation is core community OT work — done well, it is precise and respectful; done poorly, it is a box of equipment and a hope.

## Understand the individual profile

People differ in how they register and respond to sensation across systems — touch, sound, movement, taste and smell, visual input, and internal body signals. Broad patterns (heightened responsiveness, reduced registration, sensory seeking) coexist differently across systems in the same person. Assess through informed interview, validated profiles within competence, and observation across environments and times of day — the profile is the person's, not the diagnosis's.

## Environment first

The highest-leverage sensory intervention is usually subtraction: reducing the load a person must regulate against. Audit the environments that matter — noise, light, visual clutter, unpredictability, crowding — and change what can be changed before asking the person to cope harder. A quieter classroom corner beats a coping strategy for surviving the loud one.

## Strategies the person owns

Sensory supports — movement breaks, deep pressure, quiet retreat, tools — are offered and practised as the person's own kit, chosen by effect, not by catalogue. Watch the actual regulatory effect and drop what does not earn its place. Never make sensory supports contingent on behaviour, and never use them as containment: a retreat space chosen is regulation; imposed, it is seclusion by another name.

## Respect the meaning

Sensory experiences carry meaning — for many autistic people, sensory interests are joy and self-regulation, not symptoms. The goal is a life that fits the nervous system, with capacity built at the person's pace, not the extinction of difference.

## Evidence honesty

The evidence base across sensory approaches is mixed and evolving. Be transparent about certainty, measure outcomes for this person (see Evidence-Informed Practice), and avoid proprietary program claims the data cannot carry.

${CLINICAL_LINE}`,
  },
  {
    slug: 'ef-intervention',
    title: 'Executive Function Intervention',
    description: 'Building EF supports that work: environment, routine, strategy and coaching.',
    contentType: 'clinical_guide',
    minutes: 7,
    content: `# Executive Function Intervention

EF intervention that works accepts a hard truth: exhorting a person to remember, plan and start harder does nothing. Change comes from restructuring the world around the person, building routines that lower the executive cost of living, and coaching strategies the person actually adopts.

## Externalise first

Working memory and initiation limits are best treated outside the head:

- **Visual schedules and checklists** where the tasks happen — the bathroom mirror, the kitchen wall, the phone lock screen — not in a drawer.
- **Time made visible**: timers, alarms and calendar notifications that carry the remembering, so the person carries the doing.
- **Environments that cue**: launch pads by the door, single homes for keys and wallets, materials staged where the task starts. Every removed decision is capacity returned.

## Routinise the repeating day

Anything that recurs — mornings, medications, laundry, bills — is a candidate for a routine that runs on cue rather than executive effort. Build routines with the person, one at a time, anchored to existing habits, and rehearsed until boring (see Routine Development). Boring is the goal: a routine that requires motivation is not yet a routine.

## Coach, don't lecture

Strategy use grows through guided practice on the person's real tasks: plan together, do, review what worked, adjust. Goal-plan-do-review style metacognitive coaching has the strongest footing across ages — the person becomes their own strategist, with you as trainer, fading on schedule (see Caregiver Coaching; the method transfers to coaching clients directly).

## Design for the bad day

Systems must survive stress, fatigue and low interest — the very states that degrade EF. Prefer fewer, sturdier supports over elaborate systems that themselves demand executive function to maintain. The two-step system used daily beats the perfect system abandoned in a fortnight.

## Measure adoption, not admiration

The outcome is not whether the person likes the strategy but whether it runs without you: prompt counts falling, tasks completing, mornings surviving. Review, prune and simplify at every visit.

${CLINICAL_LINE}`,
  },
  {
    slug: 'handwriting-fine-motor',
    title: 'Handwriting and Fine Motor',
    description: 'Assessing and supporting handwriting and fine motor development.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Handwriting and Fine Motor

Handwriting referrals are among the most common in paediatric practice — and among the most over-narrowed. The presenting pencil is rarely the whole story.

## Assess wider than the pencil

- **The task in context:** observe real writing at the real desk — posture, paper position, grasp, pressure, letter formation, speed against classroom demands, and endurance across a genuine task, not a two-minute sample.
- **The foundations:** postural stability, shoulder and wrist control, in-hand manipulation, bilateral coordination, visual-motor integration. Weak proximal support shows up distally.
- **The ergonomics:** chair and desk fit, lighting, and where the demand sits in the day (handwriting straight after lunch-hour chaos fails for non-motor reasons).
- **The purpose:** is the goal legibility, speed, endurance, or the child's willingness to write at all? They are different goals with different interventions.

## Intervene proportionately

1. **Environment and setup first** — seating, paper position, pencil options. Cheap wins before programs.
2. **Practice that is purposeful and brief** — little and often, embedded in meaningful writing, with the child tracking their own progress. Drudgery teaches avoidance.
3. **Whole-class strategies where possible** in school settings — movement breaks and warm-ups the teacher can run (see School-Based OT).
4. **Compensate without shame where indicated:** for some children, keyboarding or speech-to-text protects the actual goal — expressing ideas — while handwriting develops or plateaus. Frame access technology as a bridge or a tool, never a defeat, and recommend it explicitly when written output is blocking curriculum access.

## Watch the self-story

By the time a referral arrives, many children have concluded they are "bad at writing". Rebuilding willingness — through success experiences at the right difficulty — is often the primary intervention target, because no motor program survives a child who has stopped trying.

${CLINICAL_LINE}`,
  },
  {
    slug: 'routine-development',
    title: 'Routine Development',
    description: 'Building daily routines that hold — for families and adults alike.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Routine Development

Routines are load-bearing structures: they convert effortful decisions into automatic sequence, freeing capacity for what cannot be automated. Building them is a core, underrated OT intervention.

## Principles

1. **One routine at a time.** The household that needs five new routines gets them one by one, each stable before the next begins. Parallel routine-building fails in proportion to its ambition.
2. **Anchor to what already happens.** New steps attach to existing fixed points — after the kettle, before the school bus. Free-floating routines drift; anchored ones hold.
3. **Design with, not for.** The family's actual constraints — shift work, shared care arrangements, small kitchens, low-energy evenings — are design inputs, not compliance problems. A routine that ignores the household's reality is a worksheet, not an intervention.
4. **Make it visible.** Externalise the sequence where it runs: picture schedule at child height, checklist on the fridge, phone alarms for the adult version. Visibility carries the routine through low-capacity days.
5. **Rehearse to boring.** Walk it through together, at low-stakes times, until it needs no thought. Expect two to six weeks of support before a routine holds on its own — plan the coaching cadence accordingly.

## When routines break

They will — holidays, illness, a house move. Normalise breakage in advance and script the restart: back to the visual, back to the anchor, no blame. A family that knows how to restart a routine owns it; one that thinks breakage is failure abandons it.

## Flexibility is part of the build

Routines serve people, not the reverse. Build in the acceptable variations (the two-breakfast menu, the wet-weather option) so that flexibility is inside the routine rather than a breach of it — especially important where change tolerance is itself a clinical goal.

${CLINICAL_LINE}`,
  },
  {
    slug: 'community-participation',
    title: 'Community Participation',
    description: 'Intervention for genuine participation in community life.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Community Participation

Community participation is where therapy outcomes become a life: shops, transport, sport, groups, work experience, the library, the pool. It is also where gains most often stall — skills mastered at home that never leave the driveway.

## Assess the real barriers

Participation gaps have layered causes; name them separately, because each needs different work:

- **Skills** — the task demands the person cannot yet meet (transport navigation, money handling, social entry).
- **Opportunity** — no accessible option exists locally, or nobody has ever invited them.
- **Support** — the participation depends on a person who is not funded, available or confident.
- **Confidence and history** — past failures and anxiety that make avoidance rational.
- **Environment and attitudes** — inaccessible venues, unwelcoming programs, low community expectations.

## Intervene in the setting

1. **Practise where it counts.** Community skills are learnt in the community — graded, real excursions with planned support fading, not clinic simulations alone.
2. **Build the bridge person.** Coach the support worker, family member or group leader who will be there when you are not (see Caregiver Coaching). Sustainable participation almost always routes through them.
3. **Engineer the first successes.** Choose the first venue and time for likely success — the quiet session, the shorter trip, the interest-matched group. Early wins finance later stretch.
4. **Work the environment side.** A phone call preparing a coach or librarian often does more than a month of skill training. Community capacity is a legitimate intervention target, with consent.
5. **Plan for setbacks.** A bad outing is data, not a verdict — debrief, adjust the grading, re-enter.

## Measure participation, not attendance

Presence in a place is not participation in it. Track engagement, roles taken, relationships forming, and the person's own account of belonging — and report those, run through the functional impact chain, when supports need justifying.

${CLINICAL_LINE}`,
  },
  {
    slug: 'caregiver-coaching',
    title: 'Caregiver Coaching',
    description: 'Coaching families and carers so therapy lives between visits.',
    contentType: 'clinical_guide',
    minutes: 7,
    content: `# Caregiver Coaching

The mathematics of community therapy is unforgiving: we are present for one hour; the family for the other hundred and sixty-seven. Coaching the people who live with the participant is not an adjunct to therapy — for much of our caseload, it **is** the therapy.

## The stance

Coaching treats the caregiver as a capable partner who knows this person best, not as a student of our expertise. We bring frameworks and technique; they bring context, history and the relationship. Plans are built jointly or they are not followed.

## The loop

1. **Agree the target together** — one specific situation that matters this fortnight (the bath refusal, the homework hour), not "everything".
2. **Observe or hear the current pattern** without judgement — what happens, what has been tried, what the caregiver suspects.
3. **Model or co-design a strategy** — briefly, concretely, in the real situation where possible.
4. **The caregiver practises while you support** — this step is the coaching; skipping from demonstration to "call me if it doesn't work" is where transfer dies.
5. **Reflect together** — what worked, what felt wrong, what to adjust. The caregiver's felt experience is design data.
6. **Fade deliberately** — from doing, to prompting, to reviewing, on an agreed schedule.

## Coach the realistic household

Design for the family that exists: the shift-working parent, the carer with their own health load, the grandmother who does Wednesdays. Strategies must run on the household's worst plausible day. When a caregiver is not following the plan, the first hypothesis is that the plan does not fit the life — redesign before re-explaining.

## Watch the caregiver's tank

Caregiver capacity is a clinical variable. Exhaustion, isolation and grief change what coaching can ask. Notice, acknowledge, and where need exceeds our role, help connect to supports — a coached strategy delivered to a depleted caregiver is a task added, not a burden shared.

## Document it as intervention

Coaching sessions are recorded like any intervention: target, strategy, caregiver practice and response, plan. It is skilled clinical work; the record should read like it.

${CLINICAL_LINE}`,
  },
  {
    slug: 'equipment-trial-guide',
    title: 'Equipment Trial Guide',
    description: 'Running equipment trials that produce a real decision.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Equipment Trial Guide

An equipment trial exists to answer one question: does this item solve this person's functional problem in this life? Trials that lack a question produce impressions; funded equipment needs findings.

## Before the trial

1. **Define success in writing.** Two to four measurable criteria drawn from the functional need: "independent shower transfer without skin shear", "self-propels the school corridor within passing period", "carer completes the hoist transfer alone, safely". If you cannot state the criteria, the assessment is not finished (see AT Assessment Workflow).
2. **Trial in the real environment** — the actual bathroom, school, vehicle. Showroom trials answer showroom questions.
3. **Set the duration to expose real life.** Long enough for novelty to wear off and routine friction to appear — a single demonstration is not a trial for anything consequential.
4. **Brief every user.** The participant, family and support workers know what is being tested, how to use the item safely, and what to record. Arrange supplier setup and any interim safety measures.

## During the trial

- Record against the criteria, plus: comfort over time, effort and setup burden, fit across all users and routines, storage and transport reality, and the participant's own verdict — an item the person dislikes is a non-solution regardless of function.
- Capture failures precisely (what task, what circumstances) — they steer specification changes.
- Stop the trial early for any safety event; report per the Incident Management Policy.

## After the trial

Decide against the written criteria: met, partially met with specified changes, or not met. Record the outcome either way — documented unsuccessful trials are valuable evidence of options considered, and they belong in the recommendation's justification. Then complete the recommendation per Clinical Recommendations, with quotes and current funding rules checked at the official sources.

${CLINICAL_LINE}`,
  },
  {
    slug: 'pressure-management',
    title: 'Pressure Management — Overview',
    description: 'Pressure injury risk basics and the escalation line for generalists.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Pressure Management — Overview

Pressure injuries are largely preventable, devastating when missed, and a shared responsibility across every clinician who sees the person. This overview gives generalists the essentials — and a hard boundary: **elevated pressure risk and existing pressure injury involve specialist and nursing input, not generalist improvisation.**

## Know the risk picture

Risk concentrates where these stack: reduced mobility or ability to reposition, reduced sensation, moisture, poor nutrition, previous pressure injury, ageing skin, and long daily hours on any one surface — bed, wheelchair, shower chair. Every seating and bed-related assessment includes a basic pressure risk consideration.

## What generalists do

1. **Ask and look.** Ask about skin as routinely as about sleep: any redness that does not fade, pain over bony areas, marks from equipment. Encourage the person and carers to check high-risk sites and report early — heels, sacrum, ischial areas, and under or around equipment contact points.
2. **Mind the whole 24 hours.** Pressure risk lives across every surface and position in the day, not just the wheelchair. Repositioning routines, time-in-one-position, and transfers that shear skin all belong in the picture.
3. **Protect the basics.** Equipment used as fitted and maintained; no DIY cushion swaps or added covers that change a surface's performance; moisture and nutrition concerns flagged to the right professionals.
4. **Escalate fast.** Non-blanching redness or any skin breakdown related to pressure: same-day action — off-load the area where safely possible, contact the GP or nursing service, inform the practice owner, and involve the seating specialist where equipment is implicated. Document per the Incident Management Policy where our equipment or services are involved.

## What is deferred

Pressure risk assessment for high-risk individuals, pressure care surface prescription (cushions and mattresses), and management of existing injuries sit with clinicians with specific competence, wound services and nursing — coordinate, refer, and follow up.

${CLINICAL_LINE}`,
  },
  {
    slug: 'bathroom-transfer-equipment',
    title: 'Bathroom and Transfer Equipment',
    description: 'Common bathroom and transfer equipment: assessment and safe prescription basics.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Bathroom and Transfer Equipment

Bathrooms concentrate risk: water, hard surfaces, minimal clothing, effortful transfers and privacy that excludes helpers. Equipment here prevents more injuries per dollar than almost anywhere else — when it fits the person, the task and the actual room.

## Assess in the room

- Measure the space: door widths, shower recess or bath dimensions, toilet height and clearances, rail fixing surfaces. Catalogue dimensions decide nothing until the room agrees.
- Observe the real transfers — toilet, shower entry, bath if used — at the person's realistic worst (see Functional Observation): fatigue, night-time, wet surfaces.
- Assess every user: the person, plus any carer assisting. A transfer that is safe for the participant and wrecks the carer's back has failed.

## Common equipment and the questions that choose it

- **Shower chairs and stools:** seated stability needs, pressure considerations for longer showers, self-propelling versus carer-pushed, over-toilet combinations.
- **Toilet surrounds, raised seats, commodes:** transfer style, height, weight capacity, and who cleans and moves it — dignity and practicality together.
- **Grab rails:** located from the observed transfer, not symmetry; fixing into adequate structure — rail specification and structural fixing questions beyond your competence go to the builder or a clinician experienced in the area (and see Home Modifications for anything beyond simple rails).
- **Transfer benches, boards and standing aids:** the person's technique and the carer's training are part of the prescription; equipment without training is a hazard delivered.

## Prescribe like it matters

Trial where feasible (see Equipment Trial Guide), specify precisely (model, size, configuration), arrange fitting and training, and set a review — bodies and bathrooms change. Hoists, ceiling tracks and complex transfer systems involve specialist assessment and carer training plans: coordinate rather than improvise.

${CLINICAL_LINE}`,
  },
  {
    slug: 'home-modifications',
    title: 'Home Modifications — Overview',
    description: 'From functional need to buildable modification, with scope boundaries.',
    contentType: 'clinical_guide',
    minutes: 6,
    content: `# Home Modifications — Overview

Home modifications change the environment so the person's function works at home — from grab rails to bathroom rebuilds. The clinical reasoning is ours; the building expertise is not. Good outcomes come from respecting both halves.

## The clinical half

1. **Start from occupations, not features.** The finding is "cannot enter the home independently" or "shower requires two-person assist in an unmodifiable recess" — observed in the home, run through the functional impact chain. The modification is the answer, not the starting point.
2. **Assess the trajectory.** Modifications are durable; conditions often are not static. Design for the realistic future — progression, growth, changing equipment — and say in the report which assumptions the design carries.
3. **Consider the whole household.** Other residents, tenure (owned, private rental, social housing — each changes what is possible and whose consent is needed), and the household's tolerance for disruption during works.
4. **Exhaust simpler options visibly.** Equipment, task change and relocation of activities are considered first and documented — the value-for-money reasoning that carries any significant modification recommendation.

## The boundary

Minor modifications (rails into sound structure, handheld showers, threshold ramps within competence) sit within experienced generalist scope. **Complex modifications — structural changes, bathroom rebuilds, ramps with fall implications, anything involving compliance standards — require clinicians experienced in home modification work and appropriately qualified building professionals.** The OT specifies the functional requirements; builders, and where applicable access consultants, determine construction and compliance. Do not draw, cost or certify beyond competence.

## Delivery realities

Quotes, approvals, landlord consents and construction all take time — set honest expectations with families, plan interim safety for the waiting period, and review after completion: a modification is not done until the person's function confirms it works.

${CLINICAL_LINE}`,
  },
  {
    slug: 'assessment-tool-directory',
    title: 'Assessment Tool Directory',
    description: 'Metadata directory of commonly used assessment tools — no proprietary content.',
    contentType: 'article',
    minutes: 8,
    content: `# Assessment Tool Directory

A metadata directory of assessment tools commonly encountered in Opal's areas of practice. **It contains no proprietary content** — no items, forms, scoring rules or interpretation tables. Entries note purpose, population, domain, administration considerations and licensing at a general level; the publisher's current manual and licence are the only authority for use. Administer any tool only within your training, competence and the publisher's licensing terms.

---

**Canadian Occupational Performance Measure (COPM)**
Purpose: client-centred measure of self-perceived occupational performance and satisfaction. Population: broad, all ages with adaptation. Domain: occupational performance priorities and outcomes. Administration: semi-structured interview; brief training recommended. Licensing: purchase and terms via the publisher (COPM/CAOT channels).

**Goal Attainment Scaling (GAS)**
Purpose: individualised goal outcome measurement. Population: any. Domain: goal attainment across domains. Administration: method, not a kit; training in scaling improves reliability. Licensing: method published in open literature.

**Assessment of Motor and Process Skills (AMPS)**
Purpose: observational assessment of ADL motor and process skill quality. Population: children to older adults. Domain: ADL task performance. Administration: requires formal certification training and calibration. Licensing: certification and software via the publisher.

**Sensory Profile family (for example Sensory Profile 2)**
Purpose: questionnaire-based sensory processing patterns. Population: infants to adults by version. Domain: sensory processing in daily life. Administration: caregiver/self-report; qualification level applies. Licensing: purchase via the test publisher; user qualification requirements apply.

**Vineland Adaptive Behavior Scales**
Purpose: adaptive behaviour across communication, daily living, socialisation. Population: birth to adult. Domain: adaptive functioning. Administration: interview or rating forms; publisher qualification levels apply. Licensing: via the test publisher.

**WeeFIM / Functional Independence Measure contexts**
Purpose: burden-of-care and functional independence rating. Population: paediatric (WeeFIM) and adult rehabilitation settings. Domain: self-care, mobility, cognition. Administration: credentialing required in many settings. Licensing: via the rights holder.

**Beery-Buktenica Developmental Test of Visual-Motor Integration (Beery VMI)**
Purpose: visual-motor integration screening. Population: children primarily. Domain: visual-motor, visual perception, motor coordination. Administration: standardised individual administration. Licensing: via the test publisher; qualification levels apply.

**Bruininks-Oseretsky Test of Motor Proficiency (BOT-2 and successors)**
Purpose: motor proficiency assessment. Population: children and adolescents. Domain: fine and gross motor. Administration: standardised; time-intensive full form, short form available. Licensing: via the test publisher.

**Behavior Rating Inventory of Executive Function (BRIEF family)**
Purpose: informant/self-report of executive function in daily life. Population: preschool to adult by version. Domain: executive functioning. Administration: questionnaires; qualification level applies. Licensing: via the test publisher.

**Home environment and falls-risk checklists (for example HOME FAST)**
Purpose: structured home hazard screening. Population: older adults and others at falls risk. Domain: home safety. Administration: observational checklist. Licensing: several instruments open-access in the literature; verify the specific tool.

---

Before using any tool: confirm your qualification against the publisher's current requirements, the licence covers your intended use, and the norms fit the person. When a needed tool sits outside your competence, that is a supervision conversation, not a workaround.

${CLINICAL_LINE}`,
  },
];

module.exports = {
  VERIFIED_LINE,
  CLINICAL_LINE,
  externalSources,
  resources: [...ndis, ...clinicalMajor, ...clinicalShort],
};
