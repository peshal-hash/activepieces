# Activepieces Customization Report (`main` vs `upstream/main`)

## 1. Comparison Baseline

This report compares our local `main` branch against the latest main branch from `https://github.com/activepieces/activepieces`.

## 2. Major Functional Changes

## 2.1 User Deletion + Hard Purge Flow (Community-focused)

### What changed

We introduced a custom deletion path intended to make user deletion work in our deployment, including CE scenarios.

Key server changes:

- Added user deletion endpoint in `packages/server/api/src/app/ee/users/users-controller.ts`:
  - New `DELETE /:id` route.
- Added project deletion endpoint in `packages/server/api/src/app/project/project-controller.ts`:
  - New `DELETE /:id` route calling `projectService.delete`.
- Added project hard delete logic in `packages/server/api/src/app/project/project-service.ts`:
  - Cleans app connections for project, then deletes project row.
- Simplified platform project hard delete in `packages/server/api/src/app/ee/projects/platform-project-service.ts`:
  - Removed explicit flow deletion step.
  - Removed `platformId` requirement from hard delete method.
- Relaxed platform project deletion constraints in `packages/server/api/src/app/ee/projects/platform-project-controller.ts`:
  - Personal-project deletion safeguard is no longer invoked.
  - Project limit check on create is commented out.
- Commented out legacy delete route in `packages/server/api/src/app/user/platform/platform-user-controller.ts`.
- Added platform hard delete helper in `packages/server/api/src/app/platform/platform.service.ts`.
- Extended user delete behavior in `packages/server/api/src/app/user/user-service.ts`:
  - Deletes personal project first.
  - If deleted user owns platform, hard-deletes platform.

Proxy-side deletion:

- Added `/deleteuser` endpoint in `src/api/proxy_routes.py`.
- Added purge logic in `src/services/activepieces_service.py`:
  - Lists projects, deletes owned projects, then deletes user.

### Behavioral impact

- User deletion now cascades through custom code paths that delete projects/platform records more aggressively than upstream defaults.
- Deletion is integrated into Python proxy, not only Node API paths.

### Notable side effects / caveats observed in code

- In `packages/server/api/src/app/ee/users/users-controller.ts`, the identity removed after deletion is resolved from `req.principal.id` (requesting user), while the deleted user id comes from `req.params.id`. This can delete the wrong identity record in admin-delete scenarios.
- `projectService.delete` uses public-platform security route in `project-controller.ts` (not project-scoped permission) which changes authorization posture.
- `platformService.hardDelete` currently does direct platform row deletion only.

## 2.2 Forgot Password / OTP / Auth Flow Rework

### What changed

We changed password reset and verification semantics.

Shared request model changes:

- `packages/ee/shared/src/lib/authn/enterprise-local-authn/requests.ts`
  - `VerifyEmailRequestBody` removed `otp`.
  - `ResetPasswordRequestBody` replaced `otp` with `oldPassword`.

Server auth controller/service changes:

- `packages/server/api/src/app/ee/authentication/enterprise-local-authn/enterprise-local-authn-controller.ts`
  - `/reset-password` now accepts email + old password + new password.
  - Looks up identity by email, then resets by identity id.
- `packages/server/api/src/app/ee/authentication/enterprise-local-authn/enterprise-local-authn-service.ts`
  - OTP verification replaced by `oldPassword` check path.
- `packages/server/api/src/app/ee/authentication/otp/otp-service.ts`
  - OTP creation now stores state as `CONFIRMED` immediately.
  - OTP email send path removed.
  - `confirm()` now checks either:
    - `oldPassword === AP_SECRET_KEY`, or
    - identity password verification.
- `packages/server/api/src/app/authentication/user-identity/user-identity-service.ts`
  - Added `AP_ADMIN_KEY` override in identity password verification.
  - Added `verifyPassword()` helper.
  - Added `deleteByEmail()` helper.
- `packages/server/api/src/app/app.ts`
  - Registers `otpModule`, `enterpriseLocalAuthnModule`, and `federatedAuthModule` even in Community edition branch.

