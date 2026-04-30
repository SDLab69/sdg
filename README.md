# sdg

Web app for a small dog grooming business. Built as a personal project that's also a portfolio piece — a real tool for a real friend's business, replacing a handwritten paper calendar with something digital.

The friend manages around 400 client households and tracks two recurring services per household: a brush + nail trim every 6 months, and a full groom every 12 months. The app preserves her existing operating logic exactly — scheduling unit is the household (not the pet), business runs Monday through Friday, due alerts auto-trigger outreach 6 weeks ahead unless acted on. No surprises, no workflow changes she didn't ask for.

## Features

- Calendar view with drag-and-drop appointment scheduling
- Per-household profile with full pet roster, service history, and upcoming due dates
- Client list with natural-language filtering (Anthropic API, behind a small filter schema)
- Ad hoc services view for one-off appointments outside the recurring cycle
- PWA-ready for iPhone home screen installation

## Stack

- Next.js 14 (App Router) on Node 22 LTS
- TypeScript, Tailwind CSS
- Supabase (Postgres, Auth, RLS) for data
- Anthropic API for LLM-powered filtering
- Playwright for end-to-end tests
- Docker + Caddy on a Hetzner VPS for hosting

## Running locally

Requires Node 22 (a \`.nvmrc\` is checked in).

\`\`\`bash
nvm use            # picks up Node 22 from .nvmrc
npm install
cp .env.example .env.local   # then fill in real values
npm run dev
\`\`\`

The app expects a Supabase project with the schema in \`supabase/migrations/\` applied. Production data is seeded via Supabase MCP rather than committed to this repo, so a fresh local checkout will start with an empty database.

## Status

Active development. The calendar and household profile are working; the client list and ad hoc views are in progress. Deployed at [sdg.sdlab.ai](https://sdg.sdlab.ai).
