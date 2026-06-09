# Community Online Event

A reusable community conference website featuring dynamic schedule management, YouTube video integration, speaker profiles, sponsor management, event registration, and per-user favorites with Microsoft Entra ID sign-in — all backed by Azure Functions, Table Storage, Blob Storage, and Cosmos DB with managed identity, secured with VNet integration and private endpoints.

Deploy your own instance using Azure Developer CLI (`azd up`) or the interactive `deploy.ps1` script.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Features](docs/features.md) | Public website, admin dashboard, schedule/speaker/sponsor management |
| [Architecture](docs/architecture.md) | Azure resources, data model, storage, security, and scalability |
| [API Reference](docs/api.md) | REST endpoints for schedule, speakers, sponsors, content, and registration |
| [Deployment](docs/deployment.md) | Prerequisites, deploy script, azd commands, infrastructure files, CI/CD |
| [Testing](docs/testing.md) | Local development, Playwright E2E tests, Locust load testing (10K users) |

---

## Quick Start

### Option A: Interactive Script (Recommended)

```powershell
./deploy.ps1
```

### Option B: Manual Commands

```bash
azd auth login --tenant-id <your-tenant-id>
az login --tenant <your-tenant-id>
azd env new <env-name>
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
azd env set AZURE_LOCATION eastus2
azd up
```

See [Deployment](docs/deployment.md) for full details.

---

## Key Features

- **Live Video & Schedule** — Embedded YouTube player with live stream detection, session schedule grouped by day, ICS calendar downloads
- **Sign-in & Personal Favorites** — Microsoft Entra ID sign-in via SWA's built-in `aad` provider; star sessions to build a personal "My Schedule"; favorites persist per user in Cosmos DB
- **Registration** — Configurable registration button with Markdown-rendered modal and external link
- **Speakers & Sponsors** — Dynamic speaker profiles with session linking, tiered sponsor showcase with Markdown descriptions
- **Admin Dashboard** — Full CRUD management for schedule, speakers, sponsors, registration, branding, and content (Entra ID protected)
- **CSV & YouTube Import** — Bulk import sessions from CSV files or YouTube playlists
- **Secure by Default** — VNet + private endpoints, managed identity (no keys, including Cosmos data-plane RBAC), storage lockdown, DOMPurify XSS protection

See [Features](docs/features.md) for complete details.

---

## Architecture Overview

| Component | Technology |
|-----------|-----------|
| Frontend | Azure Static Web Apps (Standard) — HTML5, CSS3, Vanilla JS |
| API | Azure Functions (Flex Consumption, Node.js 20) |
| Data | Azure Table Storage + Blob Storage (Standard_ZRS) |
| Per-user state | Azure Cosmos DB (Serverless, SQL API) — favorites, partition key `/userId` |
| Auth | Microsoft Entra ID via Static Web Apps built-in `aad` provider |
| Networking | VNet, Private Endpoints, Private DNS Zones |
| Identity | User-Assigned Managed Identity with RBAC (Storage + Cosmos) |
| Monitoring | Application Insights + Log Analytics |
| Infrastructure | Bicep, Azure Developer CLI (azd) |

See [Architecture](docs/architecture.md) for data models, security details, and scalability design.

---

## File Structure

```
├── deploy.ps1                 # Interactive deployment script
├── azure.yaml                 # AZD project definition with lifecycle hooks
├── readme.md                  # This file
├── docs/
│   ├── features.md            # Feature documentation
│   ├── architecture.md        # Architecture, data model, security
│   ├── api.md                 # API endpoint reference
│   ├── deployment.md          # Deployment guide and CI/CD
│   └── testing.md             # Testing guide (Playwright + Locust)
├── src/web/                   # Static Web App frontend
│   ├── index.html             # Main public website
│   ├── admin.html             # Admin dashboard
│   ├── schedule-admin.html    # Schedule management
│   ├── speakers-admin.html    # Speakers management
│   ├── sponsors-admin.html    # Sponsors management
│   ├── styles.css             # All CSS styles
│   └── staticwebapp.config.json # SWA routing, auth, security headers
├── api/                       # Azure Functions API
│   └── src/functions/
│       ├── schedule.js        # Schedule CRUD + CSV/Playlist import
│       ├── speakers.js        # Speakers CRUD + headshot upload
│       ├── sponsors.js        # Sponsors CRUD + logo upload
│       ├── content.js         # About/CoC content (Blob Storage)
│       ├── registration.js    # Registration config (Blob Storage)
│       ├── branding.js        # Branding config (Blob Storage)
│       └── favorites.js       # Per-user favorites (Cosmos DB)
├── tests/                     # Playwright E2E tests
├── infra/                     # Bicep infrastructure templates
├── locustfile.py              # Load test script (10K users)
└── load-test-config.yaml      # Azure Load Testing config
```

---

## Technologies

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Azure Functions (Node.js 20, v4 programming model)
- **Database:** Azure Table Storage (events, speakers, sponsors), Azure Cosmos DB Serverless (per-user favorites)
- **File Storage:** Azure Blob Storage (headshots, logos, site content)
- **Hosting:** Azure Static Web Apps (Standard tier)
- **Authentication:** Microsoft Entra ID via SWA built-in `aad` provider — no app registration needed for default tenant
- **Identity:** User-Assigned Managed Identity with RBAC (Storage + Cosmos data-plane)
- **Networking:** VNet, Private Endpoints, Private DNS Zones
- **Caching:** In-memory TTL cache with automatic invalidation on writes
- **Testing:** Playwright (functional/E2E), Locust + Azure Load Testing (performance)
- **Infrastructure:** Bicep, Azure Developer CLI (azd)
- **CI/CD:** Azure Developer CLI (azd) for deployment, GitHub Actions for CodeQL scanning
- **Video:** YouTube IFrame API
- **Markdown:** marked.js for rendering, DOMPurify for XSS sanitization