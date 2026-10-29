---
"@m-software-engineering/heat-collector": patch
"@m-software-engineering/heat-errors": patch
---

Database drivers are now optional peers. Install only the one you use. On Node 20, use `better-sqlite3@11` (#164). A missing driver now fails with `HEAT_E_DB_DRIVER_MISSING` and the install command.