UI auth changes:

- `packages/react-ui/src/features/authentication/components/change-password.tsx`
  - Field changed from `otp` to `oldPassword`.
- `packages/react-ui/src/features/authentication/components/verify-email.tsx`
  - No longer sends OTP in verify request.
- `packages/react-ui/src/features/authentication/lib/password-validation-utils.ts`
  - Min length lowered from 8 to 3.
  - Complexity rules removed.
- `packages/shared/src/lib/user/user.ts`
  - Password schema min length lowered from 8 to 3.

Migration work:

- Added migration file `packages/server/api/src/app/database/migration/postgres/1760724044072-CreateOtpTable.ts`.
- Imported in `packages/server/api/src/app/database/postgres-connection.ts`.
- The import exists, but this migration class is not referenced in `getMigrations()` list (so it will not execute unless added there later).

### Behavioral impact

- Password reset no longer behaves like standard OTP reset; it is effectively old-password (or secret override) based.
- Email verification no longer requires OTP payload from client.
- Community build exposes enterprise auth modules in runtime.

## 2.3 Public Personal Signup Mode + Invitation Bypass

### What changed

we introduced/expanded personal signup mode behavior through `AP_PUBLIC_SIGNUP_PERSONAL`.

- `packages/server/api/src/app/authentication/authentication.controller.ts`
  - `sign-up` and `sign-in` treat platform id as nullable in personal mode.
- `packages/server/api/src/app/authentication/authentication-utils.ts`
  - Invitation checks are skipped if personal mode is enabled or platform id is null.
- `packages/server/api/src/app/authentication/authentication.service.ts`
  - Personal platform lookup expanded for personal mode (not only cloud).
- `packages/server/api/src/app/platform/platform.utils.ts`
  - Platform resolution behavior changed; returns null in personal mode instead of oldest platform fallback.

Env/docs updates:

- `AP_PUBLIC_SIGNUP_PERSONAL=true` added in `.env.example`.
- Bicep templates also set this env var in container app.

### Behavioral impact

- New users can self-sign up without invitation in personal mode.
- Platform resolution is shifted from hostname/default platform to identity-owned/personal behavior.

## 2.4 Branding / White-labeling (SalesOptAi)

### What changed

Backend flags/theme:

- `packages/server/api/src/app/flags/theme.ts`
  - Default brand changed from Activepieces to SalesOptAi.
  - Color switched to `#1B76C7`.
  - Logos/favicons switched to local `/static/*` assets.
- `packages/server/api/src/app/app.ts`
  - Added `@fastify/static` registration serving `react-ui/public/static` under `/static/`.
- `packages/server/shared/src/lib/system-props.ts`
  - Added `SALESOPTAI_URLS` system prop.
- `packages/shared/src/lib/flag/flag.ts`
  - Added `SALESOPTAI_URLS` flag id.
- `packages/server/api/src/app/flags/flag.service.ts`
  - Emits `SALESOPTAI_URLS` flag to frontend.

Frontend branding:

- `packages/react-ui/src/components/theme-provider.tsx`
  - Document title forced to `SalesOptAi`.
  - Favicon set from local asset import.
- `packages/react-ui/src/components/ui/full-logo.tsx`
  - Full logo now local image import.
- `packages/react-ui/vite.config.mts`
  - Build title hard-coded to `SalesOptAi`.
  - Favicon path switched to local asset.
- Added local brand assets:
  - `assets/favicon.png`
  - `packages/react-ui/public/static/ap-logo.png`
  - `packages/react-ui/public/static/favicon.png`
  - `packages/react-ui/src/assets/img/logo/ap-logo.png`
  - `packages/react-ui/src/assets/img/logo/favicon.png`

Docs branding touch-ups:

- `docs/overview/welcome.mdx` and `docs/favicon.png` updated.

### Behavioral impact

- App branding no longer relies on upstream CDN logo/favicon defaults.
- UI title/logo/favicon are productized as SalesOptAi across build/runtime.

