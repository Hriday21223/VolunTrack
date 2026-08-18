# Contributing

## Workflow

1. **Open an issue** describing the task (bug or feature) before starting work.
2. **Branch, implement, and commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `<type>(<scope>): <short description>` — types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
   Example: `fix(auth): handle expired tokens correctly`.
3. **Open a Draft PR** referencing the issue with `Fixes #N` or `Closes #N`, and keep it as Draft while work is in progress.
4. **Test and verify** the change works (`npm run lint`, `npm run build`, and manual testing), then mark the PR **Ready for Review**.
5. **Merging** requires explicit confirmation before it happens, and automatically closes the linked issue.

## Commands

```bash
npm install
npm run dev       # Vite dev server (client-only, localStorage mode)
npm run backend   # Express API (requires DATABASE_URL — see .env.example)
npm run lint       # eslint .
npm run build      # production build
```

See `CLAUDE.md` for architecture details (client-only vs. server-backed data layers, roles, conventions).

## Security

Do not commit secrets, `.env` files, or credentials. See `SECURITY.md` for the backend security posture (parameterized queries, rate limiting, input validation) — preserve these when touching `server/db.js` or route handlers.
