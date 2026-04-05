# Coolify Hosting Integration — Design Spec

> **Date:** 2026-04-05
> **Ticket:** Follow-up from T-551
> **Status:** Draft

## Problem

The Just Ship pipeline currently supports two hosting providers for preview URLs: Vercel and Shopify. With Coolify now running on Hostinger VPS for customer project hosting, the pipeline needs to support Coolify as a third provider — including automatic deployments, preview URLs for PR branches, and Board integration.

## Goals

1. `"coolify"` as a valid `hosting.provider` in `project.json`
2. Preview URLs from Coolify PR deployments flow into the Board
3. QA pipeline can run Playwright smoke tests against Coolify previews
4. New projects can be created on Coolify via a script (automation-first)

## Non-Goals

- Coolify server provisioning (already done)
- Coolify UI management (API-only)
- Database provisioning via Coolify (future ticket)

## Architecture

### Flow

```
Developer pushes to PR branch
        │
        ▼
GitHub Webhook → Coolify (auto-deploy)
        │
        ▼
Coolify builds + deploys PR preview
        │
        ▼
Pipeline polls Coolify API for deployment status
        │
        ▼
Preview URL → Board ticket (preview_url field)
        │
        ▼
QA agent runs Playwright against preview URL
```

### project.json Configuration

```json
{
  "hosting": {
    "provider": "coolify",
    "coolify_url": "https://coolify.just-ship.io",
    "coolify_app_uuid": "v7ivmdiih5421n863927r8o0"
  }
}
```

Environment variable `COOLIFY_API_TOKEN` provides auth (never in project.json).

### Files to Create/Modify

#### 1. `pipeline/lib/coolify-preview.ts` (NEW)

Polls Coolify Deployments API for a deployment matching the current branch. Analogous to `vercel-preview.ts`.

```typescript
export async function waitForCoolifyPreview(
  branchName: string,
  config: CoolifyConfig
): Promise<string | null>
```

- Polls `GET /api/v1/applications/{uuid}/deployments`
- Matches deployment by branch/commit
- Returns the deployment URL when status is "finished"
- Returns null on timeout or error
- Graceful failure (never blocks pipeline)

#### 2. `pipeline/lib/config.ts` (MODIFY)

- Add `"coolify"` to hosting provider union type: `"vercel" | "coolify" | "none"`
- Parse `coolify_url` and `coolify_app_uuid` from `hosting` config
- Pass Coolify config to QaConfig

#### 3. `.claude/scripts/get-preview-url.sh` (MODIFY)

Add Coolify branch alongside Vercel:

```bash
if [ "$HOSTING_PROVIDER" = "coolify" ]; then
  # Poll Coolify API for deployment URL
  COOLIFY_URL=$(node -e "..." 2>/dev/null)
  COOLIFY_APP_UUID=$(node -e "..." 2>/dev/null)
  COOLIFY_TOKEN=$(cat /root/.coolify-api/token 2>/dev/null || echo "$COOLIFY_API_TOKEN")
  # Poll deployments endpoint...
elif [ "$HOSTING_PROVIDER" = "vercel" ]; then
  # existing Vercel logic
fi
```

#### 4. `.claude/scripts/coolify-deploy.sh` (NEW)

Script to create a new Coolify project + application via API. Used by `/just-ship-vps` or manual setup.

```bash
# Usage: bash coolify-deploy.sh <repo> <branch> <domain> [env-file]
# Example: bash coolify-deploy.sh yves-s/just-ship-board main board.just-ship.io .env.local
```

Creates project, application, sets env vars, triggers first deployment.

#### 5. `pipeline/lib/qa-runner.ts` (MODIFY)

Add Coolify to the preview URL resolution:

```typescript
if (qaConfig.previewProvider === "coolify") {
  previewUrl = await waitForCoolifyPreview(branchName, qaConfig);
}
```

### Coolify API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/applications/{uuid}` | Get app details + domain |
| GET | `/api/v1/applications/{uuid}/deployments` | List deployments |
| POST | `/api/v1/applications/{uuid}/start` | Trigger deployment |
| POST | `/api/v1/applications/private-github-app` | Create new app |
| POST | `/api/v1/applications/{uuid}/envs` | Set env vars |
| POST | `/api/v1/projects` | Create project |

Auth: `Authorization: Bearer {COOLIFY_API_TOKEN}`

### Preview URL Format

Coolify generates preview URLs for PR branches automatically when "Preview Deployments" is enabled on the GitHub App. The URL format is:

- PR preview: `https://pr-{number}-{app-name}.preview.just-ship.io`
- Production: Custom domain (e.g., `https://board.just-ship.io`)

The wildcard DNS `*.preview.just-ship.io` is already configured.

## Security

- `COOLIFY_API_TOKEN` stored as environment variable, never in code or project.json
- On VPS: token at `/root/.coolify-api/token` (chmod 600)
- Locally: `COOLIFY_API_TOKEN` env var
- API token has root+write+deploy permissions

## Testing

- Unit tests for `coolify-preview.ts` (mock API responses)
- Integration: deploy a test branch, verify preview URL is returned
- E2E: full pipeline run with `hosting.provider: "coolify"`, verify Board gets preview URL