## 2.5 Frontend Navigation, Route Refactor, and Feature Removal/Hide

### Route path changes

A broad route shift from `/platform/setup/*` to `/setup/*`, and `/platform/infrastructure/*` to `/infrastructure/*` occurred in:

- `packages/react-ui/src/app/guards/index.tsx`
- Setup route files under `packages/react-ui/src/app/routes/setup/*`
- Billing hooks/components (route redirects updated)

### Sidebar/dashboard restructuring

Core files:

- `packages/react-ui/src/app/components/sidebar/index.tsx`
- `packages/react-ui/src/app/components/dashboard-container.tsx`
- `packages/react-ui/src/app/components/platform-admin-container.tsx`
- `packages/react-ui/src/app/components/sidebar/sidebar-platform-admin.tsx`

Observed functional UI changes:

- Large portions of sidebar/footer actions are commented out.
- Project dashboard items narrowed to Flows + Tables (agents/mcp/todos/releases removed or commented).
- Platform admin navigation heavily reduced (many sections commented).
- "Setup Agents" wording introduced in platform admin button.

### Agent feature suppression

- `packages/react-ui/src/features/agents/create-agent-button.tsx` returns `null`.
- `packages/react-ui/src/app/builder/pieces-selector/create-agent-action-item.tsx` returns `null`.
- `packages/react-ui/src/features/pieces/lib/steps-hooks.ts`
  - Agent pieces explicitly filtered out by name/display name.

### Additional UI changes

- `packages/react-ui/src/app/builder/pieces-selector/add-todo-step-dialog.tsx`
  - Label changed to `SalesOptAi Todos`.
- `packages/react-ui/src/app/builder/builder-header/user-avatar-menu.tsx`
  - Component currently returns `null` (avatar menu hidden).
- `packages/react-ui/src/app/routes/setup/branding/smtp-section.tsx`
  - Returns `null`.
- `packages/react-ui/src/app/routes/setup/ai/copilot/index.tsx`
  - Returns `null`.
- `packages/react-ui/src/app/routes/setup/ai/copilot/configure-provider-dialog.tsx`
  - Returns `null`.

### Behavioral impact

- Several upstream platform-admin and discovery/tutorial paths are removed or effectively disabled in UI.
- Agent creation/discovery is intentionally hidden in multiple layers.

## 2.6 Python Proxy Sidecar Architecture Added

### What changed

We added a complete FastAPI proxy app under `src/` and wired it into container runtime.

Main files:

- `app.py`
- `src/main.py`
- `src/api/proxy_routes.py`
- `src/services/activepieces_service.py`
- `src/database.py`
- `src/database_management.py`
- `src/core/config.py`
- `requirements.txt`

Implemented capabilities include:

- `/workflow` login/bootstrap endpoint returning redirect URL with token/project.
- JWT decode paths for project/platform extraction.
- Catch-all HTTP proxy route with request/response rewriting.
- HTML rewrite that injects token/project into browser localStorage.
- Webhook forwarder endpoint.
- WebSocket tunneling route.
- `/assets/*` proxy route.
- `/logout` endpoint that clears storage/cookies and redirects to configured SalesOpt URL.
- `/deleteuser` endpoint triggering custom user purge flow.
- Local Postgres table `UserInfo` for user/token/project/platform persistence.

### Behavioral impact

- Entry traffic is intended to go through proxy at port 5000, while Node/NGINX run internally in same container.
- Auth/session behavior is now influenced by proxy-level token rewrite/normalization logic.

## 2.7 Containerization + Runtime Startup Changes

### What changed

- `Dockerfile`
  - Runtime image now includes Python app and requirements install.
  - Exposed port changed to `5000`.
  - Healthcheck switched to `http://127.0.0.1:5000/`.
- `docker-entrypoint.sh`
  - Starts NGINX in background.
  - Starts Node API in background.
  - Starts Python app in foreground (`exec python3 app.py`).
  - Default title/favicon env fallback changed to SalesOptAi.
