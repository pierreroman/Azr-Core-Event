# Architecture

## Production private API topology

Production migrated on October 29, 2026:

```text
Browser -> Static Web Apps -> APIM Standard v2 -> Function private endpoint
                                                    |
                                               Storage / Cosmos DB
```

The website remains public at https://azureinfrasummit.com. Its same-origin
`/api/*` proxy now uses `apim-summit-655zgsp5au6gu`, which validates the linked
SWA token/subscription and authenticates privately to `azfn655zgsp5au6gu` using
a dedicated managed identity. Function and Storage public network access are
explicitly Disabled. Trusted SWA user IDs and roles remain separate from the
gateway's machine identity, preserving favorites partitions and authorization.

See the [private API migration runbook](private-api-migration.md) for live
acceptance evidence, private deployment requirements, limitations and rollback.
The deployment itself does not prove that the S360 scanner has closed its flag.

## Reproducible new-site deployment

The same private topology is the **default for new environments**.
[deploy.ps1](../deploy.ps1) orchestrates identity setup, `azd provision`, private
API deployment, static frontend publication, checks and agent teardown. Legacy
`direct`, `prepare` and `gateway` stages are explicit migration options only.

```text
Operator -> Azure management / Graph -> Bicep + dedicated backend app
Operator -> Azure Run Command -> temporary private Linux deployment VM
                                  -> private Blob + Function SCM / OneDeploy
Operator -> pinned SWA CLI -> static frontend
```

The VM has no public IP/password/inbound access and joins the existing private
endpoint subnet. It uses a system-assigned identity with resource-scoped
deployment permissions, validates private DNS/TLS and Disabled public access,
builds the API using its committed lockfile, and verifies the actual SCM result.
Only allowlisted source is transferred; tokens and keys are not printed.
Deployment write roles are scoped to the Function and Storage; a resource-group
Reader assignment supports the agent's network/resource verification.
Ownership snapshots and ARM operation evidence constrain cleanup to the exact
VM/NIC/OS disk/NSG/roles. Cleanup resets the private-deployment approval flag.

Fresh infrastructure creates empty `VideoSchedule`, `Speakers`, `Sponsors`,
content/image/deployment containers and `event/favorites`. Default branding,
disabled registration and sample About/Code of Conduct are returned by the API
until an invited administrator saves configuration. No production content,
favorites, custom domains or role assignments are cloned.

See [Deployment](deployment.md) for permissions, costs, retry/cleanup and manual
acceptance. The new orchestration is offline-tested; a fresh Azure bootstrap is
not yet live-verified.

## Azure Resources

| Resource | Type | Purpose |
|----------|------|---------|
| Static Web App | Azure Static Web App (Standard) | Hosts frontend HTML/CSS/JS, manages Entra ID auth |
| Function App | Azure Function App (Flex Consumption, Node.js 20) | REST API backend |
| API Management | Standard v2 | Public authenticated SWA gateway with outbound VNet integration |
| Storage Account | Azure Storage Account (Standard_ZRS) | Table Storage + Blob Storage |
| Cosmos DB | Azure Cosmos DB (Serverless, SQL API) | Per-user favorites — partition key `/userId` |
| Virtual Network | Azure VNet (10.0.0.0/16) | Network isolation for Function App and Storage |
| Private Endpoints | Azure Private Endpoints | Private connectivity to Function/SCM and Blob, Table, Queue storage |
| Private DNS Zones | Azure Private DNS | DNS resolution for private endpoints |
| User-Assigned Managed Identity | Managed Identity | RBAC access from Function App to Storage and Cosmos DB |
| Gateway Managed Identity | Managed Identity | Dedicated Entra backend authentication; no Storage/Cosmos data roles |
| Application Insights + Log Analytics | Monitoring | Logging and diagnostics |
| Resource Group | Resource Group | Contains all resources |

---

## Data Storage (Azure Table Storage)

### VideoSchedule Table

| Field | Type | Description |
|-------|------|-------------|
| partitionKey | string | Date (YYYY-MM-DD) |
| rowKey | string | Session ID (sess_*) |
| videoId | string | YouTube video ID |
| title | string | Session title |
| description | string | Full description |
| url | string | YouTube URL |
| startTime | string | ISO 8601 datetime |
| duration | number | Duration in seconds |

### Speakers Table

| Field | Type | Description |
|-------|------|-------------|
| partitionKey | string | "speaker" |
| rowKey | string | Speaker ID (name-slug) |
| name | string | Display name |
| title | string | Job title |
| company | string | Company name |
| bio | string | Biography |
| headshotFile | string | Image filename in `speakerheadshots` container |
| linkedin | string | LinkedIn URL |
| twitter | string | Twitter/X URL |
| sessionIds | JSON string | Array of session IDs |

### Sponsors Table

