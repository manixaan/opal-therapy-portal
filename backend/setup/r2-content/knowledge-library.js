'use strict';

/**
 * R2 CONTENT — OT KNOWLEDGE LIBRARY
 *
 * Curated external links, evidence sources and learning platforms supplied by
 * the practice owner and verified 9 August 2026. Every resource is a short
 * link-out (2-5 minutes) that points at the authoritative source; nothing
 * here reproduces external content. Also defines the fixed-date PD course
 * listings, the new controlled tag categories (cost, origin, flag), the tag
 * links and alias additions, and the cross-listing of NDIS-core rows into the
 * existing 'ndis' collection.
 *
 * Plain data module. No database access. Australian English. No emojis.
 */

const VERIFIED_AT = '2026-08-09';

const VERIFIED_LINE =
  'Information current as verified on 9 August 2026. Always check the linked official source where a current regulatory or funding decision is required.';

// ── helper ──────────────────────────────────────────────────────────────────

function ext(o) {
  return {
    slug: o.slug,
    title: o.title,
    description: o.description,
    contentType: o.course ? 'course' : 'external_link',
    authority: o.authority || 'external_reference',
    minutes: o.minutes || 3,
    externalUrl: o.url,
    sourcePublisher: o.publisher,
    sourceTitle: o.sourceTitle || o.title,
    sourceEffective: o.effective,
    sourceVerifiedAt: VERIFIED_AT,
    content: `# ${o.title}\n\n${o.body.trim()}\n\n${VERIFIED_LINE}`,
  };
}

// ── 1. NDIS core (new rows; pricing, catalogue and What Are NDIS Supports
//      already exist in the R2 content and are cross-listed, not duplicated) ─

const ndisCore = [
  ext({
    slug: 'ndis-reasonable-necessary-supports',
    title: 'Reasonable and Necessary Supports (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/understanding/supports-funded-ndis/reasonable-and-necessary-supports',
    authority: 'official_regulatory',
    description: 'The NDIA explanation of the reasonable and necessary criteria that every funded support must satisfy.',
    body: `The NDIA's plain-language statement of what "reasonable and necessary" means: the criteria a support must meet before it can be funded, and how those criteria are weighed.

## Why it matters at Opal

Every recommendation we write is ultimately tested against this page. Reading the criteria in the NDIA's own words — rather than through summaries — keeps report reasoning aligned with how delegates actually decide.`,
  }),
  ext({
    slug: 'ndis-therapy-supports',
    title: 'What Are Therapy Supports (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/participants/using-your-funding/other-types-support/what-are-therapy-supports',
    authority: 'official_regulatory',
    description: 'The NDIA description of therapy supports, including where maintenance therapy fits.',
    body: `The NDIA's description of therapy supports: what they are for, how they relate to a participant's goals, and how therapy differs from supports that belong to the health system.

## Why it matters at Opal

This page includes the NDIA's treatment of maintenance therapy — useful language when a recommendation is about sustaining function rather than acquiring it. Quote the concepts, never a remembered paraphrase.`,
  }),
  ext({
    slug: 'ndis-functional-capacity-assessments',
    title: 'Functional Capacity Assessments (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/applying/types-assessments/what-functional-capacity-assessment',
    authority: 'official_regulatory',
    description: 'The NDIA guidance on functional capacity assessments and the six functional areas they cover.',
    body: `The NDIA's own guidance on functional capacity assessments: what an FCA is, who completes one, and what it informs.

As at August 2026 the guidance frames functional capacity across six areas — communication, learning, mobility, self-care, self-management and social interaction. Structuring FCA reports so a delegate can find each area answered is the practical takeaway.

## Why it matters at Opal

FCAs are our most consequential report type. Pair this page with the FCA Workflow and Writing Functional Impact guides in this hub.`,
  }),
  ext({
    slug: 'ndis-supporting-evidence',
    title: 'Supporting Evidence for Your Patient (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/working-participants/gps-and-health-professionals/what-supporting-evidence-your-patient',
    authority: 'official_regulatory',
    description: 'What evidence the NDIA looks for from treating professionals, in the NDIA’s own words.',
    body: `The NDIA's page for treating health professionals on supporting evidence: what the agency looks for, what makes evidence useful, and how functional impact should be described with task-specific examples.

## Why it matters at Opal

This is the closest thing to a marking rubric for our reports. When a report describes functional impact with concrete, task-specific examples, it is answering exactly what this page asks for.`,
  }),
  ext({
    slug: 'ndis-help-patient-access',
    title: 'How to Help Your Patient Access the NDIS (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/working-participants/gps-and-health-professionals/how-help-your-patient-access-ndis',
    authority: 'official_regulatory',
    description: 'The NDIA walkthrough for clinicians supporting a patient’s access request.',
    body: `The NDIA's walkthrough for health professionals supporting an access request: the process, the treating professional's part in it, and the evidence that carries weight.

## Why it matters at Opal

When a family asks "how do we even get into the scheme?", this is the page to open with them — and the frame for any access-supporting letter we write.`,
  }),
];

// ── 2. Assistive technology ─────────────────────────────────────────────────

const assistiveTech = [
  ext({
    slug: 'ndis-at-assessments',
    title: 'NDIS Assistive Technology Assessments',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/participants/assistive-technology/assistive-technology-assessments',
    authority: 'official_regulatory',
    description: 'The NDIA hub for assistive technology assessments across all AT levels.',
    body: `The NDIA's hub page for AT assessments: when an assessment is needed, what it must establish, and how assessments differ by the level and risk of the technology.

## Why it matters at Opal

Start here before any AT recommendation — the hub links to the current templates and evidence requirements, which change more often than practice habits do.`,
  }),
  ext({
    slug: 'ndis-at-assessment-template',
    title: 'General AT Assessment and Template (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/participants/assistive-technology/assistive-technology-assessments/what-general-assistive-technology-assessment',
    authority: 'official_regulatory',
    description: 'The general AT assessment explained, with the NDIA’s downloadable assessment template.',
    body: `The NDIA's explanation of the general AT assessment, including the downloadable assessment template (DOCX) the agency publishes for assessors.

## Why it matters at Opal

Using the NDIA's own template removes a whole category of "missing information" delays. Always download the current template from this page rather than reusing a saved copy — templates are revised.`,
  }),
  ext({
    slug: 'ndis-at-evidence-preparation',
    title: 'Preparing Evidence for an AT Assessment (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/working-participants/assistive-technology-providers/how-prepare-evidence-participants-assistive-technology-assessment',
    authority: 'official_regulatory',
    description: 'NDIA guidance on preparing the evidence that supports an AT assessment.',
    body: `The NDIA's guidance for providers on preparing AT assessment evidence: what to include, how to justify the recommended technology against alternatives, and how the evidence is used.

## Why it matters at Opal

AT requests fail on evidence gaps more than on clinical merit. This page is the checklist for closing those gaps before submission.`,
  }),
  ext({
    slug: 'indigo-equipment-database',
    title: 'Indigo — National Equipment Database',
    publisher: 'Indigo Australia',
    url: 'https://indigo.org.au',
    description: 'The national equipment database for browsing and comparing assistive technology products.',
    body: `Indigo's National Equipment Database — as at August 2026 listing more than 25,000 assistive technology products — with product details, images and supplier information.

## Why it matters at Opal

The fastest way to move from "something like this" to a named, specified product in an AT recommendation, and to show that alternatives were genuinely compared.`,
  }),
  ext({
    slug: 'lifetec-resources',
    title: 'LifeTec Resources',
    publisher: 'LifeTec Australia',
    url: 'https://lifetec.org.au/resources',
    description: 'LifeTec’s free assistive technology resources and practical guides.',
    body: `LifeTec Australia's resource library: practical guides, information sheets and decision supports across common assistive technology categories.

## Why it matters at Opal

Well-made, plain-language AT material that can be shared with families to support informed choices between assessment and trial.`,
  }),
  ext({
    slug: 'lifetec-at-hm-guide',
    title: 'LifeTec AT and Home Modifications Guide',
    publisher: 'LifeTec Australia',
    url: 'https://lifetec.org.au/resources/at-hm-guide',
    description: 'LifeTec’s combined guide to assistive technology and home modifications.',
    body: `LifeTec's guide covering assistive technology and home modifications together — how the two interact and how to think about them as one functional solution rather than two funding lines.

## Why it matters at Opal

Useful orientation before a combined AT and home modification assessment, where sequencing decisions matter.`,
  }),
  ext({
    slug: 'at-australia-training',
    title: 'AT Australia Training',
    publisher: 'Australian Assistive Technology Association',
    url: 'https://at-aust.org/home/training/training.html',
    course: true,
    description: 'Assistive technology training courses for practitioners.',
    body: `AT Australia's training offerings for assistive technology practitioners: structured courses building AT assessment and prescription capability.

Courses are paid; check the current calendar and pricing at the linked page.

## Why it matters at Opal

A recognised pathway for deepening AT practice beyond entry level — worth pairing with your CPD plan and supervision goals.`,
  }),
  ext({
    slug: 'arata',
    title: 'ARATA — Australian Rehabilitation and Assistive Technology Association',
    publisher: 'ARATA',
    url: 'https://arata.org.au',
    authority: 'professional_body',
    description: 'The national association for assistive technology practice, research and policy.',
    body: `ARATA is Australia's peak body for rehabilitation and assistive technology: position papers, practice resources, events and a community of AT practitioners.

## Why it matters at Opal

The professional home for AT practice in Australia — its resources and conferences are a reliable way to stay current in a fast-moving field.`,
  }),
];

