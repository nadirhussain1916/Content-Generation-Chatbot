# ThreadForge

AI-powered content creation and publishing platform. Chat with an AI to create posts for Instagram and TikTok.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + TypeScript + TailwindCSS |
| Backend | Hono.js on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| KV Cache | Cloudflare KV |
| Auth | Clerk |
| AI | OpenAI GPT-4o (text) + DALL-E 3 (images) |
| Publishing | Instagram Graph API + TikTok Content Posting API |

## Project Structure

```
thread-forge/
├── backend/           # Hono.js Cloudflare Worker
│   ├── src/
│   │   ├── index.ts          # Entry + scheduled cron
│   │   ├── types.ts          # Domain types
│   │   ├── middleware/       # Auth (Clerk JWT) + rate limiter
│   │   ├── migrations/       # D1 schema migrations (7 tables)
│   │   ├── db/queries.ts     # Typed D1 query helpers
│   │   ├── services/         # OpenAI, R2, Instagram, TikTok
│   │   └── routes/           # All API routes
│   ├── wrangler.jsonc        # Cloudflare config
│   └── .dev.vars             # Local secrets
└── frontend/          # React + Vite SPA
    ├── src/
    │   ├── pages/            # Landing, Onboarding, Workspace, Thread, Settings
    │   ├── components/       # Sidebar, ChatMessage, PublishBar, etc.
    │   ├── lib/              # api.ts, utils.ts
    │   └── types.ts          # Shared types
    └── .env                  # VITE_CLERK_PUBLISHABLE_KEY
```

## First-Time Setup

### 1. Cloudflare resources (run once from your terminal)

```bash
# Login to Cloudflare
cd backend && npx wrangler login

# Create D1 database
npx wrangler d1 create thread-forge-db

# Create R2 bucket
npx wrangler r2 bucket create thread-forge-assets

# Create KV namespace
npx wrangler kv namespace create TF_KV

# Create KV namespace for development
npx wrangler kv namespace create TF_KV --preview
```

Copy the generated IDs into `backend/wrangler.jsonc` replacing `REPLACE_WITH_YOUR_*`.

### 2. Set secrets

```bash
cd backend

npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put OPENAI_API_KEY
# When you have them:
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put TIKTOK_APP_ID
npx wrangler secret put TIKTOK_APP_SECRET
npx wrangler secret put REPLICATE_API_TOKEN   # for video generation
```

Secrets are already set in `.dev.vars` for local development.

### 3. Run database migrations

```bash
cd backend && npm run dev
# In another terminal:
curl -X GET http://localhost:8787/api/admin/dev-migrate
```

### 4. Run development servers

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open http://localhost:5173

## API Routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/onboarding/bootstrap` | Bootstrap user on load |
| POST | `/api/onboarding/complete` | Create first workspace |
| GET | `/api/workspaces` | List workspaces |
| POST | `/api/workspaces` | Create workspace |
| PATCH | `/api/workspaces/:slug` | Update workspace |
| GET | `/api/workspaces/:slug/threads` | List threads |
| POST | `/api/workspaces/:slug/threads` | Create thread |
| POST | `/api/workspaces/:slug/threads/:id/messages` | Chat + AI |
| POST | `/api/workspaces/:slug/generate/image` | DALL-E 3 image |
| POST | `/api/workspaces/:slug/generate/video` | Replicate video |
| GET | `/api/workspaces/:slug/generate/assets/:id/status` | Asset status |
| GET | `/api/workspaces/:slug/social/connect/instagram` | Instagram OAuth |
| GET | `/api/workspaces/:slug/social/connect/tiktok` | TikTok OAuth |
| POST | `/api/workspaces/:slug/publish/instagram` | Publish to Instagram |
| POST | `/api/workspaces/:slug/publish/tiktok` | Publish to TikTok |
| GET | `/api/workspaces/:slug/publish/status/:id` | Poll publish status |

## Thread State Machine

```
planning → (AI ready) → draft (image) or script_ready (video)
draft → (generate image) → media_pending → ready
script_ready → (generate video via Replicate) → media_pending → ready
ready → (publish) → published
```

## Social Media Setup

### Instagram
- Create a Meta Developer app with Instagram Business permissions
- Add redirect URI: `{BACKEND_URL}/api/workspaces/{slug}/social/callback/instagram`
- Set `META_APP_ID` and `META_APP_SECRET` secrets

### TikTok
- Create a TikTok Developer app with Content Posting API permissions
- Add redirect URI: `{BACKEND_URL}/api/workspaces/{slug}/social/callback/tiktok`
- Verify your R2 public bucket domain in TikTok developer portal
- Set `TIKTOK_APP_ID` and `TIKTOK_APP_SECRET` secrets

## Cron (Token Refresh)

A cron runs every 6 hours to refresh expiring social media tokens:
- Instagram: refreshes long-lived tokens expiring within 8 hours
- TikTok: refreshes access tokens using refresh tokens expiring within 8 hours

Configured in `wrangler.jsonc` under `triggers.crons`.