| Field | Type | Description |
|-------|------|-------------|
| partitionKey | string | "sponsor" |
| rowKey | string | Sponsor ID (name-slug) |
| name | string | Sponsor display name |
| logoFile | string | Image filename in `sponsorlogos` container |
| tier | string | Tier level (platinum/gold/silver/bronze/community) |
| website | string | Sponsor website URL |
| description | string | Markdown description |
| sortOrder | string | Sort priority (lower = first) |
| enabled | string | "true"/"false" for public visibility |

---

## Per-user State (Azure Cosmos DB)

Favorites are stored in a separate Cosmos DB account (Serverless, SQL API) so that
per-user writes scale independently of the read-mostly Table Storage data.

- **Account:** `azcos<resourceToken>` — capacity mode **Serverless**, `disableLocalAuth: true`, `publicNetworkAccess: Enabled` (data-plane RBAC is the access boundary)
- **Database:** `event`
- **Container:** `favorites`, partition key `/userId`

### `favorites` document shape

| Field | Type | Description |
|-------|------|-------------|
| id | string | Same as `sessionId` (one doc per favorite) |
| userId | string | SWA per-provider hashed user ID from `x-ms-client-principal.userId` |
| sessionId | string | Session ID being favorited |
| addedAt | string | ISO 8601 timestamp |

Reads are scoped by partition key, so the working set per user stays in a single physical partition. The `/api/favorites/merge` endpoint caps payloads at 500 items and 200 characters per ID to limit Request Unit cost from rogue clients.

---

## Blob Storage Containers

| Container | Access | Purpose |
|-----------|--------|---------|
| `speakerheadshots` | Private | Speaker headshot images (served via API) |
| `sponsorlogos` | Private | Sponsor logo images (served via API) |
| `sitecontent` | Private | Markdown content (about, code-of-conduct, registration config) |
| `deployments` | Private | Flex Consumption Function App deployment packages |

---

## Performance & Scalability

- **In-Memory API Caching** — Public content/config GET endpoints use a shared cache module ([`api/src/shared/cache.js`](../api/src/shared/cache.js)) with 60-second TTL; actual savings depend on traffic and instance distribution. Per-user favorites are not public-cacheable.
- **Cache Invalidation** — Write operations (POST/PUT/DELETE) immediately invalidate relevant cache keys so the same instance serves fresh data
- **HTTP Cache Headers** — All public GET responses include `Cache-Control: public, max-age=60, stale-while-revalidate=300`, enabling browser and CDN-level caching
- **Elastic Flex Consumption Scaling** — Function App scales to 100 instances automatically under load with 1 always-ready instance
- **Zone-Redundant Storage (ZRS)** — Storage Account uses Standard_ZRS for cross-zone availability within the region
- **Static Web App CDN** — All frontend assets served via Azure's built-in global CDN
- **10,000-user load-test target** — The repository includes a load profile; this is a design target, not a measured capacity guarantee. APIM adds a gateway bottleneck/cost dimension that needs representative testing.

---

## Frontend Architecture

### Multi-page structure (no build step)

The public site is split into focused pages, all hosted by the Static Web App and sharing a small set of plain-JS modules. No bundler, framework, or build pipeline.

| Page | File | Notes |
|------|------|-------|
| Home (landing) | `src/web/index.html` | Hero — logo, title, tagline, CTAs |
| Watch | `src/web/watch.html` | Full-bleed video player + now-playing widgets |
| About | `src/web/about.html` | Markdown content from Content API |
| Schedule | `src/web/schedule.html` | Sessions + session modal |
| Speakers | `src/web/speakers.html` | Speaker grid + speaker modal |
| Code of Conduct | `src/web/code-of-conduct.html` | Markdown content from Content API |
| Sponsors | `src/web/sponsors.html` | Sponsor grid + sponsor modal |
| Admin Dashboard | `src/web/admin.html` | All admin entry points |
| Schedule Admin | `src/web/schedule-admin.html` | CRUD + CSV/YouTube import |
| Speakers Admin | `src/web/speakers-admin.html` | CRUD + headshot upload |
| Sponsors Admin | `src/web/sponsors-admin.html` | CRUD + logo upload |

`staticwebapp.config.json` defines clean-URL rewrites so `/watch`, `/about`, `/schedule`, `/speakers`, `/code-of-conduct`, and `/sponsors` resolve to the corresponding `.html` files.

### Shared scripts

| File | Responsibility |
|------|----------------|
| `src/web/rail.js` | Theme system (CSS vars + `localStorage`) and the side-rail navigation. Mounted automatically on any page that sets `body[data-rail]`. |
| `src/web/site.js` | Shared loaders for branding, schedule, speakers, sponsors, content (about, code-of-conduct), and modal helpers. Classic script so `onclick=` handlers in HTML can resolve `window.foo`. |
| `src/web/timezone-utils.js` | Date/time formatting for session start/end. |
| `src/web/styles.css` | Single stylesheet keyed entirely off CSS custom properties on `:root[data-theme]`. |

