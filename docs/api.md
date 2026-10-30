# API Reference

All endpoints are served by Azure Functions (Node.js 20, v4 programming model)
through Static Web Apps and API Management. The Function itself is private.
Anonymous reads require no user login through the website; event-content writes
require SWA's `administrator` role. Favorites require `authenticated`, not admin.

The authoritative route/method/role contract is
[http-operations.json](../api/src/shared/http-operations.json). In private mode,
APIM validates its linked SWA JWT/subscription and authenticates to EasyAuth using
its dedicated managed identity. The API verifies that caller before consuming
the separately forwarded end-user principal. Sending `x-ms-client-principal` or
`x-summit-client-principal` yourself does not grant authorization.

---

## Schedule API (`/api/schedule`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/schedule` | Anonymous | Get all sessions |
| GET | `/api/schedule?format=csv` | Anonymous | Export as CSV |
| GET | `/api/schedule/version` | Anonymous | Lightweight schedule version for refresh checks |
| POST | `/api/schedule` | Administrator | Add new session |
| POST | `/api/schedule?action=import` | Administrator | Import from CSV |
| POST | `/api/schedule?action=playlist` | Administrator | Import from YouTube playlist |
| PUT | `/api/schedule/{id}` | Administrator | Update session |
| DELETE | `/api/schedule/{id}` | Administrator | Delete session |

> **Description field format:** The `description` property is stored verbatim and rendered as **Markdown** by the frontend (sanitized with DOMPurify on the client). CSV export/import and YouTube playlist import preserve multi-line Markdown text via RFC 4180 quoting.

---

## Speakers API (`/api/speakers`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/speakers` | Anonymous | Get all speakers |
| GET | `/api/speakers/{id}` | Anonymous | Get single speaker |
| GET | `/api/speakers/headshots` | Anonymous | List all headshot images |
| GET | `/api/speakers/image/{filename}` | Anonymous | Serve a private headshot blob through the API |
| POST | `/api/speakers` | Administrator | Add new speaker |
| POST | `/api/speakers/extract` | Administrator | Extract speakers from schedule |
| POST | `/api/speakers/headshot` | Administrator | Upload headshot image |
| PUT | `/api/speakers/{id}` | Administrator | Update speaker |
| DELETE | `/api/speakers/{id}` | Administrator | Delete speaker |

---

## Sponsors API (`/api/sponsors`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/sponsors` | Anonymous | Get all sponsors (sorted by tier) |
| GET | `/api/sponsors/{id}` | Anonymous | Get single sponsor |
| GET | `/api/sponsors/logos` | Anonymous | List all logo images |
| GET | `/api/sponsors/image/{filename}` | Anonymous | Serve a private sponsor-logo blob through the API |
| POST | `/api/sponsors` | Administrator | Add new sponsor |
| POST | `/api/sponsors/logo` | Administrator | Upload logo image |
| PUT | `/api/sponsors/{id}` | Administrator | Update sponsor |
| DELETE | `/api/sponsors/{id}` | Administrator | Delete sponsor |

---

## Content API (`/api/content`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/content/{type}` | Anonymous | Get markdown content (about, code-of-conduct) |
| PUT | `/api/content/{type}` | Administrator | Save markdown content to Blob Storage |
| DELETE | `/api/content/{type}` | Administrator | Reset content to defaults |

---

## Registration API (`/api/registration`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/registration` | Anonymous | Get registration config (enabled, title, URL, description) |
| PUT | `/api/registration` | Administrator | Save registration config to Blob Storage |

---

## Branding API (`/api/branding`)

Cross-device branding configuration stored in Blob Storage (`sitecontent/branding-config.json`). Used to customize the event name, tagline, logo, color palette, and event dates without code changes.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/branding` | Anonymous | Get branding config (returns defaults if not yet saved, with `isDefault: true`) |
| PUT | `/api/branding` | Administrator | Save branding config to Blob Storage |

**Fields:** `eventName`, `tagLine`, `logo`, `primaryColor`, `secondaryColor`, `accentColor`, `hideSponsors`, `eventStartDate`, `eventEndDate`, `onDemandChannelInput`, `onDemandPlaylistId`, `onDemandChannelName`, `onDemandChannelUrl`.

**On-demand YouTube channel.** When the watch page detects that every scheduled session is in the past, it shuffle-plays the configured YouTube channel's uploads playlist (defaults to ITOpsTalk when unset). Admins set this via the **On-Demand YouTube Channel** field in the Branding page; the server-side `resolveYouTubeSource()` accepts a channel URL, `@handle`, channel ID (`UC…`), or uploads playlist ID (`UU…`), fetches the YouTube channel page to resolve the uploads playlist ID + channel name, and persists all four `onDemand*` fields together. SSRF guard: only `www.youtube.com`, `youtube.com`, and `m.youtube.com` are accepted as fetch targets. A bad input returns **HTTP 400** with `{ error, details }` and nothing is written.

---

## Favorites API (`/api/favorites`)

Per-user favorite sessions backed by Cosmos DB. The signed-in user is identified
by validated SWA context forwarded by APIM after Entra ID sign-in, separately from
APIM's backend machine identity. Clients never supply a user ID.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/favorites` | Authenticated | Returns `{ sessionIds: string[] }` for the current user |
| PUT | `/api/favorites/{sessionId}` | Authenticated | Adds (upserts) a favorite |
| DELETE | `/api/favorites/{sessionId}` | Authenticated | Removes a favorite (idempotent — 204 even if not present) |
| POST | `/api/favorites/merge` | Authenticated | Body `{ sessionIds: string[] }`; bulk-upserts. Used once on first sign-in to migrate anonymous `localStorage` favorites |

---

## Environment Variables

Configure these in `api/local.settings.json` for local development, or as App Settings in Azure for production:

| Variable | Description | Required |
|----------|-------------|----------|
| `API_AUTH_MODE` | `apim` for private deployments; `direct` retained only for approved legacy migration/local tests | **Yes** in private deployment |
| `APIM_PRINCIPAL_ID` | Exact APIM managed-identity object/principal ID; must match EasyAuth's validated caller | **Yes** in private deployment |
| `AZURE_STORAGE_ACCOUNT` | Azure Storage account name | **Yes** |
| `STORAGE_ACCOUNT_NAME` | Alternative storage account name (fallback) | No (use `AZURE_STORAGE_ACCOUNT`) |
| `AZURE_CLIENT_ID` | Client ID for user-assigned managed identity | No (uses default credential locally) |
| `COSMOS_ENDPOINT` | Cosmos DB account endpoint (e.g. `https://azcos<token>.documents.azure.com:443/`) | **Yes** for favorites API |
| `COSMOS_DATABASE` | Cosmos DB database name | No (defaults to `event`) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for playlist imports | No (only needed for playlist import) |

These are API runtime settings, not the operator's azd environment variables.
Infrastructure supplies private-mode identity/network settings. Never relax them
or paste production credentials into local settings to bypass a failed test.

## Empty-site responses

Fresh collections are valid API results, not missing-data errors:
`/schedule` returns an object with `schedule: []`, `/speakers` with `speakers: []`,
and `/sponsors` with `sponsors: []` (plus existing metadata fields). `/branding`
returns defaults including `eventName`; `/registration` includes `enabled: false`;
the two content endpoints include `content` with sample default Markdown.
No authenticated favorites are seeded. The deployment smoke test checks JSON
content type and these response shapes; it does not replace signed-in browser
or administrator CRUD acceptance.

> **Important:** The `AZURE_STORAGE_ACCOUNT` environment variable is required. The API will not start correctly without a valid storage account name configured.
