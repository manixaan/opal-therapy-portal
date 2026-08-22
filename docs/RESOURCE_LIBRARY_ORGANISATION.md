# Resource Library folders

The Resource Hub Library held roughly seven hundred documents presented as one
list with a search box above it. It now opens onto folders the practice keeps
by hand: the Owner makes them, drops documents into them, and renames or moves
anything at any time.

## What a folder is

A NAVIGATION AID, not storage. Membership lives in
`resource_folder_assignments`, keyed by `resource_id`. No resource id changes,
no blob key is rewritten, no URL, preview, tag, version, favourite or
acknowledgement is touched by filing something. `resources.folder_id` — the
older ingestion grouping that `resources-routes.js` still reads — is not
written to at all.

Two levels deep, deliberately. A tree that can nest forever becomes a file
explorer, which is not what this is.

## Putting documents in

Two doors, one gate:

- **Drag files onto a folder card**, or onto the dropzone inside an open folder.
- **Upload files** button, or right-click a folder → *Upload files here*.

Both land in `POST /api/rh2/library/folders/:id/upload`, which creates the
resource, stores the bytes and files it in one request — so a half-done upload
cannot leave a resource with no document or a document with no home. A file
that is refused leaves no record behind.

Documents arrive **live**: approved and staff-visible, not as a draft awaiting
review. That is a deliberate decision — a folder someone files into is expected
to contain what they just put in it. The governance lifecycle still applies to
resources authored through Admin; it is this door that skips it.

### What is checked

PDF and Word are read in full: structure, encryption, corruption, and a scan of
the text for a person's completed details. A file that looks like somebody's
filled-in form is refused and never stored.

**Excel, PowerPoint and images get a file-type check only.** There is no text
extraction for them, so there is no privacy scan. The upload response says
`privacyScanned: false` rather than implying a check that did not happen. A
spreadsheet containing participant details would upload without challenge —
that is a real limitation, recorded here so nobody has to rediscover it.

Accepted: PDF, DOCX, XLSX, PPTX, PNG, JPG. 25 MB each.

The format is decided from the **filename**, not from what the caller claims,
so a PDF renamed `.xlsx` in the request body cannot skip the PDF gate.

## Renaming and moving

Right-click any folder or document for Rename, Move and Upload. Renaming a
document uses `PATCH /api/rh2/library/resources/:id` rather than the Admin
edit route: a rename is a filing action, so it asks for no change note and
leaves version history and acknowledgements alone.

Bulk moves go through **Select resources** → **Move to folder**, up to 200 at a
time.

## Removing a folder

Never destroys a document. Its contents move to **Needs Review**, which is
created on demand the first time it is needed. Needs Review is hidden from the
folder list while it is empty, and cannot itself be removed.

## Permissions

Browsing is open to anybody who may browse the Resource Hub. Creating,
renaming, removing, uploading and moving are the **Owner's** — an admin is
refused too. Enforced on every route; the client hides the controls as a
courtesy, not as the control.

Folder counts are per reader: the same visibility predicate the resource list
uses is applied to the count, so a therapist is never shown a count they cannot
reach.

## Search is unchanged

Folders narrow the list only when `folderId` is supplied. A plain search spans
the whole library. A reader inside a folder is OFFERED the narrower search and
told which one is in effect.

## This used to organise itself

An earlier version derived the folder tree from document contents and refined
it with a model through the governed AI gateway. **That has been removed at the
practice's request.** The folders it produced are still here and still correct —
they are ordinary rows — but nothing reads a document to decide where it goes
any more.

Removed with it: `resource-library-taxonomy.js`, `resource-library-classifier.js`,
`resource-library-organiser.js`, `resource-library-text.js`, the
`resource_library_classification` AI policy, and the automatic shelving hooks
on resource creation, approval and file upload.

Two tables from migration 039 are now inert and kept only for their record of
how the current folders came about: `resource_classification_runs` and
`resource_semantic_profiles` (the latter was never written to at all).
`resource_assignment_history` is still written, by manual moves.

## Schema

| table | purpose |
|---|---|
| `resource_folders` | the folders. `kind='ingestion'` rows are the older format grouping and are left alone. |
| `resource_folder_assignments` | one folder per resource |
| `resource_assignment_history` | what each move replaced |

## Related but different: "Browse by collection"

The Resource Hub **Home** tab shows curated collections (`resource_collections`)
— reading lists like *Start Here* and *Using Opal*, seeded in code, where one
resource can appear in several. Those are not these folders, and the two are
maintained separately.
