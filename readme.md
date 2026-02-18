# Community Online Event

A reusable community conference website featuring dynamic schedule management, YouTube video integration, speaker profiles, sponsor management, and event registration — all backed by Azure Functions, Table Storage, and Blob Storage with managed identity, secured with VNet integration and private endpoints.

Deploy your own instance using Azure Developer CLI (`azd up`) or the interactive `deploy.ps1` script.

## Features

### Public Website (index.html)

#### Hero & Navigation

- **Event Logo** — Customizable conference logo displayed prominently above the title
- Configurable branding and tagline via Admin Dashboard
- Quick navigation to About, Schedule, Speakers, and Sponsors sections

#### Video Player Section

- **Embedded YouTube Player** — Automatically loads and plays the current session
- **Live Stream Detection** — Shows "LIVE" badge when stream is broadcasting
- **Now Playing Info Box** — Displays current session title, description, and YouTube link
- **Up Next Box** — Shows the next scheduled session with live countdown timer
- **Live Chat Button** — Opens YouTube live chat in a popup window during streams

#### Dynamic Schedule

- Fetches sessions from Azure Table Storage API
- Groups sessions by day with date headers
- Clickable session cards open detailed modal with:
  - Session time and date
  - Full title and description (with clickable links)
  - Direct YouTube link
  - **Past sessions:** "Watch Recording" button linking to the YouTube video
  - **Future sessions:** "Add to Calendar" button that downloads an ICS file with correct start time and duration

#### Registration

- **Register Button** — Appears in the navigation bar when registration is enabled by an admin
- **Registration Modal** — Opens with configurable title, Markdown-rendered description, and external registration link
- Configuration managed via the Admin Dashboard (stored in Blob Storage)

#### Featured Speakers Section

- Dynamically loads speakers from API
- Speaker cards with avatar (headshot or initials), name, title, and company
- Hover effect with subtle lift animation
- **Speaker Modal Popup** on click showing:
  - Large avatar/headshot
  - Name, title, and company
  - Social links (Twitter/X, LinkedIn, GitHub, Website)
  - Full biography with clickable links
  - List of their sessions (clickable to open session details)

#### Sponsors Section

- Fetches sponsors from API, grouped by tier (Platinum, Gold, Silver, Bronze, Community)
- Logo grid with tier headings
- **Sponsor Detail Modal** on click showing:
  - Large logo image
  - Sponsor name and tier badge
  - Website link
  - Markdown-rendered description

#### Additional Sections

- **About** — Event description loaded from Content API (server-side Markdown stored in Blob Storage)
- **Code of Conduct** — Modal with community guidelines loaded from Content API
- **Footer** — Privacy Policy (links to Microsoft Privacy Statement), Code of Conduct, Admin link, Powered by Azure

#### Accessibility & UX

- Keyboard navigation (Escape to close modals)
- Click outside modal to close
- Responsive design for all screen sizes
- Loading states for async content
- XSS protection via DOMPurify sanitization

---

### Admin Dashboard (admin.html)

**Authentication:** Requires Microsoft Entra ID login (configured in staticwebapp.config.json)

Central dashboard with navigation to all admin functions:

- **Schedule Management** — Link to schedule-admin.html
- **Speaker Management** — Link to speakers-admin.html
- **Sponsor Management** — Link to sponsors-admin.html
- **Registration Management** — Enable/disable registration button, set title, registration URL, and Markdown description with split-pane live preview editor
- **Branding** — Customize event name, logo, and color scheme
- **Headshot Upload** — Upload speaker images directly to blob storage
- **Code of Conduct Editor** — Edit CoC content (saved to Blob Storage via Content API)
- **About Editor** — Edit About section content (saved to Blob Storage via Content API)

---

### Schedule Admin (schedule-admin.html)

**Authentication:** Requires Microsoft Entra ID login

#### Schedule Management

- **View All Sessions** — Table with title, video ID, date/time, duration, and actions
- **Add Session** — Form with video ID, title, description, start time, and duration
- **Edit Session** — Inline editing of any session field
- **Delete Session** — Single delete with confirmation
- **Multi-Select Delete** — Checkbox selection for bulk deletion

