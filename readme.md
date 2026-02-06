# Azure Core Underground 2026

A community conference website for Azure infrastructure professionals, featuring dynamic schedule management, YouTube video integration, and speaker profiles.

**Live Site:** <https://www.azurecoreunderground.com/>

## Features

### Public Website (index.html)

#### Hero & Navigation

- **ACU Logo** - Conference logo displayed prominently above the title
- Conference branding and tagline
- Quick navigation to About, Schedule, Speakers, and Sponsors sections

#### Video Player Section

- **Embedded YouTube Player** - Automatically loads and plays the current session
- **Live Stream Detection** - Shows "LIVE" badge when stream is broadcasting
- **Now Playing Info Box** - Displays current session title, description, and YouTube link
- **Up Next Box** - Shows the next scheduled session with live countdown timer
- **Live Chat Button** - Opens YouTube live chat in a popup window during streams

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

#### Additional Sections

- **About** - Event description and target audience with feature cards
- **Sponsors** - Sponsor logos grid
- **Code of Conduct** - Modal with community guidelines
- **Footer** - Event info and links

#### Accessibility & UX

- Keyboard navigation (Escape to close modals)
- Click outside modal to close
- Responsive design for all screen sizes
- Loading states for async content

---

### Admin Dashboard (admin.html)

**Authentication:** Requires Azure AD login (configured in staticwebapp.config.json)

Central dashboard with navigation to all admin functions:

- **Schedule Management** - Link to schedule-admin.html
- **Speaker Management** - Link to speakers-admin.html
- **Branding** - Customize event name, logo, and color scheme
- **Headshot Upload** - Upload speaker images directly to blob storage
- **Code of Conduct Editor** - Edit CoC content (stored in browser localStorage)
- **About Editor** - Edit About section content (stored in browser localStorage)

---

### Schedule Admin (schedule-admin.html)

**Authentication:** Requires Azure AD login

#### Schedule Management

- **View All Sessions** - Table with title, video ID, date/time, duration, and actions
- **Add Session** - Form with video ID, title, description, start time, and duration
- **Edit Session** - Inline editing of any session field
- **Delete Session** - Single delete with confirmation
- **Multi-Select Delete** - Checkbox selection for bulk deletion

#### CSV Export/Import

- **Export to CSV** - Downloads schedule as RFC 4180 compliant CSV
  - Excel formula protection (prefixes dangerous characters with single quote)
  - Handles multi-line descriptions and special characters
- **Import from CSV** - Upload CSV to create/update sessions
  - Creates new sessions or updates existing (by sessionId)
  - Validates required columns (videoId, title, startTime)
  - Reports success/error counts

#### YouTube Playlist Import

- **Import from YouTube Playlist** - Bulk import videos from any public YouTube playlist
  - Enter playlist URL or ID
  - Requires YouTube Data API v3 key (free from Google Cloud Console)
  - Set first session start time and gap between sessions
  - Automatically fetches video titles, descriptions, and durations
  - Creates sequential schedule entries with proper timing
  - Skips private/deleted videos
  - Shows detailed import progress and results

---

### Speakers Admin (speakers-admin.html)

**Authentication:** Requires Azure AD login

#### Speaker Management

- **View All Speakers** - Card grid with avatar, name, title, company, and social links
- **Add Speaker** - Form with:
  - Name, title, company
  - Biography (multi-line)
  - Headshot filename (for blob storage `speakerheadshots` container)
  - Social links (LinkedIn, Twitter)
  - Session IDs (comma-separated)
- **Edit Speaker** - Full editing of all fields
- **Delete Speaker** - With confirmation
- **Headshot Preview** - Shows image preview when filename is entered

#### Extract Speakers

- **Auto-Extract from Schedule** - Parses session descriptions for "Speaker:" patterns
- Automatically creates speaker entries with linked sessions
- Updates existing speakers with new session links
- Reports created/updated counts

---

## Architecture

### Azure Resources