// ── 3. Home modifications ───────────────────────────────────────────────────

const homeMods = [
  ext({
    slug: 'ndis-home-mods-assessments',
    title: 'What Are Home Modification Assessments (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/participants/home-and-living/modifying-your-home/what-are-home-modification-assessments',
    authority: 'official_regulatory',
    description: 'The NDIA explanation of home modification assessments, with the minor and complex HM templates.',
    body: `The NDIA's explanation of home modification assessments — what they establish and who completes them — including the agency's minor and complex home modification assessment templates.

## Why it matters at Opal

This is the template source for HM work. Download the current minor or complex template from this page for every assessment; never build on a saved copy.`,
  }),
  ext({
    slug: 'ndis-home-mods-how-to-provide',
    title: 'How to Provide a Home Modification Assessment (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/home-and-living-providers/home-modifications/how-provide-home-modification-assessment',
    authority: 'official_regulatory',
    description: 'NDIA provider guidance on completing and submitting a home modification assessment.',
    body: `The NDIA's provider-facing guidance on delivering a home modification assessment: required content, working with the participant, and how to submit the assessment and supporting evidence.

## Why it matters at Opal

The procedural companion to the templates — read it before your first HM assessment and skim it again when the process changes.`,
  }),
  ext({
    slug: 'ndis-home-mods-provider-guide',
    title: 'Guide to Providing Home Modifications (NDIA)',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/providers/housing-and-living-supports-and-services/providing-home-modifications',
    authority: 'official_regulatory',
    description: 'The NDIA guide for providers delivering home modification supports.',
    body: `The NDIA's guide for providers of home modification supports: the end-to-end picture from assessment through build, including roles, evidence and expectations.

## Why it matters at Opal

Where the assessment pages answer "what do I write", this guide answers "how does the whole modification actually get delivered" — essential context for realistic recommendations and timeframes.`,
  }),
];

// ── 4. NDIS Commission (practice standards, code of conduct and the worker
//      orientation module already exist in R2 and are cross-listed) ─────────

const commission = [
  ext({
    slug: 'ndis-commission-worker-training',
    title: 'NDIS Commission Worker Training Modules',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndiscommission.gov.au/workforce/online-training-modules',
    authority: 'official_regulatory',
    course: true,
    minutes: 4,
    description: 'The Commission’s free online training portal for NDIS workers, with completion certificates.',
    body: `The NDIS Commission's portal of free online worker training. As at August 2026 it includes the Worker Orientation Module, the New Worker NDIS Induction program (eight modules), Supporting Effective Communication, and Supporting Safe and Enjoyable Meals — each free, each with a completion certificate.

## Why it matters at Opal

Free, official, certificate-bearing training that maps directly onto our caseload (communication and mealtime safety especially). Save certificates to your portal profile and log the learning in your CPD tracker.`,
  }),
  ext({
    slug: 'ndis-commission-training-your-workers',
    title: 'Training Your NDIS Workers (Commission Guide)',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndiscommission.gov.au/workforce/training-workers/guide-for-ndis-providers/training-your-workers',
    authority: 'official_regulatory',
    description: 'Commission guidance for providers on identifying learning needs and training workers.',
    body: `The Commission's guide for providers on training workers: identifying learning needs, choosing training, and maintaining workforce capability over time.

## Why it matters at Opal

The reference point when we plan internal learning — it describes what a defensible training approach looks like from the regulator's side.`,
  }),
  ext({
    slug: 'ndis-commission-incident-management',
    title: 'Incident Management (NDIS Commission)',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndiscommission.gov.au/rules-and-standards/reportable-incidents-and-incident-management/incident-management',
    authority: 'official_regulatory',
    description: 'The Commission’s guidance on incident management systems and reportable incidents.',
    body: `The Commission's guidance on incident management: what an incident management system must do, and how reportable incidents are defined and notified.

## Why it matters at Opal

Our Incident Management Policy is the practice-level version of these expectations. Whether specific notification obligations apply in a given circumstance: Requires legal/regulatory verification — escalate to the practice owner rather than resolving alone.`,
  }),
];

// ── 5. Behaviour support ────────────────────────────────────────────────────

const behaviourSupport = [
  ext({
    slug: 'ndis-pbs-capability-framework',
    title: 'Positive Behaviour Support Capability Framework',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndiscommission.gov.au/rules-and-standards/behaviour-support-and-restrictive-practices/positive-behaviour-support',
    authority: 'official_regulatory',
    description: 'The Commission framework describing capability levels for positive behaviour support practice.',
    body: `The Commission's Positive Behaviour Support Capability Framework: the knowledge and skills expected of behaviour support practitioners at each capability level, and the self-assessment pathway.

## Why it matters at Opal

Even outside specialist behaviour support roles, the framework is the shared language for capability conversations when behaviour support intersects with our OT work.`,
  }),
  ext({
    slug: 'ndis-specialist-behaviour-support',
    title: 'Specialist Behaviour Support — Provider Information',
    publisher: 'NDIS Quality and Safeguards Commission',
    url: 'https://www.ndiscommission.gov.au/providers/understanding-behaviour-support-and-restrictive-practices-providers/positive-behaviour',
    authority: 'official_regulatory',
    description: 'Commission information for providers on behaviour support and restrictive practices.',
    body: `The Commission's provider information on behaviour support and restrictive practices: who may deliver specialist behaviour support, how plans are developed and implemented, and the obligations that attach to restrictive practices.

## Why it matters at Opal

Essential orientation whenever a participant we support has (or needs) a behaviour support plan — our strategies must sit inside that plan's framework, never around it.`,
  }),
  ext({
    slug: 'ota-ndis-faq',
    title: 'OTA NDIS FAQ',
    publisher: 'Occupational Therapy Australia',
    url: 'https://otaus.com.au/resources/faq-ndis',
    authority: 'professional_body',
    description: 'OTA’s frequently asked questions on occupational therapy practice under the NDIS.',
    body: `Occupational Therapy Australia's NDIS FAQ: the profession's answers to recurring questions about practising under the scheme.

## Why it matters at Opal

A quick first stop when an NDIS practice question feels common — someone has usually asked it, and OTA's answer links onward to the official sources.`,
  }),
];

// ── 6. Home and living ──────────────────────────────────────────────────────

