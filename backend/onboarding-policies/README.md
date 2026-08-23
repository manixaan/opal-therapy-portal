# Opal policy drafts

One plain-text file per Opal-authored document slot in the onboarding library,
named for the slot's catalogue code. 29 of them. `index.js` parses them,
`../scripts/load-policy-drafts.js` loads them as **draft** versions, and
`../scripts/policy-tracker.js` regenerates
[docs/ONBOARDING_POLICY_LIBRARY.md](../../docs/ONBOARDING_POLICY_LIBRARY.md).

Nothing in this directory can publish anything. See the note in `index.js`.

## File format

```
---
code: POL_WHS
title: Work Health and Safety Policy      ← must match the catalogue verbatim
category: WHS                             ← must match the catalogue
tier: 1                                   ← 1, 2 or 3, per the checklist
acknowledgement: yes                      ← must match the catalogue's `ack`
summary: One sentence. Becomes the version summary. Max 2000 characters.
reviewCycleMonths: 12
basis: Semicolon; separated; list of the instruments behind it   (optional)
related: POL_INCIDENT; POL_LONE_WORKER                            (optional)
---
BODY
```

The header is `key: value` lines only — not YAML, and no nesting. `index.js`
throws on a missing key, a duplicate key, a bad tier, an acknowledgement value
that is not `yes`/`no`, or an empty body.

## House style for the body

The body is rendered **escaped, inside `white-space: pre-wrap`** (`.ob-doc` in
`onboarding.css`) and shipped in a starter pack as `text/plain`. So:

- **No markdown.** `**bold**`, `# heading` and `[link](url)` all reach the
  reader as punctuation. The test suite fails the build if any appears.
- **One line per paragraph, unwrapped.** Hard-wrapping at 80 columns looks
  ragged on a phone; `pre-wrap` flows a long line correctly everywhere.
- **Numbered headings** — `1. PURPOSE`, then `3.2` for sub-sections. Capitals
  for top-level headings.
- **`•` for bullets**, matching what `opal-document-builder.js` renders.
- **No tabs, no CRLF, no trailing whitespace.**
- Australian spelling, en-AU, second person. Say what a worker must *do*.

Structure that every file follows: purpose → who it applies to → the substance
→ what to do when it goes wrong → related documents → `DOCUMENT CONTROL`.

## The two placeholder kinds

| | | |
|---|---|---|
| `{{OPAL_ORG_ABN}}` | A fact the portal stores | Substituted from organisation settings at load time. An unresolved tag is written as a visible `[TO CONFIRM: ABN]`, never as a raw token. Only the tags in `index.js`'s `ORG_TAGS` are valid. |
| `[TO CONFIRM: a named WHS contact]` | A decision only the Owner can make | Left in the text deliberately. A policy naming an invented person is worse than one that visibly asks. Counted per document in the tracker. |

Write the marker so it says *what is wanted*: `[TO CONFIRM: acknowledgement
timeframe, commonly 2 business days]` beats `[TO CONFIRM]`.

## What these drafts deliberately do not do

They do not assert a legal position the repository is careful about elsewhere.
`onboarding-catalogue.js` lists the claims that are widely repeated and wrong —
NDIS worker screening as universal, police checks as mandatory, WWCC by job
title, 30 CPD hours, occupational therapists as mandatory reporters. The drafts
follow the catalogue, and where a duty turns on a fact Opal has not recorded
(national vs WA industrial system, registered vs unregistered NDIS provider),
they state both cases and mark the choice `[TO CONFIRM]` rather than guessing.

**Every statutory timeframe and dollar figure still needs checking against the
current instrument before publication.** These are drafts written to be edited,
not a compliance opinion.

## Commands

```bash
node backend/scripts/load-policy-drafts.js                 # dry run
node backend/scripts/load-policy-drafts.js --apply
node backend/scripts/load-policy-drafts.js --apply --only POL_WHS
node backend/scripts/policy-tracker.js --write
cd backend && npx jest tests/onboarding-policy-library.test.js
```