#### CSV Export/Import

- **Export to CSV** — Downloads schedule as RFC 4180 compliant CSV
  - Excel formula protection (prefixes dangerous characters with single quote)
  - Handles multi-line descriptions and special characters
- **Import from CSV** — Upload CSV to create/update sessions
  - Creates new sessions or updates existing (by sessionId)
  - Validates required columns (videoId, title, startTime)
  - Reports success/error counts

#### YouTube Playlist Import

- **Import from YouTube Playlist** — Bulk import videos from any public YouTube playlist
  - Enter playlist URL or ID
  - Requires YouTube Data API v3 key (free from Google Cloud Console)
  - Set first session start time and gap between sessions
  - Automatically fetches video titles, descriptions, and durations
  - Creates sequential schedule entries with proper timing
  - Skips private/deleted videos
  - Shows detailed import progress and results

---

### Speakers Admin (speakers-admin.html)

**Authentication:** Requires Microsoft Entra ID login

#### Speaker Management

- **View All Speakers** — Card grid with avatar, name, title, company, and social links
- **Add Speaker** — Form with:
  - Name, title, company
  - Biography (multi-line)
  - Headshot filename (references blob in `speakerheadshots` container)
  - Real-time headshot preview as filename is typed
  - Social links (LinkedIn, Twitter/X)
  - **Session Picker** — Dropdown to assign sessions from the schedule; shows assigned sessions as removable tags
- **Edit Speaker** — Full editing of all fields
- **Delete Speaker** — With confirmation

#### Extract Speakers

- **Auto-Extract from Schedule** — Parses session descriptions for "Speaker:" patterns
- Automatically creates speaker entries with linked sessions
- Updates existing speakers with new session links
- Reports created/updated counts

---

### Sponsors Admin (sponsors-admin.html)

**Authentication:** Requires Microsoft Entra ID login

#### Sponsor Management

- **View All Sponsors** — Card grid with logo, name, tier badge, website link, and enable/disable toggle
- **Add Sponsor** — Form with:
  - Sponsor name, tier (Platinum/Gold/Silver/Bronze/Community), sort order
  - Website URL
  - Logo filename (references blob in `sponsorlogos` container)
  - Real-time logo preview as filename is typed
  - Description with Markdown support and live preview
  - Enable/disable toggle for public visibility
- **Edit Sponsor** — Full editing of all fields
- **Delete Sponsor** — With confirmation
- **Enable/Disable** — Quick toggle for public visibility
- **Hide All Sponsors** — Toggle to hide the entire sponsors section from the public site
- **Stats Bar** — Total sponsors, enabled count, logos count

#### Logo Upload

- **Drag & Drop Upload Zone** — Upload logo images (JPG, PNG, WebP, SVG, max 10MB)
- **Automatic Filename Sanitization** — Uploaded files are lowercased and URL-safe
- **"Use this logo" Button** — After upload, one-click auto-fill of the logo filename field
- **Existing Logos Grid** — Browse and click to auto-fill the logo filename field
- Images stored in `sponsorlogos` blob container with public blob access

---

## Architecture

### Azure Resources

| Resource | Type | Purpose |
|----------|------|---------|
| Static Web App | Azure Static Web App (Standard) | Hosts frontend HTML/CSS/JS |
| Function App | Azure Function App (Flex Consumption, Node.js 20) | REST API backend |
| Storage Account | Azure Storage Account (Standard_ZRS) | Table Storage + Blob Storage |
| Virtual Network | Azure VNet (10.0.0.0/16) | Network isolation for Function App and Storage |
| Private Endpoints | Azure Private Endpoints | Private connectivity to Blob, Table, and Queue storage |
| Private DNS Zones | Azure Private DNS | DNS resolution for private endpoints |
| User-Assigned Managed Identity | Managed Identity | RBAC access from Function App to Storage |
| Application Insights + Log Analytics | Monitoring | Logging and diagnostics |
| Resource Group | Resource Group | Contains all resources |

### Data Storage (Azure Table Storage)

#### VideoSchedule Table

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