const homeAndLiving = [
  ext({
    slug: 'ndis-home-and-living',
    title: 'NDIS Home and Living Hub',
    publisher: 'National Disability Insurance Agency',
    url: 'https://www.ndis.gov.au/participants/home-and-living',
    authority: 'official_regulatory',
    description: 'The NDIA hub for home and living supports: SIL, ILO and SDA.',
    body: `The NDIA's home and living hub covering Supported Independent Living (SIL), Individualised Living Options (ILO) and Specialist Disability Accommodation (SDA): what each support is, who it suits and how decisions are made.

Note: practice-standard changes affecting SIL were flagged during 2026 — check current NDIS Commission material alongside this hub before advising on SIL arrangements.

## Why it matters at Opal

Housing decisions shape everything else in a plan. When our assessments touch home and living supports, the reasoning must reflect the current version of this guidance.`,
  }),
];

// ── 7-8. Professional associations (OTA, WAOTA) ─────────────────────────────

const associations = [
  ext({
    slug: 'ota-workshops-webinars',
    title: 'OTA Workshops and Webinars',
    publisher: 'Occupational Therapy Australia',
    url: 'https://otaus.com.au/workshops-webinars',
    authority: 'professional_body',
    course: true,
    description: 'OTA’s calendar of CPD workshops and webinars for occupational therapists.',
    body: `Occupational Therapy Australia's live calendar of workshops and webinars — the profession's main CPD marketplace, spanning clinical topics, NDIS practice and professional skills.

Events are paid, with member pricing. Selected listings appear in this hub's PD events directory; the calendar itself is always the current source.

## Why it matters at Opal

The default first place to look when a CPD plan needs a course to anchor it.`,
  }),
  ext({
    slug: 'ota-resources-library',
    title: 'OTA Professional Resources Library',
    publisher: 'Occupational Therapy Australia',
    url: 'https://otaus.com.au/resources',
    authority: 'professional_body',
    description: 'OTA’s library of professional resources, position papers and practice guidance.',
    body: `Occupational Therapy Australia's professional resources library: position papers, practice guidance, submissions and member resources for Australian OTs.

Some items are member-only; much is openly available.

## Why it matters at Opal

When you need the profession's official position on a practice question, this is where it lives.`,
  }),
  ext({
    slug: 'ota-supervision-framework',
    title: 'OTA Professional Supervision Framework 2025',
    publisher: 'Occupational Therapy Australia',
    url: 'https://otaus.com.au/resources/professional-supervision-framework',
    authority: 'professional_body',
    description: 'OTA’s free framework for reflective, culturally safe professional supervision.',
    body: `Occupational Therapy Australia's Professional Supervision Framework (2025): a free, structured approach to reflective and culturally safe supervision, with guidance for building supervision systems for new graduates through to senior clinicians.

## Why it matters at Opal

Our Supervision Policy draws on exactly this thinking. Supervisors and supervisees alike should know the framework — it is the profession's benchmark for what good supervision looks like.`,
  }),
  ext({
    slug: 'waota-current-courses',
    title: 'WAOTA Current Courses',
    publisher: 'Western Australian Occupational Therapy Association',
    url: 'https://waota.com.au/cpd-activity/current-courses',
    authority: 'professional_body',
    course: true,
    description: 'WAOTA’s current CPD course calendar for Western Australian OTs.',
    body: `The Western Australian Occupational Therapy Association's current course calendar — locally delivered CPD for WA practitioners, from self-regulation and sleep to home modifications and upper limb practice.

Courses are paid; dates and registration are at the linked page, and selected listings appear in this hub's PD events directory.

## Why it matters at Opal

WA-local CPD means less travel and content tuned to our practice context.`,
  }),
];

// ── 9. Autism ───────────────────────────────────────────────────────────────

const autism = [
  ext({
    slug: 'autism-crc-guideline',
    title: 'Autism CRC National Guideline — Supporting Children',
    publisher: 'Autism CRC',
    url: 'https://www.autismcrc.com.au/best-practice/supporting-children',
    description: 'The national guideline for supporting autistic children — the evidence anchor for paediatric autism practice.',
    body: `Autism CRC's national guideline for supporting the learning, participation and wellbeing of autistic children and their families. As at August 2026 it carries 84 NHMRC-approved recommendations.

## Why it matters at Opal

This is the evidence anchor for our paediatric autism work: intervention choices, intensity decisions and family conversations should all be defensible against it. Commercial training (see Learn Play Thrive and others in this library) is used alongside the guideline, never instead of it.`,
  }),
  ext({
    slug: 'autism-crc-practitioner-elearning',
    title: 'Autism CRC Practitioner eLearning',
    publisher: 'Autism CRC',
    url: 'https://www.autismcrc.com.au/best-practice/supporting-children/for-practitioners',
    course: true,
    description: 'Autism CRC’s short course helping practitioners apply the national guideline.',
    body: `Autism CRC's practitioner eLearning for the national guideline: a short course with three detailed case studies plus a First Nations case study, covering goal-setting, monitoring and safeguarding in guideline-consistent practice.

## Why it matters at Opal

The fastest route from "the guideline exists" to "the guideline changes what I do on Tuesday". Log completion in your CPD tracker.`,
  }),
];

// ── 10. Paediatric — CanChild F-Words ───────────────────────────────────────

const CANCHILD_BASE = 'https://canchild.ca/research-in-practice/f-words-in-childhood-disability';

const canchild = [
  ext({
    slug: 'canchild-f-words-hub',
    title: 'CanChild F-Words in Childhood Disability',
    publisher: 'CanChild, McMaster University',
    url: CANCHILD_BASE,
    description: 'The F-Words hub: an ICF-based framework for childhood disability practice.',
    body: `CanChild's hub for the F-Words in Childhood Disability — Functioning, Family, Fitness, Fun, Friends and Future — an ICF-based way of framing childhood disability around what matters in a child's life.

## Why it matters at Opal

The F-Words give families and teams a shared, strengths-based language that maps naturally onto participation-focused OT goals.`,
  }),
  ext({
    slug: 'canchild-f-words-training',
    title: 'F-Words Foundations — Free Training',
    publisher: 'CanChild, McMaster University',
    url: `${CANCHILD_BASE}/f-words-training`,
    course: true,
    description: 'CanChild’s free five-module F-Words training for clinicians and families.',
    body: `CanChild's free F-Words training — five modules introducing the framework and its application in practice, open to clinicians and families alike.

## Why it matters at Opal

Free, short and genuinely practice-changing for paediatric caseloads. A strong early CPD entry for any therapist working with children.`,
  }),
  ext({
    slug: 'canchild-f-words-tools',
    title: 'F-Words Tools Library',
    publisher: 'CanChild, McMaster University',
    url: `${CANCHILD_BASE}/f-words-tools`,
    description: 'The F-Words tools: Profile, Goal Sheet, Agreement, Life Wheel, What-If tool and posters.',
    body: `CanChild's library of ready-to-use F-Words tools: the F-Words Profile, Goal Sheet, Agreement, Life Wheel, What-If tool and printable posters.

## Why it matters at Opal

Session-ready materials for goal conversations with families — download from the source so you always use the current versions.`,
  }),
  ext({
    slug: 'canchild-f-words-examples',
    title: 'F-Words Practice Examples',
    publisher: 'CanChild, McMaster University',
    url: `${CANCHILD_BASE}/f-words-tools-examples`,
    description: 'Worked examples of the F-Words tools completed in real practice.',
    body: `CanChild's collection of completed F-Words tool examples — real, worked illustrations of the Profile, Goal Sheet and other tools in use.

## Why it matters at Opal

Seeing a well-completed example shortens the path to using the tools confidently with your own families.`,
  }),
  ext({
    slug: 'canchild-f-words-voices',
    title: 'F-Words Family and Clinician Voices',
    publisher: 'CanChild, McMaster University',
    url: `${CANCHILD_BASE}/family-clinician-voices`,
    description: 'Families and clinicians describing how the F-Words changed their practice and lives.',
    body: `First-person accounts from families, young people and clinicians on applying the F-Words — what changed, and why it mattered.

## Why it matters at Opal

Powerful material for introducing the framework to a family, in voices that are not ours.`,
  }),
  ext({
    slug: 'canchild-f-words-webinars',
    title: 'CanChild Webinars and Podcasts',
    publisher: 'CanChild, McMaster University',
    url: `${CANCHILD_BASE}/webinars-and-podcasts`,
    description: 'CanChild’s webinar and podcast library on the F-Words and childhood disability research.',
    body: `CanChild's webinars and podcasts on the F-Words and related childhood disability research — free, browsable and suitable for CPD reading-and-reflection entries.

## Why it matters at Opal

An easy way to keep paediatric practice connected to the research group behind the framework.`,
  }),
];

