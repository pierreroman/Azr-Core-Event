# Community Online Event

A reusable community conference website featuring dynamic schedule management, YouTube video integration, speaker profiles, sponsor management, event registration, and per-user favorites with Microsoft Entra ID sign-in — all backed by Azure Functions, Table Storage, Blob Storage, and Cosmos DB with managed identity, secured with VNet integration and private endpoints.

Deploy a reusable, empty instance with [deploy.ps1](deploy.ps1). New environments
use **Static Web Apps -> API Management Standard v2 -> private Function App**.
Function and Storage public access stay disabled, including deployment.
Do not bootstrap with bare `azd up` from a public workstation.

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

### From scratch

Install PowerShell 7+, Node.js/npm, Azure CLI, Azure Developer CLI and
`ssh-keygen`. Confirm regional capacity, tenant app-registration/RBAC permissions
and costs first: APIM Standard v2 is a substantial fixed cost. Then:

```powershell
npm ci
az login --tenant <tenant-id>
azd auth login --tenant-id <tenant-id>
.\deploy.ps1
```

The script prompts for target, monitored publisher contact, administrator emails
and deployment/cost approval. It creates private infrastructure, a secretless
backend app and temporary private deployment VM, deploys API/frontend, tests public
response shapes/network settings, prints admin invitation URLs and cleans the VM.
No production data, domains or user roles are copied. Accept the invitation in
your browser before configuring branding, sessions, speakers and sponsors.

### Update or package

```powershell
# Code only; does not reprovision the site or modify the backend Entra app
.\deploy.ps1 -Action Deploy -EnvironmentName my-event -Approved

# Output directory must already exist
npm run package:site -- -OutputPath C:\releases\community-event.zip
```

See [Deployment](docs/deployment.md) for permissions, exact commands, cost,
recovery, invitation acceptance and manual verification.
**The new bootstrap workflow is locally tested, not yet deployed to a fresh Azure
environment.** Existing Summit migration evidence is documented separately.
Before a new production rollout, also resolve/review the
[dependency and runtime release gates](docs/testing.md#dependency-and-runtime-release-gates):
the current MSAL/Identity audit advisory and retained Node.js 20 lifecycle.

---

## Key Features

- **Live Video & Schedule** — Embedded YouTube player with live stream detection, session schedule grouped by day, ICS calendar downloads
- **Post-event on-demand loop** — When the event is over, the watch page shuffle-plays an admin-configured YouTube channel's uploads (defaults to ITOpsTalk)
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
| Gateway | API Management Standard v2; SWA JWT/subscription validation and backend managed identity |
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
├── deploy.ps1                 # Bootstrap, code-only Deploy and agent Cleanup
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
├── scripts/                   # Identity, private deployment, verification and source packaging
├── tests/                     # Playwright + offline PowerShell deployment tests
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
- **Authentication:** SWA built-in `aad` for user login; separate secretless single-tenant backend app for APIM-to-Function authentication
- **Identity:** User-Assigned Managed Identity with RBAC (Storage + Cosmos data-plane)
- **Networking:** VNet, Private Endpoints, Private DNS Zones
- **Caching:** In-memory TTL cache with automatic invalidation on writes
- **Testing:** Playwright (functional/E2E), Locust + Azure Load Testing (performance)
- **Infrastructure:** Bicep, Azure Developer CLI (azd)
- **CI/CD:** Azure Developer CLI (azd) for deployment, GitHub Actions for CodeQL scanning
- **Video:** YouTube IFrame API
- **Markdown:** marked.js for rendering, DOMPurify for XSS sanitization