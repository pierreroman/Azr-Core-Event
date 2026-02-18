# Testing

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

---

## Playwright — Functional & E2E Tests

The project includes [Playwright](https://playwright.dev/) tests that verify the public site, navigation, API endpoints, admin pages, and accessibility.

### Setup

```bash
npm install                        # install @playwright/test
npx playwright install chromium    # download browser (add firefox/webkit as needed)
```

### Test Suites

| File | What it tests |
|------|---------------|
| `tests/homepage.spec.js` | Hero section, schedule/speakers/sponsors rendering, footer, external scripts |
| `tests/navigation.spec.js` | Anchor scrolling, session/speaker/sponsor/CoC modals open & close |
| `tests/api.spec.js` | GET endpoints return 200, POST without auth is rejected |
| `tests/admin.spec.js` | Admin pages require authentication, redirect to login |
| `tests/accessibility.spec.js` | `lang` attribute, alt text on images, keyboard focus, heading structure |
| `tests/fixtures.js` | Shared mock API data so UI tests don't require a live backend |

### Running Tests

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
