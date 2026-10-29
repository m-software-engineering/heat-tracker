---
"@m-software-engineering/heat-collector": minor
---

Breaking: the Express quick start now enables CORS only on `/ingest`. If a browser app calls the read API directly, add CORS to those routes yourself, ideally behind auth (#165).