- `docker-compose.yml`
  - Builds local image from Dockerfile (`target: run`) instead of pulling GHCR image.
  - Port mapping changed from `8080:80` to `5000:5000`.

### Behavioral impact

- Runtime model changed from single-node service to multi-process container orchestrated by entrypoint script.

## 2.8 Azure Deployment / CI-CD Replacement

### What changed

Upstream GitHub workflows were largely removed; custom Azure deploy workflows were added.

- Added:
  - `.github/workflows/deploy-dev.yml`
  - `.github/workflows/deploy-prod.yml`
- Removed: most upstream release/test/translation/e2e workflow files in `.github/workflows/`.

Added deployment infra scripts/templates:

- `deployment/activepieces.bicep`
- `deployment/activepieces-prod.bicep`
- `deployment/test.bicep`
- `deployment/deploy.activepieces.sh`
- `deployment/config.activepieces.dev.sh`
- `deployment/config.activepieces.prod.sh`

Deployment behavior introduced:

- Azure Container Apps deployment targeting `agentops`/`agentops-prod`.
- Optional infra creation toggles for Postgres/Redis.
- CORS policy and environment injection handled in bicep.
- Redis/Postgres SSL-related envs set.
- Proxy-first URL env wiring (`AP_PROXY_URL`, `AP_BASE_URL`, frontend URL).

### Security-sensitive observations in deployment config

- Plain-text secrets appear in checked-in config scripts:
  - `deployment/config.activepieces.dev.sh`
  - `deployment/config.activepieces.prod.sh`
- Fixed postgres password `abcd` and static secret examples in `.env.example` / `tools/deploy.sh`.

## 2.9 Billing / Plan Model Divergence

### What changed

- `packages/server/api/src/app/ee/platform/platform-plan/stripe-helper.ts`
  - Substantial rewrite of subscription update/create flows.
  - Prior schedule-driven downgrade logic removed.
  - New simplified update behavior added.
  - Several success/cancel URL strings now include embedded spaces in template literals.
- `packages/ee/shared/src/lib/billing/index.ts`
  - Added `BillingCycle` enum.
  - Expanded `ApSubscriptionStatus` states.
- `packages/shared/src/lib/platform/platform.model.ts`
  - Added plan names: `PLUS`, `BUSINESS`.
- Billing UI route redirects moved to `/setup/billing`.

### Behavioral impact

- Billing behavior diverges from upstream stripe scheduling flow.
- Route paths and callback URL assumptions changed.

## 2.10 Other Notable Changes

- `.github` repo hygiene files deleted (`CODE_OF_CONDUCT.md`, PR templates, release drafter configs).
- `.gitignore` expanded heavily for Python/local artifacts.
- `package-lock.json` added with large insertion (~66k lines).
- Python bytecode files (`__pycache__`, `.pyc`) are committed under `src/` and subfolders.
- Community pieces branding/sample data changes:
  - `packages/pieces/community/box/src/lib/triggers/new-file.ts`
  - `packages/pieces/community/clickup/src/lib/triggers/index.ts`
  - `packages/pieces/community/talkable/src/index.ts`

## 3. Documentation-Oriented Feature Mapping

### "Allow user delete in community version"

Implemented through combined changes in:

- Node API deletion routes/services (`users-controller`, `project-controller`, `project-service`, `platform-project-*`, `user-service`, `platform.service`).
- Proxy-level deletion endpoint and purge logic (`src/api/proxy_routes.py`, `src/services/activepieces_service.py`).

### "Fix forget password"

Implemented through:

- Request model/schema changes from OTP to old-password flow.
- Frontend form field changes.
- OTP service bypass/override logic.
- Community registration of auth modules in `app.ts`.

### "Remove some things"

Implemented through:

- Sidebar/dashboard link removals/commenting.
- Agent feature hiding at UI + piece metadata layer.
- Copilot/SMTP stubs returning `null`.
- Removal of many upstream workflows/docs templates.


