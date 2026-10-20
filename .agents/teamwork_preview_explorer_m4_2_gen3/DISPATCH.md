## 2026-10-19T06:57:33Z

Investigate Enterprise Managed User (EMU) resolution logic (e.g. `yash.somani@bajajfinserv.in` -> `yash-somani_bflghec`, `GITHUB_USER_SUFFIX="_bflghec"`), team roster file (`people.json`), and GitHub API endpoint specifications for:
1. GET /orgs/3in1-AppFrontEnd
2. GET /orgs/3in1-AppFrontEnd/repos?per_page=10
3. GET /search/users?q=... or GET /users/{username}
4. GET /search/issues?q=type:pr+org:3in1-AppFrontEnd&sort=created&order=desc&per_page=10
Check how team members are matched to GitHub users and how PR queries are constructed in the codebase.

STRICT R3 GUARDRAILS (ZERO MUTATION / STRICTLY READ-ONLY):
All live API operations against GitHub MUST be strictly GET / list / query only.
Zero remote data may be mutated.

Write your findings to /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m4_2_gen3/handoff.md and send a message back to caller (conversation ID: 19f092e0-2bef-4ecd-8e9f-ce470e0ff4c6).
