# Assign Learning: Bench-Test Report

## Summary

Ten testers drove the Assign Learning tab on the isolated audit server at localhost:5091, using the real UI, the API and the database. They covered creating inductions, the builder, quizzes and acknowledgements, interactive walkthroughs, assigning and versioning, learner completion, security, the AI assistant, importing and Hub-resource lessons, and accessibility. The foundations are solid:
- Only owners can reach the owner tools.
- Other organisations cannot see or touch this practice's data.
- Typed-in script or markup never runs.
- Quiz answers never reach learners.
- Parallel clicks never create duplicate completions.
- Progress numbers agree across the learner's view, the owner's views and the database.

The serious problems are about whether the records can be trusted and whether an owner's work survives. Reviewers confirmed **133 bugs: 3 critical, 19 high, 52 medium and 59 low**.

**Top 3 to fix first:**
1. **B1:** the builder silently throws away an owner's unsaved work. This is joined by B4 to B7, four other ways to lose builder work.
2. **B2:** "Update to vN" keeps old acknowledgements and quiz passes for changed wording. It can even mark an assignment complete with no action from the employee.
3. **B3:** "Mark as Complete" ticks walkthrough tasks and resources the learner never opened. Linked to this is B9: publishing one custom walkthrough hides all the built-in walkthroughs.

## What was tested

**Create flow and template dialog**
- Four template tiles; closing with X, Cancel, backdrop and Escape: **pass**
- Blank and Standard name screen: focus, 9 categories, empty or whitespace-only name refused, Back keeps the name: **pass**
- Titles with unicode, emoji, right-to-left text, markup or script, quotes, or markdown: **pass** (escaped everywhere)
- Titles over 200 characters: **partial** (cut off silently)
- Double-click, Enter then click, or Enter three times on Create: **pass** (only one created)
- Standard induction content matches the starter template: **pass**
- Standard induction when the second save fails: **fail** (empty leftover inductions)
- Interactive walkthrough create, which opens the workshop dock: **pass**
- Walkthrough with a 2-character name: **fail**
- Walkthrough induction assigned before its walkthrough is published: **fail**
- Dialog focus and Tab trap, background controls reachable, focus returned on close: **fail**
- Accessible names on the Choose buttons: **partial**

**Catalogue**
- Search by title, label, unicode, hostile text and very long queries; focus kept while typing: **pass**
- Search, filter and view mode after reload: **partial** (reset)
- Category filter, Show archived, grid or list, multi-select bar: **pass**
- Escape on the filter popover and card menu; Clear filters: **fail**
- Count wording; long titles on cards: **fail**
- Status words and active/completed counts match the database through assign, cancel and complete: **pass**
- Card menu options by status; Edit, Preview, Assign actions: **pass**
- Browser Back from preview: **partial**
- Archive and unarchive: **pass**; address left on the builder after archiving: **fail**
- Deleting an assigned induction is refused: **pass**
- Duplicate: **pass**; duplicating a 200-character title: **fail**
- Library fails to load, then Retry: **pass**
- Empty-library hero: **pass** (with a mocked empty library)
- Audit entries for every lifecycle action: **pass**

**Builder (curriculum editor)**
- Add, rename, delete and move chapters and lessons with the arrow buttons: **pass**
- All 5 lesson types: **pass**
- Fold state after moving a chapter; whitespace-only chapter title; focus on new items: **fail**
- Drag and drop: lessons upward and across chapters **pass**; dropping onto the next row or the last place **fail**; saved order matches the screen **pass**
- Lesson and chapter keys stay stable through moves, renames and Discard: **pass**
- Limits of 50 chapters, 200 lessons and 30 questions: **partial** (refused only at save)
- Rich text: headings, bold, italic and lists **pass**; Link button and Cmd+K **fail**; Shift+Enter **fail**; clicking in and out without typing **fail** (rewrites the content)
- Markdown display and blocking of javascript: and data: links: **pass**; very long words **fail**
- Save with valid content **pass**; double-click Save **pass**; typing during a save **fail**
- Server errors shown: **partial**
- Discard: **pass**, but it has no confirmation; Undo: **fail**
- Leaving with valid work **pass**; leaving with work the server refuses **fail**; reload or tab close **fail**
- Two tabs (409 conflict shown): **pass**; recovering the second tab's work: **fail**
- Assistant editing the open induction: **fail**
- Preview: **pass**; returning from Preview: **fail**
- Settings and Publish panes: **pass**; Publish button: **fail** (none exists); Assign enabled for content that cannot be saved: **partial**
- Changing a lesson's type: **blocked** (no control exists)
- Builder accessibility: **fail**; touch drag: **fail**

**Quizzes and acknowledgements**
- Server checks on question and option counts, correct-answer range and empty statements: **pass**
- Duplicate options: **partial**; empty option before the correct one: **fail**
- Out-of-range pass marks and over-long text: **fail** or **partial** (changed or cut silently)
- Correct answers hidden from learners (payload, page, preview): **pass**
- Grading on the server: **pass**; null or empty answers **fail**; pass mark 0 **fail**; rounding **partial**
- 10-attempts-per-15-minutes quiz limit and its friendly message: **pass**
- Acknowledgement needs `acknowledged:true`; stored hash matches the statement: **pass**
- Repeat submissions: **partial** (misleading audit rows)
- Editor correct answer after reordering or deleting options: **fail**; new question defaults to option 1: **fail**
- Owner preview grading: **fail**
- Learner player: no pre-ticked answers, Cancel and Confirm, Try again, double-click Submit: **pass**
- Acknowledgement shown word for word: **fail**; focus after "I acknowledge": **fail**
- Quiz fieldset, legend and labels: **pass**

**Interactive walkthroughs and the workshop**
- Every block type, hostile text, picture rules, deleting a 0-step walkthrough refused: **pass**
- Second Finish block allowed: **fail**
- "Just show me" picker and Record steps: **fail**
- Confirm dialogs while the preview is showing: **fail**
- Two tabs, or the assistant, editing the same walkthrough: **fail**
- Duplicate: **pass**; Archive then Restore: **fail**; health report: **partial**
- Learner launch from the tile, moving between tabs, checkpoint and sign-here gates, click-to-advance, pause and resume, finishing ticks the item: **pass**
- Missing control; navigating away mid-tour; phone viewport; focus containment: **fail**
- Finishing from the dashboard; replaying; read_only learner: **fail**
- Built-ins after the first custom walkthrough; custom walkthroughs in everyone's list: **fail**
- Changed wording or answer re-required; checkpoint attempts limited: **fail**
- Owner-only access and other organisations blocked: **pass**

**Assigning and versioning**
- Single, bulk and multi-select assign; review step; skipping duplicates and read-only accounts; parallel assigns: **pass**
- Assign-dialog focus trap and Escape: **pass**; ticking a person with Space loses focus: **fail**
- Due date of today; far-future date; 1900; past dates: **fail**
- Notes over 1000 characters: **fail** (cut off)
- Pinned version unaffected by master edits; versions only created on real changes: **pass**
- Push carrying over quiz and acknowledgement evidence: **fail**
- "Update to vN" label; Publish control: **fail**
- Push while the employee has the player open: **fail**
- Cancel, re-assign after cancel, archived or empty workflows refused: **pass**
- Single-assign route re-issuing completed learning: **fail**
- Assignments monitor and Staff progress match the database: **pass**
- Monitor search by current title; `%` and `_` in search: **fail**
- Notifications open the learning; cancelled ones withdrawn: **fail**
- Owner's own assigned learning reachable: **fail**

