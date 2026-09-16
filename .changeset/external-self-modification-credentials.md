---
"eve": minor
---

Replace the Vercel-specific deployed self-modification credential configuration with an application-supplied GitHub credential provider. Generated Vercel setup now writes an inline `@vercel/connect` adapter, while the self-hosted PAT configuration remains available through `{ pat: true }`.
