# Replit run guide

- Preview: `bun run dev` (Express and Vite on port 5000).
- Publish: build with `bun run build`, then run `bun run start`.
- The Express server serves the built frontend in production and exposes `GET`/`POST /api/data`.
- Vite accepts Replit preview hosts and custom domains; `/api/data` has open CORS for external API clients.
- No GenAI key or Chromium install is required to start the frontend or `/api/data`.
