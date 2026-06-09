# Deployment

This project deploys entirely via Azure Developer CLI (`azd`). No GitHub Actions deployment workflows are required.

---

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) installed
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) installed
- PowerShell 7+ (for the interactive script)
- Azure subscription with Contributor access

---

## What Gets Deployed

| Resource | SKU | Description |
|----------|-----|-------------|
| Static Web App | Standard | Frontend hosting with custom domains and built-in CDN; built-in Entra ID `aad` provider |
| Function App | Flex Consumption (FC1) | API backend with managed identity, scales to 100 instances |
| Storage Account | Standard_ZRS | Zone-redundant Tables + Blob Storage (no shared keys) |
| Cosmos DB | Serverless (SQL API) | Per-user favorites — `event` db, `favorites` container, partition key `/userId`; `disableLocalAuth: true` (data-plane RBAC only) |
| Virtual Network | 10.0.0.0/16 | Network isolation with subnets for Function App and private endpoints |
| Private Endpoints | — | Blob, Table, and Queue private connectivity |
| Private DNS Zones | — | DNS resolution for storage private endpoints |
| User-Assigned Managed Identity | — | RBAC access to Storage (Blob/Table/Queue) and Cosmos DB Built-in Data Contributor |
| Application Insights | — | Monitoring and logging |
| Log Analytics Workspace | PerGB2018 | Centralized logs |

---

## Option A: Interactive Deploy Script (Recommended)

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

---

## Option B: Manual azd Commands

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

---

## What `azd up` Does

1. **Register resource providers** — Preprovision hook registers all required Azure providers
2. Create a new resource group: `rg-{environment-name}`
3. Provision all Azure resources using Bicep (VNet, private endpoints, storage, Function App, SWA)
4. **Re-enable storage public access** — Predeploy hook temporarily enables public network access for deployment
5. Deploy the Static Web App frontend (from `src/web/`)
6. Deploy the Function App backend (from `api/` with remote build)
7. **Lock down storage** — Postdeploy hook disables public network access
8. Link the Function App to the Static Web App (postprovision hook)
9. Invite administrators to the Static Web App (postprovision hook)

---

## Post-Deployment Configuration

After deployment completes:

1. **Custom Domain** (optional) — Add custom domain in Azure Portal for the Static Web App
2. **Admin Access** — Microsoft Entra ID authentication is pre-configured in `staticwebapp.config.json`
3. **Speaker Headshots** — Upload images via the Speakers Admin page (`/speakers-admin.html`)
4. **Sponsor Logos** — Upload images via the Sponsors Admin page (`/sponsors-admin.html`)
5. **Branding** — Customize event name, logo, and colors via the Admin Dashboard (`/admin.html`)

---

## Redeployment & Other azd Commands

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

> **Heads-up on the `web` service layout:** `azure.yaml` declares the web service with `project: ./src` and `dist: web` (rather than `project: ./src/web` and `dist: .`). The Static Web Apps backend now rejects deploys with *"Current directory cannot be identical to or contained within artifact folders"* when the swa CLI's cwd matches the output location. Keep `project` one level above `dist`.

---

## Infrastructure Files

| File | Description |
|------|-------------|
| `deploy.ps1` | Interactive deployment script (prompts for all inputs) |
| `azure.yaml` | AZD project definition with services and lifecycle hooks (preprovision, predeploy, postdeploy, postprovision) |
| `infra/main.bicep` | Main template (subscription scope) |
| `infra/resources.bicep` | All Azure resources with RBAC, VNet, private endpoints |
| `infra/main.parameters.json` | Parameter values |

---

## CI/CD

### CodeQL Security Analysis (`.github/workflows/codeql.yml`)

**Trigger:** Push to `main`, pull requests on `main`, weekly schedule (Monday at midnight UTC)

- Automated JavaScript/TypeScript code scanning
- Security vulnerability detection
- Results reported to GitHub Security tab

> **Note:** Deployment is handled entirely by `azd`. No GitHub Actions deployment workflows are needed.
