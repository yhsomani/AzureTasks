## 2026-10-19T05:31:47Z
You are teamwork_preview_explorer_survey_1.
Your working directory is: /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_survey_1
Project root: /Users/yashsomani/Desktop/Asure Bord Project
Target app directory: /Users/yashsomani/Desktop/Asure Bord Project/new-app

MANDATORY FIRST STEP:
Read the user requirements from /Users/yashsomani/Desktop/Asure Bord Project/.agents/ORIGINAL_REQUEST.md verbatim before starting any work.

YOUR MISSION:
Comprehensive Codebase Architecture & Operational Boundaries of new-app/ (Next.js/Node studio).
1. Survey the directory structure, framework setup (Next.js version, router type App vs Pages, React version, Node dependencies).
2. Map the application architecture:
   - Pages / routes / UI views and components.
   - Server Actions / API routes / backend services.
   - Core domain modules (e.g., sprint planning, task studio, work item management, AI logic, prompt engineering, diff viewer, etc.).
   - State management, client/server boundaries, data flow.
3. Analyze operational boundaries and environment configuration:
   - Environment variables required/used (.env.example, config files).
   - Authentication & session management.
   - Error handling, logging, telemetry.
4. Document all user-facing and internal features as an enumerated inventory.

STRICT CONSTRAINTS:
- You are a read-only exploration agent. DO NOT write or modify source code files.
- Strictly ZERO mutation: DO NOT execute any write, create, update, or delete operations.
- DO NOT create or mutate any remote Azure DevOps work items or GitHub records.

OUTPUT:
Write your structured findings to /Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_survey_1/handoff.md with:
- Observation (verified facts with exact file paths and line references)
- Logic Chain (how components link together into end-to-end workflows)
- Caveats (architectural gaps, missing configs, potential risks)
- Conclusion (enumerated feature inventory, architectural summary)
- Verification Method (how you explored and verified each aspect)

Send a message back to the orchestrator when handoff.md is written.
