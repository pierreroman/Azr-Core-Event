
## Your Results at a Glance — Verdict: **Excellent**

### Final Summary Table

| Endpoint | Requests | Failures | Avg (ms) | Min (ms) | Max (ms) | Median (ms) | req/s |
|---|---|---|---|---|---|---|---|
| `GET /` (homepage) | 943 | 0 (0%) | **53** | 36 | 544 | 41 | 7.95 |
| `GET /api/schedule` | 261 | 0 (0%) | **72** | 43 | 552 | 60 | 2.20 |
| `GET /api/speakers` | 272 | 0 (0%) | **76** | 43 | 572 | 56 | 2.29 |
| `GET /api/content/about` | 113 | 0 (0%) | **78** | 42 | 479 | 58 | 0.95 |
| `GET /api/sponsors` | 98 | 0 (0%) | **77** | 43 | 380 | 59 | 0.83 |
| `GET /api/content/code-of-conduct` | 99 | 0 (0%) | **84** | 42 | 627 | 59 | 0.83 |
| `GET /styles.css` | 99 | 0 (0%) | **64** | 37 | 424 | 47 | 0.83 |
| **Total** | **1,885** | **0 (0%)** | **64** | 36 | 627 | 51 | **15.9** |

### How to Read Each Column

| Column | What It Means | Your Result |
|---|---|---|
| **# reqs** | Total requests completed during the 2-minute run | 1,885 total |
| **# fails** | Requests that returned errors (non-200) | **0 — perfect** |
| **Avg** | Average response time in milliseconds | 64ms — very fast |
| **Min / Max** | Fastest and slowest single request | 36ms / 627ms |
| **Med** (Median) | 50th percentile — half of requests were faster than this | 51ms |
| **req/s** | Requests per second (throughput) | 15.9 total |
| **failures/s** | Errors per second | 0.00 |

### Percentile Table (Bottom of Output)

This is the most important part for production readiness:

| Percentile | Meaning | Your Value |
|---|---|---|
| **P50** | Half of users see this or better | **51ms** |
| **P90** | 90% of users see this or better | **80ms** |
| **P95** | 95% of users (worst-case typical) | **120ms** |
| **P99** | 1 in 100 requests — outlier latency | **390ms** |
| **P100** | Absolute worst single request | **630ms** |

### What This Tells You

1. **Zero failures** — the site handled all 50 concurrent users without a single error
2. **Sub-100ms median** — the site is very responsive; Azure Static Web App + CDN edge caching is working well
3. **P99 under 400ms** — even the slowest 1% of requests are still fast
4. **Homepage is fastest** (41ms median) — static HTML served from CDN edge
5. **API endpoints are slightly slower** (56-60ms median) — expected since they hit Azure Functions + Table Storage
6. **Max of 627ms** was a single code-of-conduct request — likely a cold-start; not concerning

### Scaling to 10K Users

This 50-user smoke test shows the site is healthy. To extrapolate to 10,000 users, you'd need Azure Load Testing with the load-test-config.yaml because:
- A single machine can't simulate 10K connections realistically
- Geographic distribution matters (CDN edge server selection varies by region)
- Azure Load Testing gives you server-side metrics alongside client metrics

The good news: at 50 users with 0% errors and sub-100ms medians, the Azure Static Web App + Functions architecture should scale well to 10K since SWA is CDN-backed and Functions auto-scale.

