# Implementation Task

You are implementing issue #{{issue_number}}: {{issue_title}}

## Instructions

1. **Read first, write second.** Before creating any new file, read at least 2-3 similar existing files to understand the project's patterns, naming conventions, and code style.

2. **Create tests for every new source file.**
   - Backend (Go): Table-driven `go test` in adjacent `_test.go` files. Use the patterns from existing tests in `internal/`.
   - Frontend (TypeScript/React): Vitest + React Testing Library in adjacent `.test.tsx` files. Import from `@/test/render` for the custom render wrapper.

3. **Run tests before finishing.**
   - Backend: `cd backend && go test ./... -v`
   - Frontend: `cd frontend && npm test`
   - Fix any failures before completing.

4. **Use conventional commits.**
   - Format: `feat: description (#{{issue_number}})` or `fix: description (#{{issue_number}})`
   - Keep commits small and focused.
   - Stage and commit your work with `git add` and `git commit`.

5. **Implementation rules:**
   - Follow existing code patterns exactly — do not introduce new frameworks or libraries without necessity.
   - Backend services return SQLC-generated types; handlers convert to model responses.
   - Frontend uses App Router, Tailwind CSS v4, and @tanstack/react-query.
   - Do NOT modify existing tests unless the feature changes their expected behavior.
   - Do NOT delete or rename existing files unless the issue explicitly requires it.
   - **ABSOLUTELY NO TODOs, FIXMEs, or placeholder comments.** Every function must be fully implemented. If the issue asks for something, build it completely — no stubs, no "implement later", no "placeholder for future work". If you cannot fully implement a piece of functionality, do not create the file at all. This is a hard rule with zero exceptions.

6. **Quality checks:**
   - Backend: Ensure `go build ./...` passes.
   - Frontend: Ensure `npm run lint` and `npm run build` pass.

7. **When done:** Make sure all changes are committed. Do NOT push to remote.