#### Speakers Table

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

#### Sponsors Table

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

### Blob Storage Containers

| Container | Access | Purpose |
|-----------|--------|---------|
| `speakerheadshots` | Private | Speaker headshot images (served via API) |
| `sponsorlogos` | Private | Sponsor logo images (served via API) |
| `sitecontent` | Private | Markdown content (about, code-of-conduct, registration config) |
| `deployments` | Private | Flex Consumption Function App deployment packages |

### Performance & Scalability

- **In-Memory API Caching** — All GET endpoints use a shared cache module ([`api/src/shared/cache.js`](api/src/shared/cache.js)) with 60-second TTL, reducing Azure Storage calls by ~99% under load
- **Cache Invalidation** — Write operations (POST/PUT/DELETE) immediately invalidate relevant cache keys so the same instance serves fresh data
- **HTTP Cache Headers** — All public GET responses include `Cache-Control: public, max-age=60, stale-while-revalidate=300`, enabling browser and CDN-level caching
- **Elastic Flex Consumption Scaling** — Function App scales to 100 instances automatically under load with 1 always-ready instance
- **Zone-Redundant Storage (ZRS)** — Storage Account uses Standard_ZRS for cross-zone availability within the region
- **Static Web App CDN** — All frontend assets served via Azure's built-in global CDN
- **Designed for 10,000+ concurrent users** — With caching enabled, the architecture comfortably handles large-scale event traffic

### Security

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

---

## API Endpoints

### Schedule API (`/api/schedule`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/schedule` | Anonymous | Get all sessions |
| GET | `/api/schedule?format=csv` | Anonymous | Export as CSV |
| POST | `/api/schedule` | Authenticated | Add new session |
| POST | `/api/schedule?action=import` | Authenticated | Import from CSV |
| POST | `/api/schedule?action=playlist` | Authenticated | Import from YouTube playlist |
| PUT | `/api/schedule/{id}` | Authenticated | Update session |
| DELETE | `/api/schedule/{id}` | Authenticated | Delete session |

### Speakers API (`/api/speakers`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/speakers` | Anonymous | Get all speakers |
| GET | `/api/speakers/{id}` | Anonymous | Get single speaker |
| GET | `/api/speakers/headshots` | Anonymous | List all headshot images |
| POST | `/api/speakers` | Authenticated | Add new speaker |
| POST | `/api/speakers/extract` | Authenticated | Extract speakers from schedule |
| POST | `/api/speakers/headshot` | Authenticated | Upload headshot image |
| PUT | `/api/speakers/{id}` | Authenticated | Update speaker |
| DELETE | `/api/speakers/{id}` | Authenticated | Delete speaker |

### Sponsors API (`/api/sponsors`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/sponsors` | Anonymous | Get all sponsors (sorted by tier) |
| GET | `/api/sponsors/{id}` | Anonymous | Get single sponsor |
| GET | `/api/sponsors/logos` | Anonymous | List all logo images |
| POST | `/api/sponsors` | Authenticated | Add new sponsor |
| POST | `/api/sponsors/logo` | Authenticated | Upload logo image |
| PUT | `/api/sponsors/{id}` | Authenticated | Update sponsor |
| DELETE | `/api/sponsors/{id}` | Authenticated | Delete sponsor |

### Content API (`/api/content`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/content/{type}` | Anonymous | Get markdown content (about, code-of-conduct) |
| PUT | `/api/content/{type}` | Authenticated | Save markdown content to Blob Storage |
| DELETE | `/api/content/{type}` | Authenticated | Reset content to defaults |

### Registration API (`/api/registration`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/registration` | Anonymous | Get registration config (enabled, title, URL, description) |
| PUT | `/api/registration` | Authenticated | Save registration config to Blob Storage |

---

## CI/CD

### CodeQL Security Analysis (`.github/workflows/codeql.yml`)

**Trigger:** Push to `main`, pull requests on `main`, weekly schedule (Monday at midnight UTC)

- Automated JavaScript/TypeScript code scanning
- Security vulnerability detection
- Results reported to GitHub Security tab

