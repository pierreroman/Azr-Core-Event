# Architecture

## Azure Resources

| Resource | Type | Purpose |
|----------|------|---------|
| Static Web App | Azure Static Web App (Standard) | Hosts frontend HTML/CSS/JS, manages Entra ID auth |
| Function App | Azure Function App (Flex Consumption, Node.js 20) | REST API backend |
| Storage Account | Azure Storage Account (Standard_ZRS) | Table Storage + Blob Storage |
| Cosmos DB | Azure Cosmos DB (Serverless, SQL API) | Per-user favorites — partition key `/userId` |
| Virtual Network | Azure VNet (10.0.0.0/16) | Network isolation for Function App and Storage |
| Private Endpoints | Azure Private Endpoints | Private connectivity to Blob, Table, and Queue storage |
| Private DNS Zones | Azure Private DNS | DNS resolution for private endpoints |
| User-Assigned Managed Identity | Managed Identity | RBAC access from Function App to Storage and Cosmos DB |
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

## Blob Storage Containers

| Container | Access | Purpose |
|-----------|--------|---------|
| `speakerheadshots` | Private | Speaker headshot images (served via API) |
| `sponsorlogos` | Private | Sponsor logo images (served via API) |
| `sitecontent` | Private | Markdown content (about, code-of-conduct, registration config) |
| `deployments` | Private | Flex Consumption Function App deployment packages |

---

## Performance & Scalability

- **In-Memory API Caching** — All GET endpoints use a shared cache module ([`api/src/shared/cache.js`](../api/src/shared/cache.js)) with 60-second TTL, reducing Azure Storage calls by ~99% under load
- **Cache Invalidation** — Write operations (POST/PUT/DELETE) immediately invalidate relevant cache keys so the same instance serves fresh data
- **HTTP Cache Headers** — All public GET responses include `Cache-Control: public, max-age=60, stale-while-revalidate=300`, enabling browser and CDN-level caching
- **Elastic Flex Consumption Scaling** — Function App scales to 100 instances automatically under load with 1 always-ready instance
- **Zone-Redundant Storage (ZRS)** — Storage Account uses Standard_ZRS for cross-zone availability within the region
- **Static Web App CDN** — All frontend assets served via Azure's built-in global CDN
- **Designed for 10,000+ concurrent users** — With caching enabled, the architecture comfortably handles large-scale event traffic

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
| Sponsors | `src/web/sponsors.html` | Sponsor grid + sponsor modal |
| Admin Dashboard | `src/web/admin.html` | All admin entry points |
| Schedule Admin | `src/web/schedule-admin.html` | CRUD + CSV/YouTube import |
| Speakers Admin | `src/web/speakers-admin.html` | CRUD + headshot upload |
| Sponsors Admin | `src/web/sponsors-admin.html` | CRUD + logo upload |

`staticwebapp.config.json` defines clean-URL rewrites so `/watch`, `/about`, `/schedule`, `/speakers`, and `/sponsors` resolve to the corresponding `.html` files.

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

---

## Security

- **User-Assigned Managed Identity** — Function App authenticates to Storage via RBAC (no connection strings or shared keys)
- **Microsoft Entra ID Authentication** — Admin pages require authenticated users via SWA auth
- **VNet Integration** — Function App runs inside a VNet subnet; all storage traffic flows through private endpoints
- **Private Endpoints** — Blob, Table, and Queue storage accessible only via private link (no public storage endpoints)
- **Storage Lockdown** — `publicNetworkAccess` is disabled post-deployment via `postdeploy` hook; temporarily re-enabled during deployments via `predeploy` hook
- **`allowSharedKeyAccess: false`** — Storage account disables shared key access, enforcing RBAC-only
- **`allowBlobPublicAccess: false`** — No anonymous blob access; all content served through authenticated API proxies
- **Network ACLs** — `defaultAction: Deny` with `bypass: AzureServices` during deployment windows
- **Role Assignments** — Storage Blob Data Owner, Blob Data Contributor, Table Data Contributor, Queue Data Contributor, Storage Account Contributor
- **XSS Protection** — DOMPurify sanitization on all user-generated Markdown/HTML content
- **Content Security Policy** — `X-Content-Type-Options`, `X-Frame-Options`, CSP headers configured in `staticwebapp.config.json`
- **CodeQL Analysis** — Automated security scanning via GitHub Actions (weekly + on push/PR)
- **Input Validation** — File type and size validation on uploads, filename sanitization
