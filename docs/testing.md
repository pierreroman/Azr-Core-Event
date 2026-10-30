# Testing

## Reproducible deployment checks (offline)

From the repository root with Node.js/npm and PowerShell 7+:

```powershell
npm ci
npm run test:authorization
npm run test:migration
npm run test:deployment
npm run test:private-deployment
node --test tests/timezone-utils.test.js
```

The PowerShell suites mock Azure/Graph commands; they do not create resources.
They cover bootstrap refusal/resume gates, dedicated secretless identity,
environment isolation, private-default stages, invitations, failure cleanup,
source ZIP contents/SHA256, Run Command output integrity, deployment evidence and
exact-owned-resource cleanup. Private-agent Bash syntax validation needs Bash
(the test supports the Windows Git Bash installation).

Compile the infrastructure without deploying:

```powershell
az bicep build --file .\infra\main.bicep --stdout
az bicep build --file .\infra\existing-api-gateway.bicep --stdout
az bicep build --file .\infra\deployment-agent.bicep --stdout
```

`npm run package:site -- -OutputPath C:\releases\site.zip` creates an allowlisted
source ZIP and per-file manifest. The offline suite opens it, validates every
file's hash/length, and checks that environment/settings/dependency state is absent.
It is not a prebuilt Function package.

### New environment live acceptance

The new bootstrap orchestration is **not yet fresh-Azure-tested**. Local passing
tests do not establish tenant policy, region/SKU quota, role propagation, APIM
activation, download access or SWA identity propagation.

After separate target/cost approval, follow [Deployment](deployment.md), then run:

```powershell
.\scripts\Test-SiteDeployment.ps1 -EnvironmentName my-event
```

This checks real Disabled network settings, exact SWA/APIM linkage and seven
public API JSON shapes, allowing empty event collections. Independently confirm
private redeployment completed and the temporary VM/roles were removed.
Browser acceptance is mandatory: accept the invitation, verify admin/non-admin
roles, exercise reversible content CRUD/uploads in the test site, verify favorites
after refresh and isolation between two users, inspect images and custom domains.
Record failures; do not treat redirects, login HTML or a CLI exit alone as success.
Production's earlier private migration evidence is not proof of this new bootstrap.

### Dependency and runtime release gates

The newly committed API lock was checked with `npm audit --omit=dev`. Compatible
updates removed the reported `fast-xml-parser` critical advisories and old `uuid`
finding, but the refreshed tree still reports **two high-severity audit entries**
for `@azure/msal-node` and its `@azure/identity` parent
([GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5)).
These entries describe one transitive advisory chain, not two proven exploitable
application paths. No clean security audit is claimed. Review/remediate with
supported SDK versions before a new production rollout; do not force a breaking
transitive override without compatibility tests.

The public npm audit endpoint failed TLS in the operator environment; the
configured registry returned the findings. Lockfiles themselves reference public
npm tarballs and preserve integrity hashes. Root CLI dependencies also emit
deprecation warnings; they are deployment tooling, not bundled API runtime.
Node.js 20.20.2 is retained from the existing private deployment; runtime lifecycle
and organizational support policy are separate outstanding release checks.

## Private API migration checks

```powershell
npm run test:authorization
npm run test:migration
```