**Learner completion and progress**
- Status changes, completion rule, completed date stable, completed learning cannot be undone, parallel completions: **pass**
- Mark as Complete records only items actually done: **fail**
- Optional items completable: **fail**
- Restart: **pass** (evidence deleted by design)
- Reload mid-way: **pass**; reload after opening a resource or walkthrough: **fail**
- Stale second tab resyncs: **fail**
- Demoted read_only user: **fail**
- Failed attempts visible to the owner: **fail**

**Security and access control**
- 33 owner routes: 403 for therapist, admin and read_only; 401 when logged out: **pass**
- Faking the role in a header, query or body: **pass**
- Other organisations: 404 on every id: **pass**
- One employee reading another's assignment, including id variants: **pass**
- Extra fields, `__proto__`, deep nesting, SQL-looking text, oversized bodies: **pass**
- NUL character in text: **fail**
- Stored XSS across 13 screens: **pass**
- Cross-site forms and fetches: **pass**; `Origin: null` allowed: **fail**
- Large body parsed before the login check: **fail**
- Session after logout: **pass**; path traversal: **pass**
- Walkthrough destructive-click guard; backslash image path: **fail**
- Walkthrough edits audited or lock-checked: **fail**

**AI induction assistant**
- Owner-only access; message length checks; conversation isolation, including tools aimed at another organisation: **pass**
- Creating an induction with every lesson type; linking resources and walkthroughs: **pass**
- Large inductions; multi-part requests; Continue: **fail**
- Refusing assign, publish, delete and system-prompt requests: **pass**; off-topic requests: **partial**
- Prompt injection hidden in a lesson body or title: **pass** (relies on the model behaving well)
- Identifiable client data (synthetic): **fail** (accepted and stored)
- Walkthrough anchors: **fail**
- Stop; Try again; failed config: **fail**
- Rate limit: **pass**
- Dock accessibility; over-length input: **fail**
- Audit rows: **pass**

**Import existing and resource links**
- Import permissions; running it twice: **pass**; simultaneous runs: **fail**
- Import keeps path order and items: **pass**; section labels; title matching: **fail**
- Imported Portal and Splose inductions launch their walkthroughs: **fail**
- Picker: typing keeps focus **pass**; only 8 results, ranking, filters, keyboard, offers retired and draft items **fail**
- All 12 content types open from a lesson: **pass**
- Draft, foreign, random or private resources: **fail**
- Library delete in use refused: **pass**; retiring in use: **fail**
- Restore from the recycle bin clears the "removed" flag: **pass**
- Course export or import to a file: **fail** (does not exist)

**UX robustness and two owners**
- Layout at 768 and 1440: **pass**; at 375 on a phone: **fail**
- Night-theme and day-theme contrast: **fail**
- Error and Retry paths for the list, create, assign, staff list, lesson completion and assistant: **pass**
- Leaving when offline or after a 500: **fail**
- Double-clicks everywhere: **pass**
- Deep links from a card: **pass**; preview, tabs and create-dialog addresses: **fail**
- Toasts announced to screen readers: **fail**
- Owner views refresh: **fail**
- Uncaught JavaScript errors from learning code: **pass** (none, apart from B62)

## Broken — needs fixing

### Critical

**B1 — Leaving the builder after a failed save throws away all unsaved work** (critical · Builder save/leave)
- **What happens:** The owner leaves with '← Inductions', a sub-tab or Back, and the save fails. Causes include an unlinked Hub resource, a blank acknowledgement, too many quiz options, a 500, being offline, a 409 conflict, or the induction archived elsewhere. The editor is already closed, everything since the last good save is lost, and the toast says "Open it again to retry", but there is nothing to retry.
- **What should happen:** The owner stays in the builder or the draft is kept.
- **Repro:** Add a chapter, a reading and an empty Acknowledgement, then click '← Inductions' and reopen. The rail is empty.
- **Code:** `resourcehub.js:5694-5713` (laEditorLeave sets `S.la.editor=null` before the save resolves).

**B2 — "Update to vN" keeps old acknowledgements and quiz passes for changed content, and can complete the assignment with no employee action** (critical · Versioning / push-latest)
- **What happens:** Carry-over matches by item key only. A rewritten consent statement shows as already acknowledged, holding the old wording's hash, and cannot be re-acknowledged. A replaced quiz shows "Knowledge check passed". A lesson changed from content to quiz stays complete with no evidence. Removing the remaining items makes the push complete the assignment (`viaVersionPush`). The confirm text says "Completed modules that still exist are kept".
- **What should happen:** Changed acknowledgements and quizzes are required again, or the owner chooses.
- **Repro:** Learner acknowledges V1 and passes the quiz. Owner changes the statement and quiz, assigns someone else to create v2, then clicks Update to v2.
- **Code:** `learning-routes.js:1185-1271`, `recomputeProgress` 237-265, `learning-content.js:239-250` (progressFor); confirm text `resourcehub.js:7287`.

**B3 — "Mark as Complete", and the item-complete API, tick walkthrough tasks and resources the learner never opened** (critical · Learner progress)
- **What happens:** One click records every required reading, task and resource. That includes tasks linked to walkthroughs with checkpoints and sign-offs that were never run, and resources never opened, which get stored as `resource_viewed` evidence and marked complete in the Hub too (11 of 11 in 26 seconds). The owner's view looks identical to genuine completion. A direct POST also works, because the server never checks `tutorial_progress`.
- **What should happen:** A walkthrough task counts only once its walkthrough is completed. Resource evidence is honest.
- **Repro:** Do only the acknowledgement and quiz, then press Mark as Complete. Result: 100%, with no `tutorial_progress` rows.
- **Code:** `resourcehub.js:4095-4110` (alFinish); `learning-routes.js:1422-1475` (no task or walkthrough check).

### High

**B4 — The assistant discards unsaved builder edits** (high · Assistant and builder)
- **What happens:** When the assistant edits the open induction, the builder reloads from the server, drops the owner's unsaved edits and shows "All changes saved". The assistant's write also skips the stale-edit lock. Separately, clicking "Open in the builder →" in the dock switches away from a different induction that has unsaved edits, without asking.
- **What should happen:** Warn, merge or ask first, as the workshop path already does.
- **Repro:** Rename a lesson, then ask the assistant to add a chapter to this induction. Or edit induction A, then click the dock's link to induction B.
- **Code:** `induction-assistant.js:344-347` and 350-354 (no dirty check; compare the workshop branch at 336-338).

**B5 — Anything typed while a save is in progress is wiped when the save returns** (high · Builder save)
- **What happens:** The editor is replaced by the server copy, which loses text typed and lessons renamed during the save, then shows "All changes saved".
- **What should happen:** Later edits stay in the editor and stay marked as unsaved.
- **Repro:** Delay the save by 2-5 seconds, click Save, then type.
- **Code:** `resourcehub.js:5636-5641` (`await laEdit(ed.id)`).