// ── 11-15. Paediatric practice approaches ───────────────────────────────────

const paedApproaches = [
  ext({
    slug: 'star-institute-sensory-health',
    title: 'STAR Institute for Sensory Processing',
    publisher: 'STAR Institute',
    url: 'https://sensoryhealth.org',
    course: true,
    description: 'Education and resources on sensory processing and sensory health.',
    body: `The STAR Institute's education and resources on sensory processing: courses, mentorship and a free resources section covering sensory health across the lifespan.

Flagship education is paid; a modest free tier exists.

## Why it matters at Opal

A recognised source for structured sensory-processing education beyond entry-level knowledge.`,
  }),
  ext({
    slug: 'clasi-asi-certificate',
    title: 'CLASI — Certificate in Ayres Sensory Integration',
    publisher: 'Collaborative for Leadership in Ayres Sensory Integration',
    url: 'https://cl-asi.org',
    course: true,
    description: 'Formal certification in Ayres Sensory Integration — substantial post-professional training.',
    body: `CLASI's Certificate in Ayres Sensory Integration (CASI): a substantial, formal post-professional training program in ASI assessment and intervention.

Note the distinction that matters clinically: general sensory-regulation PD is not the same as formal ASI training. Claims of "sensory integration therapy" should reflect the actual training held.

## Why it matters at Opal

If ASI-level practice is a career direction, this is the recognised formal pathway; either way, knowing the distinction keeps our language honest.`,
  }),
  ext({
    slug: 'kelly-mahler-interoception',
    title: 'Kelly Mahler — Interoception Curriculum and Courses',
    publisher: 'Kelly Mahler',
    url: 'https://www.kelly-mahler.com',
    course: true,
    description: 'Interoception-focused courses and free printables for emotional regulation practice.',
    body: `Kelly Mahler's interoception work: paid courses and a curriculum on developing interoceptive awareness, plus free printables usable in sessions.

## Why it matters at Opal

Interoception underpins much of our emotional-regulation work — this is the most developed practical resource set in that space. Courses are paid; the printables are free.`,
  }),
  ext({
    slug: 'learn-play-thrive',
    title: 'Learn Play Thrive — Neurodiversity-Affirming Trainings',
    publisher: 'Learn Play Thrive',
    url: 'https://learnplaythrive.com/trainings',
    course: true,
    description: 'Neurodiversity-affirming courses for therapists, taught largely by autistic instructors.',
    body: `Learn Play Thrive's training catalogue: neurodiversity-affirming approaches for OT practice, with many courses taught by autistic instructors.

Courses are paid. Use alongside the Autism CRC national guideline — affirming practice and guideline-consistent practice belong together.

## Why it matters at Opal

Practical training for making sessions genuinely affirming rather than nominally so.`,
  }),
  ext({
    slug: 'icdl-dir-floortime',
    title: 'ICDL — DIR/Floortime Courses',
    publisher: 'ICDL',
    url: 'https://www.icdl.com/courses',
    course: true,
    description: 'The official certification pathway for DIR/Floortime.',
    body: `ICDL's course catalogue for DIR and DIRFloortime: the official training and certification pathway for the developmental, individual-differences, relationship-based model.

Courses are paid.

## Why it matters at Opal

If DIR/Floortime informs your paediatric practice, train through the source — and keep intervention claims matched to certification level.`,
  }),
  ext({
    slug: 'sos-approach-feeding',
    title: 'SOS Approach to Feeding',
    publisher: 'SOS Approach to Feeding',
    url: 'https://sosapproachtofeeding.com',
    course: true,
    description: 'Training and resources for the SOS approach to paediatric feeding.',
    body: `The SOS Approach to Feeding: paid practitioner training in the sequential-oral-sensory approach to paediatric feeding difficulties, plus a free resource library for clinicians and families.

## Why it matters at Opal

Feeding referrals demand specific training — SOS is one of the recognised pathways, and its free library is useful even before formal training.`,
  }),
];

// ── 16-18. Mental health, trauma and dementia ───────────────────────────────

const mentalHealth = [
  ext({
    slug: 'mhpod',
    title: 'MHPOD — Mental Health Professional Online Development',
    publisher: 'Australian Government (MHPOD)',
    url: 'https://www.mhpod.gov.au',
    course: true,
    description: 'Free, evidence-based online learning for the Australian mental health workforce.',
    body: `MHPOD: free, evidence-based online professional development for the Australian mental health workforce, spanning dozens of topics with linked resources.

## Why it matters at Opal

Free national infrastructure for building psychosocial practice capability — directly relevant as our caseload includes psychosocial disability. Log modules in your CPD tracker.`,
  }),
  ext({
    slug: 'emerging-minds',
    title: 'Emerging Minds — Child Mental Health Learning',
    publisher: 'Emerging Minds',
    url: 'https://emergingminds.com.au',
    course: true,
    description: 'Free child mental health courses, practice papers and First Nations resources.',
    body: `Emerging Minds' national workforce centre for child mental health: free online courses, practice papers, trauma resources and First Nations materials for practitioners working with children and families.

## Why it matters at Opal

Child mental health runs through paediatric OT whether named or not — this is the free, Australian, practice-focused way to build that capability.`,
  }),
  ext({
    slug: 'emhprac',
    title: 'eMHPrac — Digital Mental Health in Practice',
    publisher: 'eMHPrac',
    url: 'https://www.emhprac.org.au',
    course: true,
    description: 'Free training in digital mental health tools, with short accredited modules.',
    body: `eMHPrac (e-Mental Health in Practice): free training and a directory of Australian digital mental health services and tools, with some accredited modules of around one hour.

The [resources page](https://www.emhprac.org.au/resources) collects printable guides to recommendable digital services.

## Why it matters at Opal

Digital mental health tools are often the most accessible support between sessions, especially for rural participants — this is how to recommend them well.`,
  }),
  ext({
    slug: 'black-dog-institute',
    title: 'Black Dog Institute — Health Professional Education',
    publisher: 'Black Dog Institute',
    url: 'https://www.blackdoginstitute.org.au/education-services/health-professionals',
    course: true,
    description: 'Mental health education for health professionals, with substantial free offerings.',
    body: `The Black Dog Institute's education for health professionals: evidence-based mental health training with a substantial free tier alongside paid programs.

## Why it matters at Opal

Credible, Australian, clinician-oriented mental health education — a strong CPD source for psychosocial capability at no or low cost.`,
  }),
  ext({
    slug: 'phoenix-australia-trauma-training',
    title: 'Phoenix Australia — Trauma Training Catalogue',
    publisher: 'Phoenix Australia',
    url: 'https://education.phoenixaustralia.org/catalog',
    course: true,
    description: 'Paid trauma courses: trauma-informed care, psychological first aid, vicarious trauma and PTSD.',
    body: `Phoenix Australia's education catalogue — the national centre of excellence in posttraumatic mental health. As at August 2026 the catalogue includes Trauma-Informed Care (three hours), Psychological First Aid (three hours), vicarious trauma and PTSD courses.

Courses are paid.

## Why it matters at Opal

Trauma-informed practice is core to community OT, and vicarious trauma training protects the clinician as well as the participant.`,
  }),
  ext({
    slug: 'dementia-training-australia',
    title: 'Dementia Training Australia',
    publisher: 'Dementia Training Australia',
    url: 'https://dta.com.au/online-dementia-courses',
    course: true,
    description: 'Free online dementia courses for the Australian workforce, with certificates.',
    body: `Dementia Training Australia's online courses — free to people in Australia as at August 2026 — covering changed behaviour, delirium, pain, sleep and enabling environments, with completion certificates.

## Why it matters at Opal

Free, high-quality dementia education directly applicable to older-adult and home-environment work. Save certificates to your profile and log the CPD.`,
  }),
];

