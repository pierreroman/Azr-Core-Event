# Azure Core Underground 2026

A community conference website for Azure infrastructure professionals, featuring dynamic schedule management, YouTube video integration, speaker profiles, and sponsor management — all backed by Azure Functions, Table Storage, and Blob Storage with managed identity.

**Live Site:** <https://www.azurecoreunderground.com/>

## Features

### Public Website (index.html)

#### Hero & Navigation

- **ACU Logo** — Conference logo displayed prominently above the title
- Conference branding and tagline
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
- **Footer** — Event info and links

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
  - Session IDs (comma-separated)
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
| `lemon-beach-0a645ad0f` | Azure Static Web App (Standard) | Hosts frontend HTML/CSS/JS |
| `azcoreunderground-api` | Azure Function App (Node.js 20) | REST API backend |
| `azcorestorage2026` | Azure Storage Account | Table Storage + Blob Storage |
| User-Assigned Managed Identity | Managed Identity | RBAC access from Function App to Storage |
| Application Insights + Log Analytics | Monitoring | Logging and diagnostics |
| `rg-AzureCoreUnderground` | Resource Group | Contains all resources |

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
| duration | number | Duration in minutes |

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
| `speakerheadshots` | Public Blob | Speaker headshot images |
| `sponsorlogos` | Public Blob | Sponsor logo images |
| `sitecontent` | Private | Markdown content (about, code-of-conduct) |

### Performance & Scalability

- **In-Memory API Caching** — All GET endpoints use a shared cache module ([`api/src/shared/cache.js`](api/src/shared/cache.js)) with 60-second TTL, reducing Azure Storage calls by ~99% under load
- **Cache Invalidation** — Write operations (POST/PUT/DELETE) immediately invalidate relevant cache keys so the same instance serves fresh data
- **HTTP Cache Headers** — All public GET responses include `Cache-Control: public, max-age=60, stale-while-revalidate=300`, enabling browser and CDN-level caching
- **Elastic Premium Scaling** — Function App scales to 30 instances automatically under load, each handling hundreds of cached requests/second
- **Zone-Redundant Storage (ZRS)** — Storage Account uses Standard_ZRS for cross-zone availability within the region
- **Static Web App CDN** — All frontend assets served via Azure's built-in global CDN
- **Designed for 10,000+ concurrent users** — With caching enabled, the architecture comfortably handles large-scale event traffic

### Security

- **User-Assigned Managed Identity** — Function App authenticates to Storage via RBAC (no connection strings or shared keys)
- **Microsoft Entra ID Authentication** — Admin pages require authenticated users via SWA auth
- **Role Assignments** — Storage Blob Data Owner, Blob Data Contributor, Table Data Contributor, Queue Data Contributor, Storage Account Contributor
- **XSS Protection** — DOMPurify sanitization on all user-generated Markdown/HTML content
- **Content Security Policy** — `X-Content-Type-Options`, `X-Frame-Options`, CSP headers configured in `staticwebapp.config.json`
- **CodeQL Analysis** — Automated security scanning via GitHub Actions (weekly + on push/PR)
- **Input Validation** — File type and size validation on uploads, filename sanitization
- **`allowSharedKeyAccess: false`** — Storage account disables shared key access, enforcing RBAC-only

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

---

## CI/CD

### GitHub Actions Workflows

#### Azure Functions Deploy (`.github/workflows/azure-functions-deploy.yml`)

**Trigger:** Push to `main` branch (paths: `api/**`) or manual dispatch

**Steps:**

1. Checkout repository
2. Setup Node.js 20.x
3. Install production dependencies only (`npm install --omit=dev`)
4. Login to Azure via OIDC (federated credentials)
5. Restart Function App (clears disk space)
6. Deploy to Azure Functions

#### Static Web App Deploy (`.github/workflows/azure-static-web-apps-lemon-beach-0a645ad0f.yml`)

**Trigger:** Push to `main` branch, or pull request on `main`

**Steps:**

1. Checkout repository
2. Build and deploy via `Azure/static-web-apps-deploy@v1`
3. Closes staging environments on PR close

> **Note:** The SWA workflow does _not_ deploy the `api/` folder — the Function App is linked as a separate backend via managed identity.

#### CodeQL Security Analysis (`.github/workflows/codeql.yml`)

**Trigger:** Push to `main`, pull requests on `main`, weekly schedule (Monday at midnight UTC)

- Automated JavaScript/TypeScript code scanning
- Security vulnerability detection
- Results reported to GitHub Security tab

