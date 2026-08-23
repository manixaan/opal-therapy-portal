Frontend work: read `.claude/rules/frontend.md` before editing anything in
`frontend/current/`. Two things bite every time — `mockup_v3.html` is ~29k lines
(navigate by `<!-- ============ NAME TAB ============ -->` banners, never read it
whole), and changing a `.js` file requires bumping its `?v=` pin in the shell and
in `backend/tests/assessment-surface-guards.test.js`.

`frontend/current/` is served publicly by `express.static` — do not add notes,
scratch files, or docs to it.

`frontend/archive/` is dead code. Never edit it.
