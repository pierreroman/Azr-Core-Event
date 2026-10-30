# Community Online Event API

Azure Functions v4 programming model, Node.js 20, with Azure SDK managed identity
access to private Table/Blob Storage and Entra-authenticated Cosmos DB favorites.

## Structure and authorization

- [src/index.js](src/index.js) installs the authorization boundary before loading
  function registrations.
- [src/shared/http-operations.json](src/shared/http-operations.json) is the shared
  route/method/role contract used by the API and APIM.
- [src/shared/authorization.js](src/shared/authorization.js) verifies the gateway
  principal and trusted SWA user context. APIM's machine identity is **not** a user.
- [src/functions/](src/functions/) implements schedule, speakers, sponsors, content,
  registration, branding and per-user favorites.
- [test/](test/) contains Node authorization and data-isolation tests.

Public content reads are anonymous **through SWA/APIM**, not through a public
Function endpoint. Content writes/uploads require `administrator`; favorites
require an authenticated user and remain partitioned by that user's SWA ID.

## Dependencies and tests

```powershell
Set-Location .\api
npm ci
npm test
```

The API has its own committed lockfile. Production packaging runs `npm ci
--omit=dev` on a temporary private Linux agent; do not copy workstation
`node_modules`. The private build retains pinned Node.js 20.20.2; review its
lifecycle/policy before approving a new production deployment.

## Local development

Install Azure Functions Core Tools v4 and use [host.json](host.json). Create an
untracked `local.settings.json` with `IsEncrypted=false` and a `Values` object
containing `FUNCTIONS_WORKER_RUNTIME=node` plus the settings in the
[API configuration reference](../docs/api.md#environment-variables).

```powershell
az login
npm start
```

Private Azure resources require real private network/DNS connectivity and data
RBAC. Signing in to Azure CLI alone does not grant network access. Several data
handlers use managed identity credentials and are not an automatic CLI/Azurite
emulator workflow. SWA's real Entra session and gateway caller evidence cannot be
proved by supplying fabricated headers locally. Use offline authorization tests
or an approved isolated deployed environment; never relax production auth to make
a local test pass.

## Deployment

From the repository root, follow [Deployment](../docs/deployment.md).
New environments use `.\deploy.ps1`; existing private environments use its
`-Action Deploy` code-only path. Function/Storage public access must never be
reopened for a workstation release. Raw `func publish`/`azd deploy` from a public
workstation is not the supported private deployment route.

See [API reference](../docs/api.md) for endpoints and
[Testing](../docs/testing.md) for live/manual acceptance requirements.
