---
"@m-software-engineering/heat-errors": minor
---

Adds `HEAT_E_COLLECTOR_UNREACHABLE`, shown by the reference dashboard as "Can't reach the collector at {url}." with a Retry button. The repository now ships a self-hosted stack (#24): root `docker-compose.yml` (Postgres + collector on 4000 + dashboard on 3000, pinned GHCR images, hardened), `compose.dev.yml` for local builds, Dockerfiles for the collector and dashboard, and dashboard onboarding (admin token in an HttpOnly cookie, snippet with copy button, live first-event state).