| Resource | Type | Purpose |
|----------|------|---------|
| `lemon-beach-0a645ad0f` | Azure Static Web App (Standard) | Hosts frontend HTML/CSS/JS |
| `azcoreunderground-api` | Azure Function App (Node.js 20) | REST API backend |
| `azcorestorage2026` | Azure Storage Account | Table Storage for data |
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
| headshotFile | string | Image filename |
| linkedin | string | LinkedIn URL |
| twitter | string | Twitter/X URL |
| sessionIds | JSON string | Array of session IDs |

### Security

- **Managed Identity** - Function App uses system-assigned managed identity for Table Storage access (no connection strings)
- **Azure AD Authentication** - Admin pages require authenticated users
- **No Public Blob Access** - Storage account has `allowBlobPublicAccess: false`
- **Speaker Headshots** - Images stored in blob storage `speakerheadshots` container (public blob access)
- **Security Headers** - X-Content-Type-Options, X-Frame-Options configured

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
| POST | `/api/speakers/extract` | Authenticated | Extract from schedule |
| POST | `/api/speakers/headshot` | Authenticated | Upload headshot image |
| PUT | `/api/speakers/{id}` | Authenticated | Update speaker |
| DELETE | `/api/speakers/{id}` | Authenticated | Delete speaker |

---

## CI/CD

### GitHub Actions Workflow

**Trigger:** Push to `main` branch (paths: `api/**`) or manual dispatch

**Steps:**

1. Checkout repository
2. Setup Node.js 20.x
3. Install production dependencies only (`npm install --omit=dev`)
4. Login to Azure via OIDC (federated credentials)
5. Restart Function App (clears disk space)
6. Deploy to Azure Functions

**File:** `.github/workflows/azure-functions-deploy.yml`

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

- `STORAGE_ACCOUNT_NAME` - Azure Storage account name (default: `azcorestorage2026`)
- `YOUTUBE_API_KEY` - (Optional) YouTube Data API v3 key for playlist imports

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
| Static Web App | Standard | Frontend hosting with custom domains |
| Function App | EP1 (Elastic Premium) | API backend with managed identity |
| Storage Account | Standard_LRS | Tables + blob storage (no shared keys) |
| User-Assigned Managed Identity | - | RBAC access to storage |
| Application Insights | - | Monitoring and logging |
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

1. **Custom Domain** (optional) - Add custom domain in Azure Portal for the Static Web App
2. **Admin Access** - Configure Azure AD authentication for admin pages
3. **Speaker Headshots** - Upload images to the `speakerheadshots` blob container

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
├── index.html              # Main public website
├── admin.html              # Admin dashboard (navigation hub)
├── schedule-admin.html     # Schedule management
├── speakers-admin.html     # Speakers management
├── styles.css              # All CSS styles (consolidated)
├── staticwebapp.config.json # SWA routing and auth config
├── azure.yaml              # AZD project definition
├── readme.md               # This file
├── api/
│   ├── package.json        # Node.js dependencies
│   ├── host.json           # Functions host config
│   └── src/functions/
│       ├── schedule.js     # Schedule CRUD + CSV/Playlist import/export
│       └── speakers.js     # Speakers CRUD + extract + headshot upload
├── infra/
│   ├── main.bicep          # Main Bicep template (subscription scope)
│   ├── resources.bicep     # All Azure resources with RBAC
│   └── main.parameters.json # Deployment parameters
├── assets/
│   ├── acu-logo.png        # Conference logo
│   └── Loading-Schedule.png # Placeholder image
├── images/
│   └── speakers/           # Speaker headshot images (legacy)
└── .github/workflows/
    └── azure-functions-deploy.yml # CI/CD pipeline
```

---

## Technologies

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Azure Functions (Node.js 20, v4 programming model)
- **Database:** Azure Table Storage
- **Hosting:** Azure Static Web Apps (Standard tier)
- **Authentication:** Azure AD / Microsoft Entra ID
- **Infrastructure:** Bicep, Azure Developer CLI (azd)
- **CI/CD:** GitHub Actions with OIDC
- **Video:** YouTube IFrame API