---

## Local Development

### Prerequisites

- Node.js 20.x
- Azure CLI (logged in)
- Azure Functions Core Tools

### Running the API Locally

```bash
cd api
npm install
func start
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_STORAGE_ACCOUNT` | Azure Storage account name | `azcorestorage2026` |
| `STORAGE_ACCOUNT_NAME` | Alternative storage account name (fallback) | `azcorestorage2026` |
| `AZURE_CLIENT_ID` | Client ID for user-assigned managed identity | _(none — uses default credential)_ |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for playlist imports | _(optional)_ |

---

## Full Deployment with Azure Developer CLI (azd)

This project includes an Azure Developer CLI (azd) template for deploying the complete infrastructure.

### Prerequisites

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) installed and logged in
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) installed
- Azure subscription with Contributor access

### What Gets Deployed

| Resource | SKU | Description |
|----------|-----|-------------|
| Static Web App | Standard | Frontend hosting with custom domains and built-in CDN |
| Function App | EP1 (Elastic Premium) | API backend with managed identity, scales to 30 instances |
| Storage Account | Standard_ZRS | Zone-redundant Tables + Blob Storage (no shared keys) |
| User-Assigned Managed Identity | — | RBAC access to storage |
| Application Insights | — | Monitoring and logging |
| Log Analytics Workspace | PerGB2018 | Centralized logs |

### Deployment Steps

```bash
# 1. Clone the repository
git clone https://github.com/pierreroman/Azr-Core-Event.git
cd Azr-Core-Event

# 2. Initialize azd (first time only)
azd init

# 3. Deploy everything (provision + deploy)
azd up
```

The `azd up` command will:
1. Prompt for environment name and Azure location
2. Create a new resource group: `rg-{environment-name}`
3. Provision all Azure resources using Bicep
4. Deploy the Static Web App frontend
5. Deploy the Function App backend
6. Link the Function App to the Static Web App

### Post-Deployment Configuration

After deployment, configure the following:

1. **Custom Domain** (optional) — Add custom domain in Azure Portal for the Static Web App
2. **Admin Access** — Configure Microsoft Entra ID authentication for admin pages
3. **Speaker Headshots** — Upload images via the Speakers Admin page
4. **Sponsor Logos** — Upload images via the Sponsors Admin page

### Infrastructure Files

| File | Description |
|------|-------------|
| `azure.yaml` | AZD project definition with services and hooks |
| `infra/main.bicep` | Main template (subscription scope) |
| `infra/resources.bicep` | All Azure resources with RBAC |
| `infra/main.parameters.json` | Parameter values |

### Other azd Commands

```bash
# View deployment outputs
azd env get-values

# Redeploy code only (no infra changes)
azd deploy

# Tear down all resources
azd down

# View logs
azd monitor --logs
```

---

## File Structure

```
├── index.html                 # Main public website
├── admin.html                 # Admin dashboard (navigation hub)
├── schedule-admin.html        # Schedule management
├── speakers-admin.html        # Speakers management
├── sponsors-admin.html        # Sponsors management
├── styles.css                 # All CSS styles (consolidated)
├── staticwebapp.config.json   # SWA routing, auth, and security headers
├── azure.yaml                 # AZD project definition
├── SECURITY_IMPROVEMENTS.md   # Security fixes documentation
├── readme.md                  # This file
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
│           └── content.js     # About/CoC content management (Blob Storage)
├── content/
│   ├── about.md               # Default about page content
│   └── code-of-conduct.md     # Default code of conduct content
├── infra/
│   ├── main.bicep             # Main Bicep template (subscription scope)
│   ├── resources.bicep        # All Azure resources with RBAC
│   └── main.parameters.json   # Deployment parameters
├── assets/
│   ├── acu-logo.png           # Conference logo
│   └── Loading-Schedule.png   # Placeholder image
├── images/
│   └── speakers/              # Speaker headshot images (legacy/local)
└── .github/workflows/
    ├── azure-functions-deploy.yml                  # Function App CI/CD
    ├── azure-static-web-apps-lemon-beach-0a645ad0f.yml  # SWA CI/CD
    └── codeql.yml                                  # Security scanning
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
- **Infrastructure:** Bicep, Azure Developer CLI (azd)
- **CI/CD:** GitHub Actions with OIDC (Functions deploy + SWA deploy + CodeQL)
- **Video:** YouTube IFrame API
- **Markdown:** marked.js for rendering, DOMPurify for XSS sanitization
