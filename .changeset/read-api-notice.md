---
"@m-software-engineering/heat-collector": minor
---

**Security notice:** when you embed the collector, read APIs under `/api` are open unless you set `admin.token` or add your own auth. The `heat-collector` binary already sets one. Closed-by-default reads are tracked in #168.