**B6 — No warning and no autosave on reload or tab close** (high · Builder, also the workshop)
- **What happens:** Unsaved builder or workshop edits are lost with no prompt. Code comments describe an autosave timer and save-on-move that do not exist.
- **What should happen:** A beforeunload prompt, autosave or a local draft.
- **Repro:** Add a chapter, then reload.
- **Code:** `resourcehub.js` comments at 5594 and 5654-5657 (no beforeunload); `laCbFlush` at 6092 only tracks the change.

**B7 — A new Acknowledgement, Knowledge check or Hub resource lesson makes the whole draft unsaveable** (high · Builder validation)
- **What happens:** The server rejects the entire draft until the new lesson is filled in ("needs a statement", "needs a question", "needs a linked resource"). Combined with B1, this is the easiest way to lose work.
- **What should happen:** Half-built lessons can be saved and flagged.
- **Repro:** + Add lesson → Acknowledgement → Save.
- **Code:** `resourcehub.js:5916-5927` (laItemAdd); `learning-content.js:141,151,179`.

**B8 — An induction made from the Interactive walkthrough template can be assigned and completed before its walkthrough is published** (high · Create flow)
- **What happens:** The learner gets text saying the tour "opens on the real screens", no launch button, and Mark as Complete, which records the task as done (`progress 100`).
- **What should happen:** Block assigning until the walkthrough is published, or show a working launch button.
- **Repro:** Create from the tile, close the dock without publishing, assign, then open as the learner.
- **Code:** `resourcehub.js:5329-5356`, 4201-4211 (alWalkModule returns null).

**B9 — Publishing one custom walkthrough removes all built-in walkthroughs for every staff member** (high · Walkthrough catalogue)
- **What happens:** The 17-19 built-in walkthroughs drop to 0. Imported Portal and Splose inductions lose their launch buttons ("Open the walkthrough below" with nothing below), and the shelf hides the Import prompt.
- **What should happen:** Built-ins stay until they are seeded or replaced.
- **Repro:** In an organisation that has not imported the built-ins, publish any walkthrough, then call `GET /api/tutorials/catalogue` as a therapist.
- **Code:** `walkthrough-catalogue.js:119`; `walkthrough-routes.js` GET (`seeded: rows.length > 0`); `induction.js:160-163`.