> **Note:** Deployment is handled entirely by `azd` (see [Deployment](#deployment) above). No GitHub Actions deployment workflows are needed.

---

## Local Development

### Prerequisites

- Node.js 20.x
- Azure CLI (logged in with `az login`)
- [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) v4

### Running the API Locally

```bash
cd api
npm install

# Set your storage account in local.settings.json
# Then start the Functions host
func start
```

### Environment Variables

Configure these in `api/local.settings.json` for local development, or as App Settings in Azure for production:

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_STORAGE_ACCOUNT` | Azure Storage account name | **Yes** |
| `STORAGE_ACCOUNT_NAME` | Alternative storage account name (fallback) | No (use `AZURE_STORAGE_ACCOUNT`) |
| `AZURE_CLIENT_ID` | Client ID for user-assigned managed identity | No (uses default credential locally) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for playlist imports | No (only needed for playlist import) |

> **Important:** The `AZURE_STORAGE_ACCOUNT` environment variable is required. The API will not start correctly without a valid storage account name configured.

---

## Deployment

This project deploys entirely via Azure Developer CLI (`azd`). No GitHub Actions workflows are required.

### Prerequisites

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) installed
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) installed
- PowerShell 7+ (for the interactive script)
- Azure subscription with Contributor access

### What Gets Deployed

| Resource | SKU | Description |
|----------|-----|-------------|
| Static Web App | Standard | Frontend hosting with custom domains and built-in CDN |
| Function App | Flex Consumption (FC1) | API backend with managed identity, scales to 100 instances |
| Storage Account | Standard_ZRS | Zone-redundant Tables + Blob Storage (no shared keys) |
| Virtual Network | 10.0.0.0/16 | Network isolation with subnets for Function App and private endpoints |
| Private Endpoints | — | Blob, Table, and Queue private connectivity |
| Private DNS Zones | — | DNS resolution for storage private endpoints |
| User-Assigned Managed Identity | — | RBAC access to storage |
| Application Insights | — | Monitoring and logging |
| Log Analytics Workspace | PerGB2018 | Centralized logs |

### Option A: Interactive Deploy Script (Recommended)

The `deploy.ps1` script walks you through the full deployment interactively:

```powershell
./deploy.ps1
```

It will prompt for:

1. **Environment name** (e.g. `dev`, `staging`, `prod`)
2. **Tenant ID** (your Microsoft Entra ID tenant GUID)
3. **Authentication** — logs into both `azd` and `az` CLI for the chosen tenant
4. **Subscription** — lists available subscriptions and lets you pick by number
5. **Region** — defaults to `eastus2`, type to override
6. **Resource provider registration** — automatically registers required Azure providers (Microsoft.App, Microsoft.Web, Microsoft.Storage, etc.)
7. **Confirmation** — displays a summary before proceeding
8. **Deployment** — runs `azd up` (provision + deploy)

If you skip a required field, the script re-asks instead of exiting.

### Option B: Manual azd Commands

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd <your-repo-name>

# 2. Log in
azd auth login --tenant-id <your-tenant-id>
az login --tenant <your-tenant-id>

# 3. Create or select an environment
azd env new <env-name>
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
azd env set AZURE_LOCATION eastus2

# 4. Deploy everything (provision + deploy)
azd up
```

The `azd up` command will:

1. **Register resource providers** — Preprovision hook registers all required Azure providers
2. Create a new resource group: `rg-{environment-name}`
3. Provision all Azure resources using Bicep (VNet, private endpoints, storage, Function App, SWA)
4. **Re-enable storage public access** — Predeploy hook temporarily enables public network access for deployment
5. Deploy the Static Web App frontend (from `src/web/`)
6. Deploy the Function App backend (from `api/` with remote build)
7. **Lock down storage** — Postdeploy hook disables public network access
8. Link the Function App to the Static Web App (postprovision hook)
9. Invite administrators to the Static Web App (postprovision hook)

### Post-Deployment Configuration

After deployment completes:

1. **Custom Domain** (optional) — Add custom domain in Azure Portal for the Static Web App
2. **Admin Access** — Microsoft Entra ID authentication is pre-configured in `staticwebapp.config.json`
3. **Speaker Headshots** — Upload images via the Speakers Admin page (`/speakers-admin.html`)
4. **Sponsor Logos** — Upload images via the Sponsors Admin page (`/sponsors-admin.html`)
5. **Branding** — Customize event name, logo, and colors via the Admin Dashboard (`/admin.html`)

### Redeployment & Other azd Commands

```bash
# Redeploy code only (no infra changes)
azd deploy

# Deploy just the frontend
azd deploy web

# Deploy just the API
azd deploy api

# View deployment outputs
azd env get-values

# Tear down all resources
azd down

# View logs
azd monitor --logs
```

### Infrastructure Files

| File | Description |
|------|-------------|
| `deploy.ps1` | Interactive deployment script (prompts for all inputs) |
| `azure.yaml` | AZD project definition with services and lifecycle hooks (preprovision, predeploy, postdeploy, postprovision) |
| `infra/main.bicep` | Main template (subscription scope) |
| `infra/resources.bicep` | All Azure resources with RBAC, VNet, private endpoints |
| `infra/main.parameters.json` | Parameter values |

---

## Testing

### Playwright — Functional & E2E Tests

The project includes [Playwright](https://playwright.dev/) tests that verify the public site, navigation, API endpoints, admin pages, and accessibility.

#### Setup

```bash
npm install                        # install @playwright/test
npx playwright install chromium    # download browser (add firefox/webkit as needed)
```

#### Test Suites

| File | What it tests |
|------|---------------|
| `tests/homepage.spec.js` | Hero section, schedule/speakers/sponsors rendering, footer, external scripts |
| `tests/navigation.spec.js` | Anchor scrolling, session/speaker/sponsor/CoC modals open & close |
| `tests/api.spec.js` | GET endpoints return 200, POST without auth is rejected |
| `tests/admin.spec.js` | Admin pages require authentication, redirect to login |
| `tests/accessibility.spec.js` | `lang` attribute, alt text on images, keyboard focus, heading structure |
| `tests/fixtures.js` | Shared mock API data so UI tests don't require a live backend |

#### Running Tests

```bash
# Against localhost (start SWA CLI first: swa start)
npm test

# Against a live/staging site
$env:BASE_URL="https://www.azureinfrasummit.com"; npm test

# Useful variations
npm run test:chromium       # Chromium only (fastest)
npm run test:headed         # Watch browser while tests run
npm run test:ui             # Interactive Playwright UI
npm run test:api            # API endpoint tests only
npm run test:report         # Open the HTML results report
```

#### Configuration

- Config file: `playwright.config.js`
- Default `baseURL`: `http://localhost:4280` (override with `BASE_URL` env var)
- Browsers: Chromium, Firefox, WebKit + Mobile Chrome & Safari viewports
- Traces captured on first retry, screenshots on failure
- HTML report generated in `playwright-report/`

---

### Load Testing — 10K Concurrent Users

The project includes a [Locust](https://locust.io/) load test script and an Azure Load Testing configuration to simulate **10,000 concurrent users** distributed across three geographic regions.

#### Traffic Distribution

| Region | Azure Region | Engine Instances | Users | Traffic Share |
|--------|-------------|-----------------|-------|---------------|
| North America | `eastus2` | 7 | 7,000 | 70% |
| Europe | `westeurope` | 2 | 2,000 | 20% |
| Asia-Pacific | `southeastasia` | 1 | 1,000 | 10% |

#### Simulated User Behavior

The Locust script (`locustfile.py`) models realistic attendee traffic with weighted tasks:

| Task | Weight | Endpoint |
|------|--------|----------|
| Browse homepage | 50% | `GET /` |
| View schedule | 15% | `GET /api/schedule` |
| View speakers | 15% | `GET /api/speakers` |
| View sponsors | 5% | `GET /api/sponsors` |
| Read about page | 5% | `GET /api/content/about` |
| Read code of conduct | 5% | `GET /api/content/code-of-conduct` |
| Load stylesheet | 5% | `GET /styles.css` |

#### Running Load Tests

**Local smoke test** (validate script with small user count):

```bash
pip install locust requests
locust -f locustfile.py --host https://www.azureinfrasummit.com -u 50 -r 5 --run-time 2m --headless
```

**Azure Load Testing** (full 10K users with geo-distribution):

```bash
# Install the CLI extension
az extension add --name load

# Create and run the test
az load test create \
  --load-test-resource <your-load-test-resource> \
  --resource-group <your-rg> \
  --load-test-config-file load-test-config.yaml
```

Or upload `locustfile.py` + `load-test-config.yaml` through the **Azure Portal → Load Testing** blade.

#### Failure Criteria (auto-configured)

| Metric | Threshold |
|--------|-----------|
| Average response time | > 3 seconds |
| Error rate | > 5% |
| P99 latency | > 10 seconds |
| Auto-stop | Error rate > 80% for 60s |

#### Files

| File | Purpose |
|------|---------|
| `locustfile.py` | Locust load test script with weighted user scenarios |
| `load-test-config.yaml` | Azure Load Testing YAML config with regional distribution |

---

## File Structure

```
├── deploy.ps1                 # Interactive deployment script
├── azure.yaml                 # AZD project definition with services and hooks
├── readme.md                  # This file
├── playwright.config.js       # Playwright test configuration
├── locustfile.py              # Locust load test script
├── load-test-config.yaml      # Azure Load Testing config (10K users, 3 regions)
├── src/
│   └── web/                   # Static Web App frontend
│       ├── index.html         # Main public website
│       ├── admin.html         # Admin dashboard (navigation hub)
│       ├── schedule-admin.html# Schedule management
│       ├── speakers-admin.html# Speakers management
│       ├── sponsors-admin.html# Sponsors management
│       ├── styles.css         # All CSS styles (consolidated)
│       ├── staticwebapp.config.json # SWA routing, auth, and security headers
│       ├── assets/            # Event logo and placeholder images
│       ├── content/           # Default markdown content (about, code-of-conduct)
│       └── images/speakers/   # Speaker headshot images (legacy/local)
├── api/
│   ├── package.json           # Node.js dependencies
│   ├── host.json              # Functions host config
│   └── src/
│       ├── shared/
│       │   └── cache.js       # In-memory cache with TTL (scalability layer)
│       └── functions/
│           ├── schedule.js    # Schedule CRUD + CSV/Playlist import/export
│           ├── speakers.js    # Speakers CRUD + extract + headshot upload
│           ├── sponsors.js    # Sponsors CRUD + logo upload
           ├── content.js     # About/CoC content management (Blob Storage)
           └── registration.js# Registration config management (Blob Storage)
├── tests/
│   ├── fixtures.js            # Shared mock data & test fixtures
│   ├── homepage.spec.js       # Homepage rendering tests
│   ├── navigation.spec.js     # Navigation & modal interaction tests
│   ├── api.spec.js            # API endpoint tests
│   ├── admin.spec.js          # Admin authentication tests
│   └── accessibility.spec.js  # Accessibility tests
├── infra/
│   ├── main.bicep             # Main Bicep template (subscription scope)
│   ├── resources.bicep        # All Azure resources with RBAC
│   └── main.parameters.json   # Deployment parameters
└── .github/workflows/
    └── codeql.yml             # Security scanning
```

---

## Technologies

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Azure Functions (Node.js 20, v4 programming model)
- **Database:** Azure Table Storage
- **File Storage:** Azure Blob Storage (headshots, logos, site content)
- **Hosting:** Azure Static Web Apps (Standard tier)
- **Authentication:** Microsoft Entra ID (Azure AD)
- **Identity:** User-Assigned Managed Identity with RBAC
- **Caching:** In-memory TTL cache with automatic invalidation on writes
- **Testing:** Playwright (functional/E2E), Locust + Azure Load Testing (performance)
- **Infrastructure:** Bicep, Azure Developer CLI (azd)
- **CI/CD:** Azure Developer CLI (azd) for deployment, GitHub Actions for CodeQL scanning
- **Video:** YouTube IFrame API
- **Markdown:** marked.js for rendering, DOMPurify for XSS sanitization