// ── 19-23. Condition-specific evidence ──────────────────────────────────────

const conditionEvidence = [
  ext({
    slug: 'cerebral-palsy-alliance-training',
    title: 'Cerebral Palsy Alliance — Training and Education',
    publisher: 'Cerebral Palsy Alliance',
    url: 'https://cerebralpalsy.org.au/training',
    course: true,
    description: 'CPA’s professional training on cerebral palsy and disability practice.',
    body: `Cerebral Palsy Alliance's professional training, with the full course list in the [training catalogue](https://training.cerebralpalsy.org.au/catalog). Offerings and pricing vary — check the catalogue for current courses.

## Why it matters at Opal

Specialist CP education from Australia's largest CP service and research organisation, relevant to paediatric and adult caseloads alike.`,
  }),
  ext({
    slug: 'stroke-foundation-guidelines',
    title: 'Stroke Foundation — Clinical Guidelines for Health Professionals',
    publisher: 'Stroke Foundation',
    url: 'https://strokefoundation.org.au/what-we-do/for-health-professionals/clinical-guidelines',
    description: 'The Stroke Foundation’s clinical guideline hub for health professionals.',
    body: `The Stroke Foundation's hub for health professionals: the Australian clinical guidelines for stroke management and supporting professional resources.

## Why it matters at Opal

The entry point for guideline-consistent stroke rehabilitation practice in Australia — pair with the living guidelines on InformMe for the current recommendations.`,
  }),
  ext({
    slug: 'informme-living-stroke-guidelines',
    title: 'InformMe — Living Clinical Guidelines for Stroke Management',
    publisher: 'Stroke Foundation (InformMe)',
    url: 'https://informme.org.au/guidelines/living-clinical-guidelines-for-stroke-management',
    description: 'The continuously updated (living) Australian stroke management guidelines.',
    body: `The living clinical guidelines for stroke management on InformMe — "living" meaning continuously updated as evidence lands, rather than revised in multi-year editions.

## Why it matters at Opal

For stroke work, this is the current answer. Because the guidelines update continuously, always read recommendations live at the source rather than from saved copies.`,
  }),
  ext({
    slug: 'erabi',
    title: 'ERABI — Evidence-Based Review of Acquired Brain Injury',
    publisher: 'ERABI',
    url: 'https://erabi.ca',
    description: 'Evidence summaries and algorithms for moderate to severe acquired brain injury rehabilitation.',
    body: `ERABI's evidence-based review of moderate to severe acquired brain injury rehabilitation — as at August 2026 synthesising more than 1,200 intervention studies into evidence summaries and clinical algorithms.

## Why it matters at Opal

The fastest defensible route from an ABI intervention question to the state of the evidence, without reading the primary literature one trial at a time.`,
  }),
  ext({
    slug: 'scire-professional',
    title: 'SCIRE Professional — Spinal Cord Injury Evidence',
    publisher: 'SCIRE Project',
    url: 'https://scireproject.com',
    description: 'Synthesised spinal cord injury evidence: outcome measures, pressure injuries and equipment.',
    body: `SCIRE Professional synthesises spinal cord injury research for clinicians: evidence chapters, outcome measures, and practice-relevant topics including pressure injuries and equipment.

## Why it matters at Opal

SCI work is high-stakes and specialised — SCIRE keeps our reasoning connected to the evidence, particularly for pressure care and equipment decisions.`,
  }),
];

// ── 24. Outcome measures and evidence databases ─────────────────────────────

const evidence = [
  ext({
    slug: 'sralab-rehab-measures',
    title: 'Rehabilitation Measures Database (SRALab)',
    publisher: 'Shirley Ryan AbilityLab',
    url: 'https://www.sralab.org/rehabilitation-measures',
    description: 'The reference database for rehabilitation outcome measures: psychometrics, scoring and populations.',
    body: `The Shirley Ryan AbilityLab Rehabilitation Measures Database — as at August 2026 covering more than 600 outcome measures with psychometrics, scoring instructions and population applicability.

## Why it matters at Opal

Before administering or citing an outcome measure, check it here: whether it is validated for the population, what the scores mean, and how strong the psychometrics actually are.`,
  }),
  ext({
    slug: 'otseeker',
    title: 'OTseeker — OT Systematic Reviews and Trials',
    publisher: 'OTseeker',
    url: 'https://www.otseeker.com',
    description: 'The OT-specific evidence database — note that coverage from 2016 onward is not comprehensive due to funding constraints, so combine with PubMed and PEDro.',
    body: `OTseeker: the occupational-therapy-specific database of systematic reviews and appraised randomised trials, developed in Australia.

The caveat that matters: as at August 2026, indexing from 2016 onward is not comprehensive because of funding constraints. Treat OTseeker as a starting point for OT-specific evidence and always combine it with PubMed and PEDro for anything recent.

## Why it matters at Opal

Appraised, OT-relevant evidence in one place — provided the coverage caveat travels with every search.`,
  }),
  ext({
    slug: 'pubmed',
    title: 'PubMed',
    publisher: 'National Library of Medicine (US)',
    url: 'https://pubmed.ncbi.nlm.nih.gov',
    description: 'The primary free biomedical literature database.',
    body: `PubMed: the National Library of Medicine's free index of biomedical and life sciences literature — the default comprehensive search for clinical evidence.

## Why it matters at Opal

When the question is "what does the literature actually say", PubMed is the comprehensive backbone that specialist databases sit on top of.`,
  }),
  ext({
    slug: 'cochrane-library',
    title: 'Cochrane Library',
    publisher: 'Cochrane',
    url: 'https://www.cochranelibrary.com',
    description: 'Systematic reviews of health interventions — the top of the evidence hierarchy.',
    body: `The Cochrane Library: systematic reviews of health care interventions, sitting at the top of the evidence hierarchy. As at August 2026, access is free to people in Australia through a national licence.

## Why it matters at Opal

When a Cochrane review exists for your intervention question, it is the strongest single citation a report or clinical decision can lean on.`,
  }),
  ext({
    slug: 'pedro',
    title: 'PEDro — Physiotherapy Evidence Database',
    publisher: 'PEDro, University of Sydney',
    url: 'https://pedro.org.au',
    description: 'Appraised trials and reviews in physiotherapy — heavily overlapping with OT rehabilitation practice.',
    body: `PEDro: the physiotherapy evidence database of appraised randomised trials, systematic reviews and guidelines — free, Australian-built, and heavily overlapping with OT-relevant rehabilitation evidence.

## Why it matters at Opal

For mobility, upper limb and rehabilitation questions, PEDro's quality ratings do the appraisal legwork — and it helps cover OTseeker's post-2016 gap.`,
  }),
];

// ── 25. International CPD platforms ─────────────────────────────────────────

