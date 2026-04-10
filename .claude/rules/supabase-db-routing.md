---
description: Route queries to the correct Supabase database — Pipeline-DB vs App-DB
paths:
  - "**/*supabase*"
  - "**/*migration*"
  - "**/*.sql"
  - "pipeline/**"
  - "**/rls*"
---

Two Supabase databases — never mix them up:

- **Pipeline-DB: `wsmnutkobalfrceavpxs`** — Tickets, Workspaces, Projects, task_events (Board/Pipeline)
- **App-DB: `usvzrksqbtwasgvolkyu`** — Aime App-Daten (Newsletter, Entries, etc.)

Tickets and pipeline operations ALWAYS go to Pipeline-DB. Never query tickets from App-DB.
