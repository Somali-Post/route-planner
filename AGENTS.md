# AGENTS

## Repo Structure
- `busmap/`: old prototype reference only.
- `frontend/`: active React/Vite frontend.
- `router/`: isolated OTP2 backend workspace.
- `docs/`: task-specific guidance.

## Scope Rules
- Avoid reading `busmap/` unless explicitly requested.
- Do not inspect `node_modules/`, `dist/`, `.git/`, or build outputs.
- Run frontend commands from `frontend/`.
- Run router commands from `router/`.
- Do not redesign the UI unless explicitly requested.
- Preserve the current Stitch-style frontend overlay.
- Inspect first, edit second.

## Reporting
- Keep final reports short: changed files, build result, issues.
