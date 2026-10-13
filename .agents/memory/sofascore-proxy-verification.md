---
name: SofaScore proxy verification
description: The required proxy-verification path for the OnekickX data API.
---

`/api/data` must use proxies verified against `https://www.sofascore.com/api/v1/event/16115794/odds/1/all`. Do not add direct upstream fetches to the API result path.

**Why:** The user explicitly requires elite proxies to reach SofaScore; direct requests bypass that qualification and can be denied by upstream network policy.

**How to apply:** Keep the odds endpoint as the scanner's verification target and serve data through the qualified proxy path. Direct fetches may be used for unrelated connectivity checks only.