### Side-rail navigation

`rail.js` reads two `data-*` attributes from `<body>`:

- `data-rail="public"` or `data-rail="admin"` — picks the nav set.
- `data-rail-active="<id>"` — marks the corresponding link as the current page (adds `.is-active` and `aria-current="page"`).

The rail is rendered as `<aside class="side-rail">` with a `<nav aria-label="Main">` body and a footer that holds page-specific actions (Register / Back-to-site / Logout) plus the theme toggle. Below 900px the rail collapses into an off-canvas drawer toggled by a hamburger button; the collapsed/expanded state on desktop is persisted under `localStorage` key `rail.collapsed`.

### Theme system

All structural colors in `styles.css` are referenced via CSS custom properties (`var(--bg)`, `var(--surface)`, `var(--text)`, `var(--primary)`, etc.) declared on `:root[data-theme="dark"]` and `:root[data-theme="light"]`. Switching the `data-theme` attribute re-paints the entire UI without touching individual selectors.

- First-visit default uses `window.matchMedia('(prefers-color-scheme)')`.
- User override is stored in `localStorage` key `site.theme` (`"dark"` | `"light"`).
- Brand-specific colors (Microsoft Azure gradients, sponsor tier badges, LIVE indicator red) are intentionally left as literals so they stay on-brand in both themes.

### Sign-in and favorites flow

The public site exposes a single sign-in entry point in the rail footer that routes to `/.auth/login/aad` (Static Web Apps' built-in Entra ID provider). On every page load, `site.js`:

1. Calls `/.auth/me` to learn the current principal (or `null`).
2. If signed in: renders the user's name in the rail and fetches `GET /api/favorites`. If anonymous `localStorage` favorites exist (`event-favorites` key), they are pushed up via `POST /api/favorites/merge` and then cleared locally.
3. If signed out: renders the Sign-in link in the rail and reads favorites from `localStorage`.

Session cards on `/schedule` and the session modal on `/speakers` render a star (\u2605) button. Clicking the star calls `toggleFavorite()` which optimistically updates the UI, then issues `PUT` or `DELETE /api/favorites/{sessionId}` (signed in) or rewrites `localStorage` (signed out). On failure the optimistic state is rolled back. The "My Schedule" filter chip on `/schedule` hides all cards that are not in the current favorites set without re-fetching the schedule.

In private mode, APIM strips caller-supplied trusted headers, validates the linked
SWA token/subscription and forwards the SWA principal in
`x-summit-client-principal`. EasyAuth identifies APIM's managed identity; the
shared API authorization hook first verifies that machine identity, then exposes
the separately validated end-user principal to Favorites. `userId` is the SWA
provider ID, not an email or client-supplied body field.

---

## Security

- **User-Assigned Managed Identity** — Function App authenticates to Storage and Cosmos DB via RBAC (no connection strings, no Cosmos keys)
- **Cosmos DB data-plane RBAC** — `disableLocalAuth: true` and the *Cosmos DB Built-in Data Contributor* role (`00000000-0000-0000-0000-000000000002`) bound to the Function App's UAMI; account keys are never issued or stored
- **Microsoft Entra ID Authentication** — Admin pages/writes require the SWA `administrator` role; favorites require `authenticated`. APIM's backend identity is verified separately from trusted end-user context.
- **VNet Integration** — Function App runs inside a VNet subnet; all storage traffic flows through private endpoints
- **Private Endpoints** — Function/SCM and Blob/Table/Queue use private link and private DNS; public network access is Disabled.
- **Storage Lockdown** — New private deployments never reopen public access. The temporary public-storage hook exists only for explicitly selected legacy migration stages.
- **`allowSharedKeyAccess: false`** — Storage account disables shared key access, enforcing RBAC-only
- **`allowBlobPublicAccess: false`** — No anonymous blob access; public content is served through the gateway-authenticated API proxy, without requiring an attendee login
- **Network ACLs** — Storage also has `defaultAction: Deny` and `bypass: AzureServices`; private-mode public access remains Disabled regardless of this bypass setting.
- **Role Assignments** — Storage Blob Data Owner, Blob Data Contributor, Table Data Contributor, Queue Data Contributor, Storage Account Contributor, Cosmos DB Built-in Data Contributor
- **XSS Protection** — DOMPurify sanitization on all user-generated Markdown/HTML content
- **Content Security Policy** — `X-Content-Type-Options`, `X-Frame-Options`, CSP headers configured in `staticwebapp.config.json`
- **CodeQL Analysis** — Automated security scanning via GitHub Actions (weekly + on push/PR)
- **Input Validation** — File type and size validation on uploads, filename sanitization
