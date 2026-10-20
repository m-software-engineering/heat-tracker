---
"@m-software-engineering/heat-collector": patch
"@m-software-engineering/heat-sdk": patch
---

Privacy rules: stop dropping a few known non-sensitive names (`primary_key`, `sort_key`, `cache-key`, `publishable_key`, `key_id`, `ticket_id`, `session_count`, `boarding_pass`, `pass_type`). Every other name dropped before still drops, and `signing`/`encryption`/`master`/`shared`/`app`/`consumer` join the `<prefix>key` list.
