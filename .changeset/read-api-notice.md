---
"@m-software-engineering/heat-collector": minor
---

**Security notice:** in projectKey mode, read APIs such as `GET /api/projects/<id>/events` answer without a token and return page paths and user agents. Don't expose the collector's read routes to the public internet: put a reverse proxy or your own auth in front of them. Token-required reads land in 0.6.0 (#168).
