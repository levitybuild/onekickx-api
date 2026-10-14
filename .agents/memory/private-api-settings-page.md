---
name: Private API settings page
description: Access requirements for the API response control page.
---

The `/set` page is intended for the owner only. Do not link it from the public homepage, and do not treat an unlinked URL as private; its page and update endpoint need access control before they can safely be considered owner-only.

**Why:** The page can change public `/api/data` responses.

**How to apply:** Preserve the no-homepage-link requirement and check that `/set` and its settings endpoint are protected before publishing it as a private control page.