These are local, non-Azure-mutating tests for the shared HTTP operation manifest,
gateway caller/role checks, favorites isolation, and deployment-stage safeguards.
The opt-in [private API acceptance suite](../tests/private-api.spec.js) requires
an approved deployed test environment. See the [migration runbook](private-api-migration.md#11-implemented-rollout-controls-and-operator-commands)
for configuration and the full live acceptance matrix; local tests alone do not
establish that SWA-to-APIM user identity propagation works.

## Local Development

### Prerequisites

- Node.js 20.x
- Azure CLI (logged in with `az login`)
- [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) v4

### Running the API Locally

```bash
Set-Location .\api
npm ci

# Configure untracked local settings and approved private network/data RBAC
func start
```

---

See the [API development notes](../api/README.md): private data endpoints require
private connectivity, and managed-identity-only handlers are not automatically
usable with workstation CLI credentials. Local mocked tests cannot establish the
real Entra/SWA/APIM trust boundary. Never reopen production endpoints for testing.

## Playwright — Functional & E2E Tests

The project includes [Playwright](https://playwright.dev/) tests that verify the public site, navigation, API endpoints, admin pages, and accessibility.

### Setup

```bash
npm ci                             # install pinned dependency tree
npx playwright install chromium    # download browser (add firefox/webkit as needed)
```

### Test Suites

| File | What it tests |
|------|---------------|
| `tests/homepage.spec.js` | Watch page: hero, video section, footer, external scripts, no schedule/speakers/sponsors content |
| `tests/navigation.spec.js` | Side-rail rendering, active state, cross-page navigation, mobile drawer (≤900px), rail collapse persistence, Code of Conduct dedicated page + session/speaker/sponsor modals on their dedicated pages |
| `tests/theme.spec.js` | Dark/light toggle, `localStorage` persistence, `prefers-color-scheme` honored, theme applies across pages, `aria-pressed` state |
| `tests/accessibility.spec.js` | `lang` attribute, `<nav>` landmark on every page, `aria-current="page"` on active rail item, skip-to-content link, alt text, headings, both themes render |
| `tests/admin.spec.js` | Admin pages require auth; admin pages mount the admin rail (`data-rail="admin"`); legacy `.user-bar` is gone |
| `tests/api.spec.js` | GET endpoints return 200, POST without auth is rejected (requires a live API; skip locally) |
| `tests/fixtures.js` | Shared mock API data so UI tests don't require a live backend |

### Running Tests

```bash
# Against localhost (start SWA CLI first: swa start)
npm test

# Against a live/staging site
$env:BASE_URL="https://<approved-test-site>.azurestaticapps.net"; npm test

# Useful variations
npm run test:chromium       # Chromium only (fastest)
npm run test:headed         # Watch browser while tests run
npm run test:ui             # Interactive Playwright UI
npm run test:api            # API endpoint tests only
npm run test:report         # Open the HTML results report
```

### Configuration

- Config file: `playwright.config.js`
- Default `baseURL`: `http://localhost:4280` (override with `BASE_URL` env var)
- Browsers: Chromium, Firefox, WebKit + Mobile Chrome & Safari viewports
- Traces captured on first retry, screenshots on failure
- HTML report generated in `playwright-report/`

---

## Load Testing — 10K Concurrent Users

The project includes a [Locust](https://locust.io/) load test script and an Azure Load Testing configuration to simulate **10,000 concurrent users** distributed across three geographic regions.

### Traffic Distribution

| Region | Azure Region | Engine Instances | Users | Traffic Share |
|--------|-------------|-----------------|-------|---------------|
| North America | `eastus2` | 7 | 7,000 | 70% |
| Europe | `westeurope` | 2 | 2,000 | 20% |
| Asia-Pacific | `southeastasia` | 1 | 1,000 | 10% |

### Simulated User Behavior

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

### Running Load Tests

**Local smoke test** (validate script with small user count):

```bash
pip install locust requests
locust -f locustfile.py --host https://<approved-test-site>.azurestaticapps.net -u 50 -r 5 --run-time 2m --headless
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

Do not aim load tests at Summit production without explicit service-owner
approval. The 10K profile is a target configuration, not measured capacity or an
SLO guarantee for a newly deployed APIM-backed site.

### Failure Criteria (auto-configured)

| Metric | Threshold |
|--------|-----------|
| Average response time | > 3 seconds |
| Error rate | > 5% |
| P99 latency | > 10 seconds |
| Auto-stop | Error rate > 80% for 60s |

### Files

| File | Purpose |
|------|---------|
| `locustfile.py` | Locust load test script with weighted user scenarios |
| `load-test-config.yaml` | Azure Load Testing YAML config with regional distribution |