const internationalCpd = [
  ext({
    slug: 'aota-continuing-education',
    title: 'AOTA Continuing Education',
    publisher: 'American Occupational Therapy Association',
    url: 'https://www.aota.org/career/continuing-education',
    authority: 'professional_body',
    course: true,
    description: 'The American OT association’s continuing education catalogue.',
    body: `The American Occupational Therapy Association's continuing education offerings: courses, publications and specialty content from the profession's largest association.

Offerings are paid, with member pricing. Check Australian CPD applicability against the OT Board registration standard when logging hours.

## Why it matters at Opal

Depth on topics where the US literature leads — useful when Australian offerings are thin.`,
  }),
  ext({
    slug: 'medbridge-ot',
    title: 'MedBridge — OT Courses',
    publisher: 'MedBridge',
    url: 'https://www.medbridge.com/educate/occupational-therapy',
    course: true,
    description: 'A large subscription library of video-based OT courses.',
    body: `MedBridge's occupational therapy education library — as at August 2026 more than 1,900 OT courses — delivered by subscription.

## Why it matters at Opal

Volume and convenience for video-based CPD; as with any international platform, translate content to the Australian regulatory and funding context before applying it.`,
  }),
  ext({
    slug: 'occupationaltherapy-com',
    title: 'OccupationalTherapy.com',
    publisher: 'OccupationalTherapy.com (continued.com)',
    url: 'https://www.occupationaltherapy.com',
    course: true,
    description: 'A subscription CPD platform with a large OT course catalogue.',
    body: `OccupationalTherapy.com: a subscription continuing-education platform with — as at August 2026 — more than 600 OT courses across clinical and professional topics.

## Why it matters at Opal

A low-friction way to keep a steady CPD rhythm; log hours against the OT Board standard with a learning goal and reflection as always.`,
  }),
  ext({
    slug: 'ot-potential',
    title: 'OT Potential — Evidence-Based OT',
    publisher: 'OT Potential',
    url: 'https://otpotential.com',
    description: 'An evidence-focused OT podcast, blog and journal club.',
    body: `OT Potential: an evidence-focused OT resource — free podcast and article breakdowns, with a paid club offering structured journal-club CPD.

## Why it matters at Opal

An easy, sustainable way to keep contact with new OT evidence between formal courses; podcast episodes with a documented reflection make honest CPD entries.`,
  }),
  ext({
    slug: 'rcot',
    title: 'RCOT — Royal College of Occupational Therapists',
    publisher: 'Royal College of Occupational Therapists',
    url: 'https://www.rcot.co.uk',
    authority: 'professional_body',
    description: 'The UK professional body: practice guidance, publications and standards.',
    body: `The Royal College of Occupational Therapists — the UK professional body — publishing practice guidance, professional standards and OT publications.

Much material is member-gated; some guidance is openly available.

## Why it matters at Opal

A second professional-body perspective on practice questions, often with well-developed guidance where Australian material is still emerging.`,
  }),
];

// ── Internal guide (collection sort 0) ──────────────────────────────────────

const guide = {
  slug: 'knowledge-library-guide',
  title: 'Using the OT Knowledge Library',
  description: 'How to get the most from the curated external library: badges, filters, the Essentials shortlist and the reporting principle behind it.',
  contentType: 'article',
  authority: 'internal',
  minutes: 4,
  content: `# Using the OT Knowledge Library

The OT Knowledge Library is a curated shelf of external links: official NDIA and NDIS Commission guidance, professional bodies, evidence databases and learning platforms. Nothing in it reproduces external content — every entry points you to the source.

## Authority badges

Every resource carries an authority badge. **Official** marks regulators and government agencies (NDIA, NDIS Commission) — the sources that decide things. **Professional Body** marks associations such as OTA, WAOTA, AOTA and RCOT. **External** marks everything else: research groups, evidence databases and training providers, credible but not authoritative. The badge tells you how much weight a source carries in a funding or regulatory question.

## Free, Paid and origin filters

Library entries are tagged **Free** or **Paid** (resources with a substantial free tier are tagged Free, with paid options noted in the entry), and **Australia** or **International** by origin. Use the Cost filter in the Library to browse only free resources — there are many, and they cover most everyday needs.

## The Essentials shortlist

Eighteen entries are tagged **Essential** and surface first in the collection: the free resources with the highest practical value per minute, from the NDIA's FCA and evidence guidance through to the Rehabilitation Measures Database and the living stroke guidelines. If you read nothing else in the library, read these.

## The reporting principle the library serves

Reflecting current NDIA evidence guidance, strong reports walk one unbroken chain: **diagnosis, then impairment, then functional impact, then support need, then proposed support, then expected functional outcome, then why the support is reasonable and necessary.** The NDIA entries in this library are the official statements of what each link requires; the evidence databases are how the "effective and beneficial" link gets its citations.

## The rule that does not bend

External links are pointers, not copies. For any funding, pricing or regulatory decision, always open the official source and rely on what it says today — never on a summary, a memory or a screenshot.`,
};

// ── Collection ──────────────────────────────────────────────────────────────
// Order defines sort_order: guide (0), the 18-item Essentials shortlist
// (1-18, in the practice owner's stated order), then the remainder grouped by
// section.

const ESSENTIAL_SLUGS = [
  'ndis-functional-capacity-assessments',
  'ndis-supporting-evidence',
  'ndis-therapy-supports',
  'ndis-at-assessment-template',
  'ndis-home-mods-assessments',
  'ndis-commission-worker-training',
  'ota-supervision-framework',
  'autism-crc-guideline',
  'canchild-f-words-training',
  'mhpod',
  'dementia-training-australia',
  'black-dog-institute',
  'emhprac',
  'otseeker',
  'sralab-rehab-measures',
  'erabi',
  'informme-living-stroke-guidelines',
  'indigo-equipment-database',
];

const collection = {
  key: 'knowledge-library',
  name: 'OT Knowledge Library',
  tagline: 'Curated external links, evidence and learning — verified 9 Aug 2026',
  icon: 'book',
  slugs: [
    'knowledge-library-guide',
    ...ESSENTIAL_SLUGS,
    // NDIS core (existing rows cross-listed, not duplicated)
    'what-are-ndis-supports', 'ndis-reasonable-necessary-supports', 'ndis-help-patient-access',
    'ndis-pricing-arrangements-2026-27', 'ndis-support-catalogue-2026-27',
    // Assistive technology
    'ndis-at-assessments', 'ndis-at-evidence-preparation', 'indigo-equipment-database',
    'lifetec-resources', 'lifetec-at-hm-guide', 'at-australia-training', 'arata',
    // Home modifications
    'ndis-home-mods-how-to-provide', 'ndis-home-mods-provider-guide',
    // NDIS Commission
    'ndis-practice-standards', 'ndis-code-of-conduct', 'ndis-worker-orientation-module',
    'ndis-commission-training-your-workers', 'ndis-commission-incident-management',
    // Behaviour support
    'ndis-pbs-capability-framework', 'ndis-specialist-behaviour-support', 'ota-ndis-faq',
    // Home and living
    'ndis-home-and-living',
    // Professional associations
    'ota-workshops-webinars', 'ota-resources-library', 'waota-current-courses',
    // Autism and paediatrics
    'autism-crc-practitioner-elearning',
    'canchild-f-words-hub', 'canchild-f-words-tools', 'canchild-f-words-examples',
    'canchild-f-words-voices', 'canchild-f-words-webinars',
    'star-institute-sensory-health', 'clasi-asi-certificate', 'kelly-mahler-interoception',
    'learn-play-thrive', 'icdl-dir-floortime', 'sos-approach-feeding',
    // Mental health, trauma and dementia
    'emerging-minds', 'phoenix-australia-trauma-training',
    // Condition-specific evidence
    'cerebral-palsy-alliance-training', 'stroke-foundation-guidelines', 'scire-professional',
    // Evidence databases
    'pubmed', 'cochrane-library', 'pedro',
    // International CPD
    'aota-continuing-education', 'medbridge-ot', 'occupationaltherapy-com',
    'ot-potential', 'rcot',
  ].filter((slug, i, arr) => arr.indexOf(slug) === i), // indigo appears in Essentials; keep first occurrence
};

// Section-1 rows also cross-listed into the existing 'ndis' collection
// (rows already in that collection are not re-added by the seed).
const ndisCollectionExtras = [
  'ndis-reasonable-necessary-supports', 'ndis-therapy-supports',
  'ndis-functional-capacity-assessments', 'ndis-supporting-evidence',
  'ndis-help-patient-access',
];

// ── Controlled tags (new categories; seeded idempotently) ───────────────────

