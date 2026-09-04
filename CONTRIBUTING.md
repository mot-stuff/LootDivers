# Contributing to RARPG

Follow `AGENTS.md` and the active architecture decisions in
`docs/DECISIONS.md`. Those documents take precedence over this workflow guide.

## Work units

Use one narrowly scoped task per branch or isolated worktree. Every task must
state its objective, owner, dependencies, scope, out-of-scope work, acceptance
criteria, testing, and expected systems or files.

Until Phase 0 passes its acceptance gate, do not begin Phase 1 combat or create
production gameplay content.

## Branches

Create branches from the protected default branch using:

```text
phase-0/TASK-P0-###-short-description
feature/TASK-###-short-description
fix/TASK-###-short-description
docs/TASK-###-short-description
```

Use `phase-0/` for the active foundation backlog. Do not mix unrelated tasks in
one branch.

## Reviews

- Changes merge through review after the remote and protection policy is
  configured.
- Architecture changes require a decision record.
- The implementation owner must not be the sole reviewer for important work.
- QA independently verifies acceptance criteria, builds, tests, and runtime
  behavior where applicable.
- Generated outputs and lockfiles must be reviewed with their source changes.

## Verification

Run every check applicable to the task and report exactly what was run. Never
claim unexecuted checks passed. TASK-P0-003 will establish the canonical command
set for formatting, linting, type-checking, tests, browser smoke checks, and
production builds.

Documentation-only changes require link/path review and consistency checks
against `AGENTS.md` and active decisions.

## Source and generated files

- Commit source, schemas, configuration, lockfiles, and reproducible build
  definitions.
- Do not commit dependency folders, build output, test artifacts, editor caches,
  local environment files, logs, or secrets.
- Generated files must identify their source and be reproducible. The content
  pipeline task decides which generated artifacts are committed.
- Use UTF-8 text. Repository text files use LF except PowerShell scripts, which
  use CRLF.

## Binary assets

Keep original asset licenses and provenance. Do not add copyrighted reference
game content.

Large binary assets require an explicit storage decision before commit. Git LFS
is not enabled by default; enable it only after the remote provider, quotas, and
asset workflow are approved. Prefer compressed delivery formats while retaining
appropriate editable source assets outside runtime bundles.

## Commits

Write concise imperative commit subjects and include the task ID when one
exists, for example:

```text
TASK-P0-003 establish browser toolchain
```

Do not rewrite or discard another contributor's work without explicit approval.
