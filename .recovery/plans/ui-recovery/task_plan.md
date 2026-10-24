# Axiom UI recovery plan

## Goal
Recover an operational UI from evidence-backed source while preserving user-owned work and keeping alternatives isolated. No deployment, push, mock response, or partial restoration is acceptable.

## Phases
- [x] Audit repository state, backups, worktrees, and candidate history.
- [x] Establish isolated recovery alternatives (backup, actual-file, WIP).
- [x] Restore and exercise the real chat, functional navigation/sidebar and documented API surface in the selected recovery candidate.
- [x] Run build, source-script checks, tests and HTTP/API checks; record remaining blockers. No deploy or push.

## Decisions
- Candidate source is `src/web.ts.actual` (828 lines) only as a starting point, completed against the real modules and APIs. Recovery was integrated into the existing primary checkout's `src/web.ts` on branch `audit-ui-components`, preserving the pre-existing uncommitted checkout changes as the baseline diff; the isolated candidate/worktrees remain intact.
- The module-builder chat uses `POST /api/modulos/propuestas/generar`: it gathers real references server-side through the existing Exa integration (or accepts explicit HTTPS references), asks the configured LLM for an implementation, and persists only proposals passing static/type and isolated runtime-contract checks. The UI presents proposal sources and details, supports revalidation, and requires explicit approval before installing a real module disabled by default; no skeleton is presented as a completed implementation.
- Keep the main checkout and other candidate branches untouched. No branch merge or production action.

## Validation limits
- Final build, browser-script checks, function/boundary checks, all 29 tests, and focused loopback HTTP/API checks pass in the primary checkout after integration. Module-builder coverage includes parsing, static/type and isolated runtime-contract validation, tamper-evident persistence, explicit approval, disabled-default installation, enabled runtime loading, replay rejection, and fail-closed provider/config errors.
- A temporary listener served the HTML and real agent/module routes; agent add/link persisted to that temporary root. The proposal API rejects invalid input, and when search or LLM credentials/configuration are absent it returns explicit errors; the client does not display fabricated results. Live reference search and LLM generation, plus a live Telegram Bot API round-trip, remain unverified because credentials are not configured.
- The recovered UI is integrated into the primary checkout as an uncommitted change; it has not been committed, deployed, or visually inspected in a browser.
- `rg` is unavailable; use grep/find. Do not run recovery `assert-serve.sh` in this worktree: its legacy script starts an endless loop, binds a hard-coded port, writes under `/tmp`, and its failure branch uses broad `pkill` patterns.