const controlledTags = [
  { category: 'cost', name: 'Free' },
  { category: 'cost', name: 'Paid' },
  { category: 'origin', name: 'Australia' },
  { category: 'origin', name: 'International' },
  { category: 'flag', name: 'Essential' },
];

// ── Tag aliases (merged with the seed's existing alias sets — union) ────────

const tagAliases = [
  { category: 'type', name: 'Assessment support',
    aliases: ['outcome measures', 'outcome measure', 'standardised assessment'] },
  { category: 'therapy_area', name: 'Assistive technology',
    aliases: ['NED', 'equipment database'] },
  { category: 'therapy_area', name: 'Home safety',
    aliases: ['home mods', 'home modifications', 'HM assessment'] },
  { category: 'therapy_area', name: 'Sensory processing',
    aliases: ['sensory', 'sensory integration', 'ASI'] },
  { category: 'therapy_area', name: 'Emotional regulation',
    aliases: ['interoception', 'self-regulation', 'self regulation'] },
  { category: 'population', name: 'Children',
    aliases: ['F-words', 'childhood disability', 'ICF'] },
  { category: 'diagnosis', name: 'Neurological Conditions',
    aliases: ['stroke', 'CVA', 'dementia'] },
  { category: 'diagnosis', name: 'Acquired Brain Injury',
    aliases: ['ABI', 'TBI', 'brain injury'] },
  { category: 'diagnosis', name: 'Physical Disability',
    aliases: ['SCI', 'spinal cord injury'] },
  { category: 'diagnosis', name: 'Psychosocial Disability',
    aliases: ['mental health', 'trauma', 'PTSD', 'trauma-informed care'] },
  { category: 'type', name: 'Research article',
    aliases: ['evidence', 'evidence-based practice', 'EBP', 'systematic review'] },
  { category: 'type', name: 'PD video',
    aliases: ['supervision', 'online learning'] },
  { category: 'therapy_area', name: 'Feeding',
    aliases: ['mealtime', 'mealtimes', 'picky eating', 'SOS feeding'] },
  { category: 'therapy_area', name: 'Sleep',
    aliases: ['sleep hygiene', 'bedtime', 'sleep routines'] },
];

// ── Tag links ───────────────────────────────────────────────────────────────
// slug → [[category, name], ...]. Includes cost/origin/flag for every library
// entry (existing cross-listed rows included) plus semantic links into the
// existing R1 vocabulary. Never introduces a parallel canonical.

const FREE = ['cost', 'Free'];
const PAID = ['cost', 'Paid'];
const AU = ['origin', 'Australia'];
const INTL = ['origin', 'International'];
const ESSENTIAL = ['flag', 'Essential'];

const tagLinks = {
  // NDIS core (new)
  'ndis-reasonable-necessary-supports': [FREE, AU, ['type', 'NDIS evidence guide']],
  'ndis-therapy-supports': [FREE, AU, ESSENTIAL, ['type', 'NDIS evidence guide']],
  'ndis-functional-capacity-assessments': [FREE, AU, ESSENTIAL, ['type', 'NDIS evidence guide'], ['type', 'Assessment support']],
  'ndis-supporting-evidence': [FREE, AU, ESSENTIAL, ['type', 'NDIS evidence guide'], ['type', 'Report-writing phrase bank']],
  'ndis-help-patient-access': [FREE, AU, ['type', 'NDIS evidence guide']],
  // NDIS core (existing rows — extra tags only; semantic links already seeded)
  'what-are-ndis-supports': [FREE, AU],
  'ndis-pricing-arrangements-2026-27': [FREE, AU],
  'ndis-support-catalogue-2026-27': [FREE, AU],
  // Assistive technology
  'ndis-at-assessments': [FREE, AU, ['therapy_area', 'Assistive technology'], ['type', 'Assessment support']],
  'ndis-at-assessment-template': [FREE, AU, ESSENTIAL, ['therapy_area', 'Assistive technology'], ['type', 'Assessment support'], ['type', 'Template']],
  'ndis-at-evidence-preparation': [FREE, AU, ['therapy_area', 'Assistive technology'], ['type', 'NDIS evidence guide']],
  'indigo-equipment-database': [FREE, AU, ESSENTIAL, ['therapy_area', 'Assistive technology'], ['therapy_area', 'Equipment prescription']],
  'lifetec-resources': [FREE, AU, ['therapy_area', 'Assistive technology'], ['therapy_area', 'Equipment prescription']],
  'lifetec-at-hm-guide': [FREE, AU, ['therapy_area', 'Assistive technology'], ['therapy_area', 'Home safety']],
  'at-australia-training': [PAID, AU, ['therapy_area', 'Assistive technology'], ['type', 'PD video']],
  'arata': [FREE, AU, ['therapy_area', 'Assistive technology']],
  // Home modifications
  'ndis-home-mods-assessments': [FREE, AU, ESSENTIAL, ['therapy_area', 'Home safety'], ['therapy_area', 'Assistive technology'], ['type', 'Template']],
  'ndis-home-mods-how-to-provide': [FREE, AU, ['therapy_area', 'Home safety'], ['type', 'Assessment support']],
  'ndis-home-mods-provider-guide': [FREE, AU, ['therapy_area', 'Home safety']],
  // NDIS Commission
  'ndis-commission-worker-training': [FREE, AU, ESSENTIAL, ['type', 'PD video']],
  'ndis-commission-training-your-workers': [FREE, AU, ['type', 'PD video']],
  'ndis-commission-incident-management': [FREE, AU, ['type', 'Risk/safety guide']],
  'ndis-practice-standards': [FREE, AU],
  'ndis-code-of-conduct': [FREE, AU],
  'ndis-worker-orientation-module': [FREE, AU, ['type', 'PD video']],
  // Behaviour support
  'ndis-pbs-capability-framework': [FREE, AU, ['diagnosis', 'Behaviour of Concern']],
  'ndis-specialist-behaviour-support': [FREE, AU, ['diagnosis', 'Behaviour of Concern']],
  'ota-ndis-faq': [FREE, AU, ['type', 'NDIS evidence guide']],
  // Home and living
  'ndis-home-and-living': [FREE, AU, ['type', 'NDIS evidence guide'], ['therapy_area', 'Home safety']],
  // Professional associations
  'ota-workshops-webinars': [PAID, AU, ['type', 'PD video']],
  'ota-resources-library': [FREE, AU, ['type', 'PD video']],
  'ota-supervision-framework': [FREE, AU, ESSENTIAL, ['type', 'PD video']],
  'waota-current-courses': [PAID, AU, ['type', 'PD video']],
  // Autism and paediatrics
  'autism-crc-guideline': [FREE, AU, ESSENTIAL, ['diagnosis', 'Autism'], ['population', 'Children'], ['type', 'Research article']],
  'autism-crc-practitioner-elearning': [FREE, AU, ['diagnosis', 'Autism'], ['population', 'Children'], ['type', 'PD video']],
  'canchild-f-words-hub': [FREE, INTL, ['population', 'Children']],
  'canchild-f-words-training': [FREE, INTL, ESSENTIAL, ['population', 'Children'], ['type', 'PD video']],
  'canchild-f-words-tools': [FREE, INTL, ['population', 'Children'], ['type', 'Template']],
  'canchild-f-words-examples': [FREE, INTL, ['population', 'Children'], ['type', 'Case example']],
  'canchild-f-words-voices': [FREE, INTL, ['population', 'Children'], ['type', 'Case example']],
  'canchild-f-words-webinars': [FREE, INTL, ['population', 'Children'], ['type', 'PD video']],
  'star-institute-sensory-health': [PAID, INTL, ['therapy_area', 'Sensory processing'], ['diagnosis', 'Sensory Processing'], ['type', 'PD video']],
  'clasi-asi-certificate': [PAID, INTL, ['therapy_area', 'Sensory processing'], ['diagnosis', 'Sensory Processing'], ['type', 'PD video']],
  'kelly-mahler-interoception': [PAID, INTL, ['therapy_area', 'Emotional regulation'], ['therapy_area', 'Sensory processing'], ['type', 'PD video']],
  'learn-play-thrive': [PAID, INTL, ['diagnosis', 'Autism'], ['type', 'PD video']],
  'icdl-dir-floortime': [PAID, INTL, ['diagnosis', 'Autism'], ['population', 'Children'], ['therapy_area', 'Play skills'], ['type', 'PD video']],
  'sos-approach-feeding': [PAID, INTL, ['therapy_area', 'Feeding'], ['diagnosis', 'Feeding Difficulties'], ['population', 'Children'], ['type', 'PD video']],
  // Mental health, trauma and dementia
  'mhpod': [FREE, AU, ESSENTIAL, ['diagnosis', 'Psychosocial Disability'], ['type', 'PD video']],
  'emerging-minds': [FREE, AU, ['diagnosis', 'Psychosocial Disability'], ['population', 'Children'], ['type', 'PD video']],
  'emhprac': [FREE, AU, ESSENTIAL, ['diagnosis', 'Psychosocial Disability'], ['type', 'PD video']],
  'black-dog-institute': [FREE, AU, ESSENTIAL, ['diagnosis', 'Psychosocial Disability'], ['type', 'PD video']],
  'phoenix-australia-trauma-training': [PAID, AU, ['diagnosis', 'Psychosocial Disability'], ['type', 'PD video']],
  'dementia-training-australia': [FREE, AU, ESSENTIAL, ['population', 'Older adults'], ['diagnosis', 'Neurological Conditions'], ['type', 'PD video']],
  // Condition-specific evidence
  'cerebral-palsy-alliance-training': [PAID, AU, ['diagnosis', 'Cerebral Palsy'], ['type', 'PD video']],
  'stroke-foundation-guidelines': [FREE, AU, ['diagnosis', 'Neurological Conditions'], ['type', 'Research article']],
  'informme-living-stroke-guidelines': [FREE, AU, ESSENTIAL, ['diagnosis', 'Neurological Conditions'], ['type', 'Research article']],
  'erabi': [FREE, INTL, ESSENTIAL, ['diagnosis', 'Acquired Brain Injury'], ['type', 'Research article']],
  'scire-professional': [FREE, INTL, ['diagnosis', 'Physical Disability'], ['therapy_area', 'Equipment prescription'], ['type', 'Research article']],
  // Evidence databases and outcome measures
  'sralab-rehab-measures': [FREE, INTL, ESSENTIAL, ['type', 'Assessment support'], ['type', 'Research article']],
  'otseeker': [FREE, AU, ESSENTIAL, ['type', 'Research article']],
  'pubmed': [FREE, INTL, ['type', 'Research article']],
  'cochrane-library': [FREE, INTL, ['type', 'Research article']],
  'pedro': [FREE, AU, ['type', 'Research article']],
  // International CPD
  'aota-continuing-education': [PAID, INTL, ['type', 'PD video']],
  'medbridge-ot': [PAID, INTL, ['type', 'PD video']],
  'occupationaltherapy-com': [PAID, INTL, ['type', 'PD video']],
  'ot-potential': [FREE, INTL, ['type', 'Research article'], ['type', 'PD video']],
  'rcot': [PAID, INTL, ['type', 'PD video']],
};