**B10 — Every saved walkthrough appears in every staff member's "Opal Portal induction" and counts toward their totals** (high · Catalogue / My Learning)
- **What happens:** One-off or test tours show as "Not started" for all four roles and inflate the overview totals (a therapist's total was 29).
- **What should happen:** It reaches only the people assigned the induction that uses it, or the owner chooses who sees it.
- **Code:** `workshop.js:267` (all roles by default) plus auto-publish on save; the tutorial catalogue and overview count every published module.

**B11 — Old sign-offs and checkpoint passes satisfy a changed walkthrough** (high · Walkthrough evidence)
- **What happens:** After the owner changes the sign-here wording and the right answer, completing v2 succeeds on the v1 evidence.
- **What should happen:** The learner must sign and pass again.
- **Code:** `tutorial-routes.js:227-236` (checks only `rec.passed` and `rec.type`).

**B12 — Finishing a walkthrough from the dashboard never ticks the induction item** (high · Progress)
- **What happens:** `tutorial_progress` shows completed but the induction item stays at 0%, so the learner has to replay the tour from the tile.
- **Code:** `resourcehub.js` alWalkReturn (only fires when the launch came from the tile, via pendingWalk / alOpenWalk).

**B13 — read_only users are stuck forever at any checkpoint or sign-here step** (high · Walkthrough player)
- **What happens:** Every Check answer returns 403 with no message. Progress is kept only in that browser's storage.
- **Code:** `permissions.js` read_only write block (~496); `workshop.js:267` lets read_only take walkthroughs by default.

**B14 — Workshop confirm dialogs cannot be clicked while the preview is showing** (high · Workshop dock)
- **What happens:** The "Delete this step?" and unsaved-changes confirms sit under the preview's backdrop (z-index 9700 against 10050). Only the keyboard works.
- **Repro:** Open a walkthrough, then click × on a step.
- **Code:** `workshop.js` removeStep/closeDock; `induction.css:8`; `dialog.css:9`.

**B15 — Walkthroughs are unusable on a phone** (high · Player / mobile)
- **What happens:** The shell header widens the page to about 836px, so the card sits off-screen and Next cannot be tapped.
- **Code:** shell header in `mockup_v3.html`; `induction.js` positionOverlay.

**B16 — The "Update to vN" button pushes the unpublished draft, not the version it names** (high · Assignments monitor)
- **What happens:** The button said v2 and the learner went to v3, including a draft-only item.
- **Code:** `resourcehub.js:7379-7380` (label); `learning-routes.js:1207` (ensurePublishedVersion on the draft).

**B17 — No way in the UI to send a correction to people already assigned** (high · Publish tab)
- **What happens:** The Publish pane has only Preview and Assign to people, and its text points to the Assignments tab, which shows only "Cancel assignment". `POST /workflows/:id/publish` exists, but nothing in the UI calls it.
- **Code:** `resourcehub.js:6636-6667`; `learning-routes.js:771`.

**B18 — A quiz's "Correct answer" is a position number, so editing options moves or breaks the answer key** (high · Quiz editor)
- **What happens:** Reordering the options silently makes a different option correct (Gamma becomes Beta). Deleting the correct option leaves the dropdown showing an answer while the stored position is out of range, and Save fails with "needs a correct answer".
- **Code:** `resourcehub.js:6519-6535`, 5581.

**B19 — Keyboard focus drops to the top of the page after almost every action** (high · Accessibility)
- **What happens:** This happens after Add chapter, Move, Add lesson, choosing a lesson type, the card menu, ticking a person in the assign dialog, the learner's "I acknowledge", quiz Submit and Try again, and assistant Send. Text typed next goes nowhere.
- **Code:** `resourcehub.js:5881-5955`, 4144-4146 (render() never restores focus).

**B20 — The assistant's anchor list returns empty names, so it can never build a working highlight or action step** (high · Assistant tools)
- **What happens:** The assistant wrote placeholder targets ("[Practice to confirm: anchor target]"), which were saved and later published.
- **Code:** `induction-assistant-routes.js:455` (`a.name` should be `a.target`); `walkthrough-content.js:233` does not check targets.

**B21 — The assistant spends its step budget on reads, and "Continue" cannot continue** (high · Assistant loop)
- **What happens:** A two-part request, then "Continue", each ran 9 generations (about 450k input tokens) and achieved nothing. Tool context is not saved between messages, so Continue starts again from scratch.
- **Code:** `induction-assistant-routes.js:553-579`, 627-633, 682-687.

**B22 — No handling of replies cut off at the token limit, and no overall time limit** (high · Assistant loop / cost)
- **What happens:** A large-induction request hit the 4096-token cap on all 9 turns, ran for 6.4 minutes, created nothing, and kept running after the browser gave up. Azure's proxy times out at about 230 seconds.
- **Code:** `induction-assistant-routes.js:64-65`, 572-575; `ai-gateway.js:490-492` (stop_reason not passed back); `induction-assistant.js:275`.

### Medium

**B23 — Opening a resource the learner is not allowed to see records it complete while the page says "removed"** — Resource lessons. Happens with draft, rejected or private resources. Code: `resourcehub.js:4245-4253`; `learning-routes.js:492-516` (attachResourceSlugs checks only archived_at).

**B24 — Lessons can point at resources or walkthroughs that do not exist, or belong to another organisation, and the owner is never warned** — Validation, assistant tools. Saving and assigning both succeed. The builder shows "Linked: …" and only the learner sees "removed". These items can still be completed and count toward progress. A malformed walkthrough key is dropped silently. Code: `learning-content.js:140-161` (format check only); `resourcehub.js:6480`; `induction-assistant-routes.js:383,410`.

**B25 — A private (excluded) resource still sends its title-based slug to learners and is not flagged as removed** — Resource lessons. Code: `learning-routes.js` attachResourceSlugs (~492).

**B26 — Retiring a resource used by a live induction is not blocked, although Library delete is** — Resource Hub. Code: `resource-hub-r2-routes.js:1178-1197`.

**B27 — The resource picker shows only 8 of up to 50 results, sorted by last update rather than relevance** — Picker. "Getting Started with the Opal Portal" ranks 15th-16th for "portal". There is no type filter, no paging and no browsing without typing. Code: `resourcehub.js:6493`; `resource-hub-r2-routes.js:643-649`.

**B28 — The picker offers retired and draft resources with no status shown** — Picker. Code: `resource-hub-r2-routes.js:483-485`.

**B29 — Simultaneous "Import existing" runs create duplicate inductions** — Import. Four simultaneous requests made four copies of each (seen twice in the audit log). Code: `learning-routes.js:590-616` (no lock or unique constraint).

**B30 — Import matches by title, so a real learning path is silently skipped when another workflow has the same name** — Import. "New Starter — Occupational Therapist" (18 resources) was never imported, and the banner says "Nothing new to import". Archived workflows also block re-import. Code: `learning-routes.js:593-606`; `resourcehub.js:5297-5300`.

**B31 — In an organisation without the Hub tutorial pages, imported portal steps cannot be launched** — Import. The fallback tasks have no walkthrough key and point the learner elsewhere. Code: `learning-routes.js` ~667-671.

**B32 — Standard induction is created in two requests, so a failed second request leaves empty inductions, one more per retry** — Create. Code: `resourcehub.js:5362-5374` (POST already accepts content).

**B33 — Archiving from the builder leaves the address on the builder, so reload opens an editable archived induction** — Lifecycle. Edits then return 409 and the toast's "retry" can never succeed. Code: `resourcehub.js:6613-6624`; laEdit at 5485 has no archived check.

**B34 — A failed import is silent once the library has items** — Import. Code: `resourcehub.js:4982-4985`, 5290-5299.

**B35 — The create dialog does not take focus, Tab escapes to the page behind, and Enter there navigates away** — Accessibility. Focus is not returned on close. Code: `resourcehub.js:5202-5206`, 5271, 7209-7229.

**B36 — The card ⋮ menu and the Filter popover ignore the keyboard** — Accessibility. Focus does not move into them, there are no arrow keys, and Escape does not close them. Code: `resourcehub.js:5136-5143`, 5111, 7209.

**B37 — Clicking into a rich-text field and out again rewrites and corrupts the stored text** — Rich text. Lines are merged, `*` and `+` bullets, quotes and code fences are broken, and images become "! [image". The induction is also marked as changed. Code: `resourcehub.js:6342-6419` (laRichText, onblur).

**B38 — The acknowledgement statement is not shown word for word, and the editor rewrites the hashed wording** — Acknowledgement. "2 * 3 * 4" displays as "2 *3* 4" in italics, and a trivial edit plus Save changed the stored statement. Code: `resourcehub.js:4299` (mdRender), 6402-6450.

**B39 — The Link button and Cmd+K never link the selected text** — Rich text. The raw URL is inserted at the start of the field instead, and on Mac Cmd+K also opens Global search. Code: `resourcehub.js:6431-6440`.

**B40 — The first click after editing quiz answer options is swallowed, even on Save** — Quiz editor. Code: the options textarea's `onchange=RH2.laCbRender()` (~6513-6527).

**B41 — A new quiz question silently marks option 1 as correct** — Quiz editor. Code: `resourcehub.js:5960`.

**B42 — A pass mark of 0 is impossible, and out-of-range pass marks silently become 80** — Quiz. The UI saves 0 as 80, the grader treats a stored 0 as 80, and the player says "Pass mark is 80%". 101, -5 and blank become 80; 50.5 becomes 50. Code: `learning-content.js:276`; `resourcehub.js:4319, 5521, 5576`.

**B43 — Text over the limits is cut off, and out-of-range minutes are dropped, all silently** — Fields. Titles are cut to 200, descriptions to 1000, bodies to 20,000 (walkthrough bodies to 8000), questions to 1000, options to 300, acknowledgements to 2000 and owner notes to 1000. Minutes of 601 or more are dropped, and 1.5 becomes 1. No input has a maxlength or counter. Code: `learning-content.js:74-80, 143`; `learning-routes.js:317-319, 823`; `walkthrough-content.js:99-113`.

**B44 — "Discard changes" reverts the whole induction without asking** — Builder. Code: `resourcehub.js:6095-6116`.

**B45 — After a 409 conflict, the only way forward throws away the owner's work** — Builder concurrency. The same is true when the induction is archived or deleted in another tab, and when two tabs rename it. Code: `resourcehub.js:5626-5633`, 5715-5720.

**B46 — The builder opened from "+ New induction" has no address of its own, and Preview has none either** — Navigation. A reload loses the builder. Close preview and Back to Learning go to the library, not the builder. Browser Back from the catalogue's preview leaves Assign Learning. Code: `resourcehub.js:5378`/5167 (bypasses the hook in `navigation.js:1155`); laPreview 3997.

**B47 — Unanswered or empty answers are graded as option 1** — Quiz API. `[null,null]`, `''`, `false` and `[]` score correct against option 1, and `true` scores correct against option 2. Code: `learning-content.js:273`.

**B48 — Owner preview marks any quiz answers as passed** — Preview. Code: `resourcehub.js:4166-4170`.

**B49 — After completion, optional sign-off and quiz controls are still shown, but every attempt fails with 409** — Player. Code: `learning-routes.js:1431-1434`; `resourcehub.js:4303-4330`.

**B50 — The owner can be assigned learning but has no My Learning screen** — Self-assignment. Their assignment is reachable only by typing its address, and they get a notification to themselves. Code: `resourcehub.js:440`, 553-561; `/staff` includes owners.

**B51 — Replaying a completed walkthrough drops it back to "in progress"** — Walkthrough progress. Code: `tutorial-routes.js:172-188`.

**B52 — "Just show me" and Record steps capture the whole Resource Hub container and never record the screen** — Workshop. Record steps also stores the screen from before each click, merges different controls, and records its own Stop button. Code: `workshop.js` selectorFor (~938), pickableFrom, onRecordClick.

**B53 — Archived walkthroughs cannot be restored, and inductions then call them "(not imported)"** — Workshop. Code: `workshop.js:138`/234 (includeArchived never requested); `resourcehub.js:5811`.

**B54 — A walkthrough that an induction uses can be deleted or archived, and the induction still assigns** — Linking. The task becomes plain text that can still be completed. Code: `walkthrough-routes.js:461-477`.

**B55 — A new walkthrough cannot be played or previewed until the page is reloaded** — Builder. The "Back to editing" button is also covered. Code: `induction.js:156-160` (catalogueAsked latch).

**B56 — Walkthrough edits overwrite each other: two tabs, or the assistant followed by Save** — Workshop. The dock's advice to "Save" sends the stale copy, wipes the assistant's change and publishes it. Walkthrough saves have no stale-edit check and no audit row. Code: `walkthrough-routes.js:306-354`; `workshop.js:964-990`; `induction-assistant.js:337`.

**B57 — A step whose control is missing shows the previous card for about 2.6 seconds, so a second Next skips it unseen** — Player. A "not on screen" warning from the older step also leaks onto later steps. Code: `induction.js:674-733`, 750.

**B58 — Navigating away mid-tour leaves the spotlight on the wrong screen** — Player. Code: `induction.js` (no hashchange handling).

**B59 — Keyboard focus escapes the walkthrough pop-up, and the workshop step list cannot be used from the keyboard** — Accessibility. Code: `induction.js:430` (no aria-modal or trap); `workshop.js` (no tabindex).

**B60 — Checkpoints allow unlimited attempts** — Walkthrough evidence. A wrong attempt returns the explanation, which often names the right answer; returning it is intended. Attempts made before a progress row exists are not counted. Code: `tutorial-routes.js:335-348`.

**B61 — A custom walkthrough can take a built-in's key, which blocks that built-in from ever being imported** — Workshop API. Code: `walkthrough-content.js:294` (normaliseModuleMeta).

**B62 — A walkthrough target containing a quote throws an uncaught error and the step is skipped** — Player and workshop. Code: `induction.js:294-303`.

**B63 — A due date of today is overdue from 8am Perth time that day** — Due dates. Code: `learning-routes.js:94-100` (stored as UTC midnight).

**B64 — Learning notifications do nothing when clicked, and cancelled ones stay in the list** — Notifications. The update notification does not name the induction. Code: `mockup_v3.html:24810-24870`; `learning-routes.js:1164-1183`, 1250-1258.

**B65 — Pushing an update while the employee has the player open gives a bare "Not found" and only partial progress** — Push / player. Code: `resourcehub.js:4064-4110`; `learning-routes.js:1436-1437`.

**B66 — The single-assign API re-issues completed learning without the reassign flag** — Assign API. The bulk route refuses the same request. Code: `learning-routes.js:812-929` vs 1016-1025.

**B67 — Long unbroken text overflows its box** — Layout. A long owner note on the employee card makes the page scroll sideways on a phone (696-699px). Long titles overflow cards, the builder and the Assignments filter. Long words overflow lesson prose in Preview and the player. Code: `resourcehub.css:760, 778, 1561` (no overflow-wrap).

**B68 — "Stop" in the assistant does not stop the server** — Assistant dock. The induction was still created and the conversation id was lost. Code: `induction-assistant.js:285, 320`; the server has no close handling.

**B69 — The assistant reports edits to a published, assigned induction as "Done" without saying they are an unpublished draft** — Assistant answers. Code: system prompt `induction-assistant-routes.js:108-130`; describeWorkflow.

**B70 — An over-length assistant message is wiped from the box and rejected in a normal-looking reply** — Assistant dock. There is no counter or maxlength. Code: `induction-assistant.js:183-186`, 263, 284-286.

**B71 — Assistant dock accessibility** — No focus on open, unlabelled input, replies not announced, and Escape does nothing. Code: `induction-assistant.js:114-126`, 142, 182-200.

**B72 — On phones the page is 730px wide, so Assign Learning dialogs are cut off, including their close buttons** — Shell header. Code: header icon row in `mockup_v3.html` (~4169-4190); `resourcehub.css:916`.

**B73 — Poor contrast** — Night theme. "Add at least one module…" is at 1.87:1, ribbons at 2.4-2.9:1 and "+ Add lesson" at 2.61:1. Day-theme muted text is 3.07:1. Code: `resourcehub.css:903` (`--rh2-primary` is never defined).

**B74 — Toasts, including the only "Not saved" warning, are not announced to screen readers** — Code: `mockup_v3.html:24001-24021`.

### Low

- **B75 Optional readings and tasks can never be ticked off.** Player; there is no control and the sweep skips them. Code: `resourcehub.js:4097-4103`, 4363.
- **B76 A walkthrough name under 3 characters closes the dialog, loses the name and says "needs a title".** Code: `resourcehub.js:5329-5336`; `walkthrough-content.js:297-298`.
- **B77 A NUL control character in any text field returns a 500.** Affects titles, descriptions, bodies, notes, walkthroughs, search, and (not re-tested) the assistant. Code: `learning-routes.js:45`, `learning-content.js:74`, `walkthrough-content.js:109`.
- **B78 Non-text titles and categories become "[object Object]", "x,y" or "12345", and zero-width (invisible) titles are accepted.** Code: `learning-routes.js:45-49`.
- **B79 "Clear filters" leaves Show archived on, and the open popover covers the empty-state Clear button.** Code: `resourcehub.js:4900`, 5044, 5054-5071.
- **B80 The count reads "1 of 172 induction".** Code: `resourcehub.js:5093-5107`.
- **B81 Duplicating a 200-character title gives an identical title with no "(copy)".** Code: `learning-routes.js:439`.
- **B82 Category handling.** Builder Settings shows "Induction" for a custom category, and an empty category defaults to "induction" on create but "other" on update. Code: `resourcehub.js:6584-6590`; `learning-routes.js:320` vs 389.
- **B83 Skip messages name the person by raw user ID.** Seen for archived workflows. Code: `learning-routes.js:999-1004`; `resourcehub.js:7008-7010`.
- **B84 Misleading walkthrough copy.** The dock says "Not saved yet" for a saved, unpublished draft. The dialog says "Staff see nothing until you publish it", but Save publishes. Errors use internal names such as "highlight step". A second Finish block is allowed. Code: `workshop.js:214, 381-382`; `resourcehub.js:5439`.
- **B85 Dragging a chapter onto the next row does nothing, and a chapter can never be dragged to last place.** Code: `resourcehub.js:6178-6191`.
- **B86 Fold state stays with the position, not the chapter, after a move.** Code: `resourcehub.js:5903-5914`.
- **B87 Save errors are shown one at a time, in server wording, styled grey, and stay after Discard.** Code: `resourcehub.js:6703-6710`.
- **B88 Undo is kept internally but nothing calls it; Cmd+Z does nothing.** Code: `resourcehub.js:5673`.
- **B89 The UI has no limits for 50 chapters, 200 lessons or 30 questions; they fail only at save, and Assign stays enabled.** Code: `learning-content.js:55-68`.
- **B90 Builder accessibility.** Tabs have no tabpanel or arrow keys, drag grips are not focusable, and there is no keyboard or touch way to move a lesson to another chapter. Code: `resourcehub.js:6076-6079`, 6140-6250, 6700.
- **B91 Small builder defects.** The pane heading is stale while typing, the walkthrough task shows a stale "Build one" button plus two edit buttons, a whitespace-only chapter title shows blank, javascript: links are refused with no message, Shift+Enter is lost, and comments claim switching saves.
- **B92 The API drops empty options before checking the correct-answer position, so a different option becomes correct.** Code: `learning-content.js:194-205`.
- **B93 A stale tab is graded against a newer version's questions.** Code: `learning-routes.js:~1458`.
- **B94 Repeat acknowledgement and quiz submissions write misleading audit rows**, and they use up attempts. Code: `learning-routes.js:1474-1527`.
- **B95 The assignment detail panel collapses after "Update to vN".** Code: `resourcehub.js:7261, 7290`.
- **B96 Due dates are barely checked.** The year 275760 gives a 500; 1900, past dates, 0 or `true` (which become 1970) are accepted; 2026-02-30 rolls to 2 March. Code: `learning-routes.js:94-99`.
- **B97 Assigning from the builder after a rename shows the old title, and the Publish pane does not refresh afterwards.** Code: `resourcehub.js:6669-6675`, 6956.
- **B98 Search problems.** Monitor search misses assignees on older version titles, and `%` and `_` act as wildcards in monitor and resource search. Code: `learning-routes.js:1112-1116`; `resource-hub-r2-routes.js:507`.
- **B99 The done screen says "tick Reassign" but has no tick box.** Code: `resourcehub.js:6996-7004`.
- **B100 Archived workflows are missing from the monitor's workflow filter.** Built from la.workflows.
- **B101 Priority is saved but never shown or used, and a mandatory value of "no" counts as true.** Code: `learning-routes.js:824-825`, 951-952.
- **B102 Empty chapters are sent to learners.** Code: `learning-content.js:110-170`.
- **B103 Cancelling twice returns 404, and archiving twice re-stamps the date and writes another audit row.** Code: `learning-routes.js:1164-1183`, 450-458.
- **B104 A stale second tab never refreshes after a 409.** Code: `resourcehub.js:4064-4075`, 4124-4126.
- **B105 The player's address loses the assignment id after opening a resource or pausing or finishing a walkthrough, so reload lands on My Learning.** Code: `resourcehub.js:4286-4288`.
- **B106 The player header loses "by <owner>" after any action.** Code: `learning-routes.js:1383`, ~1545.
- **B107 Failed quiz attempts leave the assignment "Not started" with no activity recorded.** Code: `learning-routes.js:1449-1455`.
- **B108 The card says "required modules" when nothing is required.** Code: `resourcehub.js:3838-3840`, 4463.
- **B109 A user demoted to read_only is stuck forever and drops off Staff progress.** Code: `learning-routes.js:1295`.
- **B110 CORS accepts `Origin: null` with credentials.** The session cookie being SameSite=Lax limits the impact. Code: `server.js:124`.
- **B111 An 8 MB JSON body on /api/learning is parsed before the login check.** Code: `body-limits.js:53`.
- **B112 The destructive-click guard for walkthrough steps can be bypassed with CSS escapes or partial selectors.** Code: `walkthrough-content.js:96-97`.
- **B113 Image and thumbnail paths starting `/\` pass the same-site check.** The image security policy (CSP) still blocks the load. Code: `walkthrough-content.js:131-135`.
- **B114 Audit rows store workflow titles on create and delete**, against the "ids-only" rule. Code: `learning-routes.js:328, 481`.
- **B115 A rejected CORS origin returns 500 instead of 403.** Code: `server.js:125`.
- **B116 Markdown links whose address contains `*` are mangled.** Code: `resourcehub.js:164-170`.
- **B117 The walkthrough health report flags real controls in people.js as "pointing at nothing".** Code: `walkthrough-anchors.js:30-33`.
- **B118 The imported Portal induction makes owner-only and owner/admin walkthroughs required for any role.** Code: `learning-routes.js` ~657.
- **B119 Imported section titles misdescribe their contents** ("Standard" or "Orientation" over policies, raw type names). Code: `learning-content.js:357-378`; `learning-routes.js:574-586`.
- **B120 The importer does not filter archived, deleted or draft resources (confirmed in code only).** Code: `learning-routes.js` ~624-630.
- **B121 The builder hint says reading past a resource lesson records it; it does not.** Code: `resourcehub.js:6553-6555`.
- **B122 The lesson title stays "Hub resource" after choosing a resource.** Code: `resourcehub.js:6000-6007`.
- **B123 The picker search has no label, is not focused on open, and has no arrow-key selection.** Code: `resourcehub.js:6487-6488`.
- **B124 The Hub detail page opened from a lesson sometimes says "Mark complete" after the lesson already recorded it.** Code: `resourcehub.js:4250-4253`.
- **B125 The assistant's "Try again" on an older failure resends the latest message.** Code: `induction-assistant.js:174, 312-318`.
- **B126 A failed assistant config call reads as "not switched on" until reload.** Code: `induction-assistant.js:118-119`.
- **B127 Assistant activity links build their click handler with HTML escaping inside script text.** Safe today because the ids are UUIDs. Code: `induction-assistant.js:167, 169`.
- **B128 Assistant replies show *italic* and `code` as raw characters and mention internal tool names.** Code: `induction-assistant.js:51-74`; system prompt.
- **B129 The owner's Staff progress, Assignments and catalogue go stale and only refresh on a full reload.** Code: `resourcehub.js:5124-5135`.
- **B130 Escape while an assignment is still being sent closes the dialog, and the result is never shown.** Code: `resourcehub.js:6787`, 7219.
- **B131 Save with no changes still sends a save, which makes another tab's next save fail as stale.** Code: `resourcehub.js:6260`.
- **B132 Deep links are handled loosely.** A bad id keeps its address, Assignments and Staff tabs reset on reload, a therapist sees "This action requires one of: owner", and a deleted workflow shows a bare "Not found".
- **B133 Right-to-left override characters in notes and titles are not isolated**, so text can be spoofed. Only owners can write notes.

## Not reproduced / by design

- Malformed JSON error echoing the parser's message: this happens only when NODE_ENV is development; staging and production return no detail.
- Restart deleting acknowledgement and quiz evidence: documented intent, the learner confirms first, and audit rows remain. Whether to keep this is decision D16.
- Calendar and Splose prompts and the daily Snapshot appearing over Assign Learning: deliberate shell behaviour (decision D33).
- Dropping a lesson onto a row inserts it before that row: the documented rule, made confusing only by the missing drop indicator. The chapter drag bug B85 is real.
- Workshop Save also publishing: intended ("Saving IS making it usable"). The lost update in B56 is the defect.
- Wrong checkpoint answers returning the explanation: documented intent. The missing attempt limit is B60.
- Assistant dock floating over the page: an intended floating window. Its accessibility gaps are B71.
- Synthetic touch events not starting a drag: real phones may start a drag on long-press. The missing non-drag alternative is B90.
- Duplicate, Archive and Delete missing from the Assign Learning card menu: by design (decision D29).
- Search matching category labels but not raw category keys: labels only, apparently intentional.
- A selected card hidden by the current search still being assigned: by design per a code comment (decision D29).
- Plain walkthrough "quiz" steps sending answers to the browser: by design (practice questions); only checkpoints are enforced (decision D23).
- read_only accounts missing from the assign picker: intentional (decision D20).

## Not yet decided — needs your call before fixing

**D1. What proves a reading, resource or walkthrough task was done?**
- Options: (a) per-item "Mark read", resources must actually be opened, and walkthroughs verified on the server; (b) keep the one-click sweep for readings only; (c) keep the sweep but label swept items "self-declared" for the owner.
- Recommended: (a) for walkthroughs and resources, and (c) for plain readings. This unblocks B3 and B23.

**D2. When a pushed version changes an acknowledgement, quiz, lesson type or required flag, what carries over? And may a push complete an assignment?**
- Options: (a) carry over only unchanged items, compared by a per-item content fingerprint; (b) always require changed acknowledgements and quizzes again; (c) the owner chooses per push.
- Recommended: (a). A push should never complete an assignment; leave it in progress. This unblocks B2.

**D3. How should publishing work?**
- Options: (a) separate Save draft and Publish, with "update N people in progress" on publish; (b) keep auto-publish but relabel the button "Publish draft and update"; (c) for walkthroughs, also allow a typo fix that does not restart learners.
- Recommended: (a) for both inductions and walkthroughs. This unblocks B16, B17 and B84.

**D4. May an incomplete draft be saved?**
- Options: (a) save drafts leniently and check them only at assign or publish, with a checklist; (b) keep strict saving but never close the builder on a failed save; (c) keep a local draft in the browser.
- Recommended: (a) plus (b). This unblocks B1 and B7.

**D5. What is the save contract?**
- Options: autosave with a debounce; explicit Save plus a blocking prompt on every exit; a local browser draft offered back on reopen.
- Recommended: debounced autosave plus a beforeunload prompt (B6).

**D6. When two tabs, two owners, or the assistant and the owner edit the same item, what wins?**
- Options: (a) optimistic lock everywhere, including assistant tools and walkthroughs, plus "save my version as a copy"; (b) lock the item while it is open; (c) the assistant only proposes changes and the owner applies them.
- Recommended: (a). The assistant should refuse while the builder has unsaved edits. This unblocks B4, B45 and B56.

**D7. Which pass marks are allowed, and how is a score rounded?**
- Options: whole numbers 1-100, refusing anything else; allow 0 to mean "participation only"; compare the raw fraction without rounding.
- Recommended: 0-100 with 0 meaning participation, out-of-range values refused with a message, and raw-fraction comparison (B42).

**D8. What is a quiz's correct answer tied to, and must the owner pick it?**
- Options: a radio button next to each option; stored option ids; force a re-pick whenever the options change. Also: refuse or warn on duplicate options.
- Recommended: a radio per option, an explicit pick required before saving, and a warning on duplicates (B18, B41).

**D9. How should text limits be handled?**
- Options: maxlength plus live counters; the server refuses with a message; raise the limits.
- Recommended: counters plus server refusal, with no silent truncation (B43).

**D10. Which markdown is supported, and is the acknowledgement plain text?**
- Options: document the supported subset and only rewrite a body the owner actually edits; extend the renderer with images, quotes and line breaks. For acknowledgements: plain text shown and hashed exactly as written, or rendered markdown with the hash taken of the rendered text.
- Recommended: rewrite only on real edits, and make acknowledgements plain text shown word for word (B37, B38).

**D11. Can a lesson's type be changed?**
- Options: no (delete and re-add); yes, keeping progress; yes, with a new key so progress resets.
- Recommended: yes, with a new key.

**D12. Should empty chapters reach learners?**
- Options: hide them; block assigning; allow them as headings.
- Recommended: hide them from learners (B102).

**D13. What should Discard and Undo cover?**
- Options: confirm plus the wording "Discard all unsaved changes"; discard per pane; expose Undo.
- Recommended: confirm and rename the button, and expose Undo for deletions (B44, B88).

**D14. Optional items.**
- Questions: can they be completed after the required set is done? Do they count toward the percentage? Should the builder say that if every lesson is optional, all of them count?
- Recommended: allow optional completions after completion without changing status, and add an inline "all optional" notice (B49, B75).

**D15. What happens to an induction made from the Interactive walkthrough template while its walkthrough is unpublished?**
- Options: block Assign until published; publish automatically on first assign; allow assign but only completing the walkthrough completes the task.
- Recommended: block Assign. Also add the category select, and make walkthrough plus induction a single server call (B8).

**D16. Evidence and records.**
- Questions: what should an acknowledgement or quiz record keep? Should restart preserve history? Should every item completion be audited? Can the owner reopen or revoke a completed assignment?
- Options: store the version id, statement text and hash for acknowledgements, and chosen answers plus attempt count for quizzes; soft-reset on restart with history kept; audit every completion; add an owner "Reopen / Revoke with reason" action.
- Recommended: all four.

**D17. Walkthrough evidence when content changes.** Must people sign or pass again when the wording or answer changes?
- Options: whenever the text changes; only when the owner flags a material change; never.
- Recommended: whenever the text changes (B11).

**D18. Who sees a custom walkthrough, and are built-ins always available?**
- Options: walkthroughs private to their inductions unless flagged "show in Portal induction"; a roles and visibility setting in the editor; merge built-ins into the catalogue until a same-key row overrides them, and reserve built-in keys.
- Recommended: private by default, plus merged built-ins and reserved keys (B9, B10, B61).

**D19. Completion model for walkthrough tasks.**
- Questions: must the walkthrough be completed for the current published version? Should finishing it from the dashboard, or having finished it before the assignment, count? Should the owner see step-level progress and people stuck at a gate?
- Recommended: completion of the current version counts wherever it was done, with existing progress credited automatically, and an alert when someone is stuck at a gate (B12).

**D20. read_only accounts and role changes.**
- Questions: may read_only accounts take walkthroughs or learning? What happens to open assignments on demotion, suspension or deactivation? What happens when a step targets a screen the learner's role cannot open, or a learning path's target role does not match the assignee?
- Options: exclude read_only from gated walkthroughs, or allow their progress writes as onboarding does; on demotion, auto-cancel or flag "cannot progress"; skip role-gated steps automatically, or warn at assign time.
- Recommended: allow read_only learning writes, flag affected assignments to the owner, warn about role mismatches at assign time, and split the imported Portal induction by role (B13, B109, B118).

**D21. Reference integrity.**
- Questions: may a walkthrough or resource in use be deleted, archived, retired or made private? What does the learner see? Which resources may an owner link?
- Options: block while in use and list the inductions; allow but waive the lesson with a visible note; notify the owner. For linking: only resources every assignee can read, or warn at assign time.
- Recommended: block, matching Library delete, and filter the picker to resources assignees can read. Also decide whether the lesson keeps the resource's title from authoring time or shows the live title, or "Unavailable" once the resource is gone (B24 to B28, B53, B54).

**D22. Owner self-assignment.**
- Options: exclude owners from the picker; add an "Assigned to you" section for owners; allow only one owner assigning another.
- Recommended: add "Assigned to you" (B50).

**D23. Checkpoint and quiz attempts.**
- Questions: should walkthrough checkpoints share the quiz attempt limit? Should the limit be stored in the database rather than per server process? Should owners see failed attempts and count them as "started"? Do owners need to be told that walkthrough "quiz" steps are only practice?
- Recommended: apply the same per-step limit, count the first attempt as "started" and show attempts, and label practice steps in the workshop (B60, B107).

**D24. What does a due date mean?**
- Options: end of the day in the practice's timezone, with a valid range of today to about 2 years ahead and a "Completed late" chip; or a full date-and-time picker. Past dates: refuse, or warn and confirm.
- Recommended: end of day Australia/Perth, warn on past dates (B63, B96).

**D25. Archiving, cancelling and deleting.**
- Questions: what happens to active assignments when a workflow is archived? Should a cancellation notify the employee and withdraw the original notification? Should re-assigning after a cancel restore the old progress? When may a workflow be deleted (never assigned, never published, or no live or completed assignments)?
- Recommended: leave active assignments in place and show the count in the confirm; send a "withdrawn" notice and dismiss the original; start fresh on re-assign but say so in the cancel confirm; allow deletion only if never assigned, applied in both the UI and the server.

**D26. Mandatory and priority: what do they change?**
- Options: define rules (optional items never overdue, priority sorts lists); or remove the controls.
- Recommended: define the rules, or remove priority (B101).

**D27. Notifications.**
- Question: where should learning notifications link, and should there be overdue or due-soon reminders?
- Recommended: link to the assignment, link the owner's completion notice to the monitor row, and add a daily overdue digest (B64).

**D28. Importing.**
- Questions: how are imports matched to their source? What section labels should they use?
- Options: store a source key with a unique constraint; title matching inside a lock; an explicit "Re-import as copy" and "Update from source". For labels: extend the label map and use the receiving section's label when folding short runs together.
- Recommended: a source key plus a report of skipped items (B29 to B31, B119).

**D29. Catalogue scope and scale.**
- Questions: which actions belong on the Assign Learning card menu? Is the Admin > Learning surface still needed? Should items hidden by search stay in a bulk assign? How should 250+ cards be sorted, paged and attributed? May any owner edit or delete another owner's drafts? Should search, filter and tab state survive reload? Is a 500-row cap with no paging acceptable for the Assignments monitor?
- Recommended: add Duplicate, Archive and Delete draft to the card menu; show "n hidden" for hidden selections; add sorting, pagination and "created by"; keep editing org-wide; keep state in the address; page the monitor on the server.

**D30. Names and categories.**
- Questions: what are the minimum and maximum name lengths? Should duplicate names be allowed? Is category a fixed list or free text?
- Recommended: the same minimum for inductions and walkthroughs, a 200-character counter, a warning on duplicate names, control characters stripped on the server, and a fixed category list validated on the server (B76, B78, B82).

**D31. Template placeholder content.** Can a fresh Standard induction (empty lessons, stock quiz) or assistant placeholder text such as "[Practice to confirm…]" be assigned or published?
- Options: block until filled; warn in the review step; allow.
- Recommended: block while placeholders remain.

**D32. Durations on cards.**
- Options: count required lessons only; show "x min (+y optional)"; give template lessons default minutes; allow decimals or larger caps.
- Recommended: "x min (+y optional)".

**D33. Platform scope.**
- Questions: must the owner builder and the walkthrough player work on phones and tablets? What accessibility standard applies? Should calendar and Splose prompts wait while a builder or dialog is open? If a learner leaves the tour's screen mid-tour, should it pause, re-route or close? Should Record steps actually perform the clicks it records?
- Recommended: tablet and up for authoring, with phone support for the learner and walkthroughs; WCAG 2.2 AA for learner flows first; hold global prompts while editing; pause the tour on navigation; never perform destructive clicks while recording.

**D34. Owner preview.**
- Options: grade preview answers against the draft answer key (owner-only); show the correct answers; keep it but add a banner saying answers are not checked.
- Recommended: grade it (B48).

**D35. Assistant governance.**
- Questions:
  - Should it block identifiable client or clinical data (NDIS numbers, dates of birth, diagnoses, addresses) before it reaches the offshore vendor? This feature runs under the data-residency waiver.
  - Should AI-written content be marked, and need review before it can be assigned?
  - Should deletions need confirmation, a snapshot and Undo?
  - What is the per-message budget for tool calls, tokens and time?
  - Should conversations be resumable after reload, and how long are they kept?
  - Should off-topic requests be refused?
  - Should owner-editable titles be kept out of the system prompt?
  - Should text from resources that admins or therapists wrote be treated as untrusted?
  - Who may see the tutorial overview: owners only, or admins too?
- Recommended: a server-side detector for identifiable data; an AI-authored badge; snapshot plus Undo; separate read and write budgets with a deadline of about 120 seconds; resumable conversations purged after 30 days; refuse off-topic requests; pass the focused item's id only, as data; make the tutorial overview owner-only.

**D36. Hub and induction resource progress.**
- Options: two-way sync; one-way (induction to Hub) as now, documented; inductions ignore the Hub.
- Recommended: one-way, documented.

**D37. Drag behaviour.**
- Options: drop position follows the top or bottom half of the row, with a visible indicator; or always take the target's place.
- Recommended: the top/bottom half with an indicator (B85).

**D38. Export and import of courses to a file.** This does not exist today. A raw copy breaks resource links, because resource ids differ per database, and walkthrough keys resolve only where the walkthrough exists.
- Options:
  - (a) Export JSON that refers to each resource by slug, title and content type, matched on import with a report of unmatched resources before saving.
  - (b) Bundle any custom walkthroughs the course uses, with a key-collision policy of rename, skip or overwrite.
  - (c) Always import as a new draft at v0 with no assignments.
  - (d) Include a format version and checksum.
- Also decide: owner-only and audit-logged; whether quiz answers go into the file.
- Recommended: (a), (b) with rename-on-collision, (c) and (d), owner-only and audited, with quiz answers included in the file.

## Not covered

- **Hosted-file resources (uploaded PDF or DOCX):** the audit database has no file rows.
- **The empty-library "Import existing inductions" button:** the shared library is never empty, so this was checked in code only.
- **The AI assistant generating quizzes:** not tested in the quiz slice. Prompt injection through `search_resources` results was not exploited, to limit AI cost. The assistant-chat NUL case, where some writes may already have happened, was not re-tested.
- **Rate limiting across several server instances on Azure.**
- **Deactivating or suspending users:** not tested, because it would be destructive. Demotion was tested on one account only, via SQL.
- **Real touch devices and real screen readers:** only emulation and accessibility-tree inspection were used. Native drag in the walkthrough rail was inconclusive under automation.
- **Changing a lesson's type:** there is no control for it.
- **Some items confirmed from code but not re-run live:**
  - The Record-steps sub-claims.
  - Missing-control step timing (B57) and navigating away mid-tour (B58).
  - The two-tab "tick Reassign" race (B99) and the stale-tab Escape timing (B130).
  - The importer's handling of archived resources (B120).
  - The owner's self-notification (B50).
  - The assistant-then-Save variant (B56).
  - Builder accessibility details (B90).
- **Outside this tab:** `GET /api/outlook/categories` returns 500 on every portal load, and the shell header overflows at phone width (the cause of B15 and B72).
- **Possible prompt injection seen in test data:** a workflow title created by another tester (a8) contains text addressed to an AI agent, claiming the owner "pre-authorised" it to create inductions. No tester acted on it; it is worth deleting.
- **Test data left behind in the shared audit organisation:** inductions and walkthroughs prefixed `[a1]` to `[a10]`, plus copies of the built-ins imported into both organisations.