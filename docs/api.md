# API Reference

All API endpoints are served by Azure Functions (Node.js 20, v4 programming model). Anonymous endpoints are publicly accessible; authenticated endpoints require Microsoft Entra ID login via the Static Web App.

---

## Schedule API (`/api/schedule`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/schedule` | Anonymous | Get all sessions |
| GET | `/api/schedule?format=csv` | Anonymous | Export as CSV |
| POST | `/api/schedule` | Authenticated | Add new session |
| POST | `/api/schedule?action=import` | Authenticated | Import from CSV |
| POST | `/api/schedule?action=playlist` | Authenticated | Import from YouTube playlist |
| PUT | `/api/schedule/{id}` | Authenticated | Update session |
| DELETE | `/api/schedule/{id}` | Authenticated | Delete session |

---

## Speakers API (`/api/speakers`)

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

---

## Sponsors API (`/api/sponsors`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/sponsors` | Anonymous | Get all sponsors (sorted by tier) |
| GET | `/api/sponsors/{id}` | Anonymous | Get single sponsor |
| GET | `/api/sponsors/logos` | Anonymous | List all logo images |
| POST | `/api/sponsors` | Authenticated | Add new sponsor |
| POST | `/api/sponsors/logo` | Authenticated | Upload logo image |
| PUT | `/api/sponsors/{id}` | Authenticated | Update sponsor |
| DELETE | `/api/sponsors/{id}` | Authenticated | Delete sponsor |

---

## Content API (`/api/content`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/content/{type}` | Anonymous | Get markdown content (about, code-of-conduct) |
| PUT | `/api/content/{type}` | Authenticated | Save markdown content to Blob Storage |
| DELETE | `/api/content/{type}` | Authenticated | Reset content to defaults |

---

## Registration API (`/api/registration`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/registration` | Anonymous | Get registration config (enabled, title, URL, description) |
| PUT | `/api/registration` | Authenticated | Save registration config to Blob Storage |

---

## Favorites API (`/api/favorites`)

Per-user favorite sessions backed by Cosmos DB. The signed-in user is identified by the `x-ms-client-principal` header that Azure Static Web Apps injects after Entra ID sign-in — clients never supply a user ID.

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
| `AZURE_STORAGE_ACCOUNT` | Azure Storage account name | **Yes** |
| `STORAGE_ACCOUNT_NAME` | Alternative storage account name (fallback) | No (use `AZURE_STORAGE_ACCOUNT`) |
| `AZURE_CLIENT_ID` | Client ID for user-assigned managed identity | No (uses default credential locally) |
| `COSMOS_ENDPOINT` | Cosmos DB account endpoint (e.g. `https://azcos<token>.documents.azure.com:443/`) | **Yes** for favorites API |
| `COSMOS_DATABASE` | Cosmos DB database name | No (defaults to `event`) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for playlist imports | No (only needed for playlist import) |

> **Important:** The `AZURE_STORAGE_ACCOUNT` environment variable is required. The API will not start correctly without a valid storage account name configured.