// ── Fixed-date PD course listings ───────────────────────────────────────────
// Idempotent by (title, starts_at, source). Times are 9:00 am local (listing
// pages publish dates only); cpd_hours and cost are never fabricated — check
// the registration page. Timezones: Australia/Perth for WAOTA, else the local
// state capital (Sydney observes DST from 4 October 2026).

const OTA_URL = 'https://otaus.com.au/workshops-webinars';
const WAOTA_URL = 'https://waota.com.au/cpd-activity/current-courses';

const pdEvents = [
  {
    title: 'Environmental Home Modifications Basics',
    provider: 'Occupational Therapy Australia',
    description: 'OTA workshop on foundational environmental home modification practice. Dates and pricing at the OTA listing.',
    topic: 'Home modifications',
    startsAt: '2026-08-24T09:00:00+10:00', timezone: 'Australia/Brisbane',
    mode: 'in_person', location: 'Brisbane', registrationUrl: OTA_URL,
  },
  {
    title: 'Environmental Home Modifications Basics',
    provider: 'Occupational Therapy Australia',
    description: 'OTA workshop on foundational environmental home modification practice. Dates and pricing at the OTA listing.',
    topic: 'Home modifications',
    startsAt: '2026-10-09T09:00:00+11:00', timezone: 'Australia/Sydney',
    mode: 'in_person', location: 'Sydney', registrationUrl: OTA_URL,
  },
  {
    title: 'Environmental Home Modifications Basics',
    provider: 'Occupational Therapy Australia',
    description: 'OTA workshop on foundational environmental home modification practice. Dates and pricing at the OTA listing.',
    topic: 'Home modifications',
    startsAt: '2026-11-06T09:00:00+11:00', timezone: 'Australia/Sydney',
    mode: 'in_person', location: 'Wagga Wagga', registrationUrl: OTA_URL,
  },
  {
    title: 'Complex Home Modifications',
    provider: 'Occupational Therapy Australia',
    description: 'OTA workshop on complex home modification assessment and practice. Dates and pricing at the OTA listing.',
    topic: 'Home modifications',
    startsAt: '2026-10-24T09:00:00+11:00', timezone: 'Australia/Sydney',
    mode: 'in_person', location: 'Sydney', registrationUrl: OTA_URL,
  },
  {
    title: 'Self Regulation',
    provider: 'WAOTA',
    description: 'WAOTA course on self-regulation in occupational therapy practice. Details and pricing at the WAOTA listing.',
    topic: 'Emotional regulation',
    startsAt: '2026-08-21T09:00:00+08:00', timezone: 'Australia/Perth',
    mode: 'in_person', location: null, registrationUrl: WAOTA_URL,
  },
  {
    title: 'Introduction to Sleep',
    provider: 'WAOTA',
    description: 'WAOTA introductory course on sleep in occupational therapy practice. Details and pricing at the WAOTA listing.',
    topic: 'Sleep',
    startsAt: '2026-08-28T09:00:00+08:00', timezone: 'Australia/Perth',
    mode: 'in_person', location: null, registrationUrl: WAOTA_URL,
  },
  {
    title: 'OT-Me Hybrid Paediatric',
    provider: 'WAOTA',
    description: 'WAOTA hybrid paediatric course. Details and pricing at the WAOTA listing.',
    topic: 'Paediatrics',
    startsAt: '2026-11-06T09:00:00+08:00', timezone: 'Australia/Perth',
    mode: 'hybrid', location: null, registrationUrl: WAOTA_URL,
  },
  {
    title: 'Hand and Upper Limb',
    provider: 'WAOTA',
    description: 'WAOTA course on hand and upper limb practice. Details and pricing at the WAOTA listing.',
    topic: 'Upper limb',
    startsAt: '2026-11-21T09:00:00+08:00', timezone: 'Australia/Perth',
    mode: 'in_person', location: null, registrationUrl: WAOTA_URL,
  },
  {
    title: 'Basic Home Modifications',
    provider: 'WAOTA',
    description: 'WAOTA course on basic home modifications. Details and pricing at the WAOTA listing.',
    topic: 'Home modifications',
    startsAt: '2027-03-22T09:00:00+08:00', timezone: 'Australia/Perth',
    mode: 'in_person', location: null, registrationUrl: WAOTA_URL,
  },
];

module.exports = {
  resources: [
    guide,
    ...ndisCore,
    ...assistiveTech,
    ...homeMods,
    ...commission,
    ...behaviourSupport,
    ...homeAndLiving,
    ...associations,
    ...autism,
    ...canchild,
    ...paedApproaches,
    ...mentalHealth,
    ...conditionEvidence,
    ...evidence,
    ...internationalCpd,
  ],
  collection,
  ndisCollectionExtras,
  controlledTags,
  tagAliases,
  tagLinks,
  pdEvents,
};
