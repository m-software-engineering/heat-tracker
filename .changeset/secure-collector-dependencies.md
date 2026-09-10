---
"@m-software-engineering/heat-collector": patch
---

Raise the collector's production dependency security floors, including requiring `mysql2` 3.23.1 or newer so MySQL consumers do not pair the adapter with vulnerable older 3.x releases.
