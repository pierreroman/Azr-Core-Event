# Summit API private-connectivity migration

**Status:** Production private migration deployed and verified October 29, 2026.
**Scope:** S360 finding "App Service must have public access disabled" for
`azfn655zgsp5au6gu`. This document retains the original design and historical
baseline below; the live record here describes the completed production change.

**Deploying a NEW site:** follow [Deployment](deployment.md), not the staged
cutover commands in this historical runbook. The new default is `private`;
Bootstrap automates the backend app and temporary private deployment agent.
The `direct`/`prepare`/`gateway` stages remain explicit options for existing-site
migrations. The new workflow is offline-tested but not yet fresh-Azure-verified.

### Production deployment record

- Website https://azureinfrasummit.com and www/default SWA hostnames retain
  working same-origin API routes through `apim-summit-655zgsp5au6gu` Standard v2.
- Function `azfn655zgsp5au6gu` and Storage `azst655zgsp5au6gu` both have explicit
  public network access Disabled. Function/SCM private DNS resolves to 10.0.2.7;
  Blob resolves to 10.0.2.4. Existing subnet NSGs and data resources were preserved.
- Gateway uses generated SWA product `nice-meadow-0d36a1f0f`, subscription/JWT
  validation and dedicated managed-identity backend authentication. Never reset
  its linked-product named value to `unlinked` on subsequent provisioning.
- All 12 live API/private acceptance tests passed after lockdown. Actual private
  One Deploy `38ababef-21e6-469b-9dd3-1e498e17315c` completed with status 4,
  complete/active true; Function and Storage remained Disabled before and after.
- User independently confirmed external-browser favorites continuity across
  cutover, test-favorite removal persistence, and administrator page access.
  Schedule and admin page still worked after final lockdown/private deployment.
- Genuine non-APIM VM backend-audience token was denied both privately and via a
  forced public-endpoint route. No token was printed/transferred. This does not
  claim an external-host test using an authorized APIM token. Production event
  CRUD/uploads/extraction, two-user browser isolation and load testing were not
  repeated; corresponding broader coverage is isolated-test/unit-test evidence.
- Initial APIM activation failed; user-approved deletion/recreation recovered it.
  No direct-backend cutover occurred before the replacement gateway was healthy.
- Original release retained privately as
  `rollback-before-private-migration-20261029.zip`. Future releases require an
  approved private deployment agent. Do not silently reopen public access.
- Temporary production VM, NIC, OS disk, agent-only NSG, three scoped roles and
  validation probe blob were removed with explicit approval. Final post-teardown
  verification at 19:29 UTC again passed all 12 live tests. Both stage variables
  remain `private`; `PRIVATE_DEPLOYMENT_APPROVED=false` deliberately blocks future
  releases until a replacement private deployment environment is verified.
- Both production and isolated-test gateways remain billable. Production APIM
  retail estimate was approximately USD 700 per 730-hour month before extras;
  test resources require separate cleanup approval.
- These are live configuration/test results, not confirmation of S360 scanner
  closure, clean compliance scanning, multi-region failover or load-test success.

## 1. Goal and decision

Keep the Summit website public and preserve its same-origin `/api/*` URLs,
anonymous public reads, administrator operations, and signed-in favorites.
Make the Function App reachable only through private connectivity, with
`properties.publicNetworkAccess` explicitly set to `Disabled`.

Selected and deployed topology:

```text
Public browser
    |
    | HTTPS: azureinfrasummit.com or www.azureinfrasummit.com
    v
Existing Static Web App Standard
    | Existing sign-in, route authorization, and /api/* proxy
    | SWA-generated gateway token + product subscription
    v
API Management Standard v2 (public, authenticated gateway)
    | Validate linked-SWA token and subscription
    | Preserve trusted end-user context separately
    | Authenticate to backend using a dedicated managed identity
    |
    | Outbound VNet integration, HTTPS
    v
Function App private endpoint, target subresource: sites
    |
    v
Existing Function App Flex Consumption
    | Public network access: Disabled
    | Backend authentication: require authorized APIM identity
    v
Existing Storage / Cosmos DB / monitoring
```

**The public boundary moves to an authenticated API gateway; the entire
application does not become private.** Confirm that this is an approved
gateway pattern with the S360/security owner before implementation. If
policy also forbids a public API Management gateway, this design must change.

API Management Standard v2 was selected because it supports outbound VNet
integration and Static Web Apps supports an API Management linked backend.
The Function App's existing FC1 plan supports private endpoints; a move to a
Premium Function plan is not required solely for private endpoint support.
Capacity was demonstrated by successful approved provisioning in eastus2.
This is not a reservation or guarantee of future regional availability.

## 2. Historical pre-migration environment

Read-only ARM/CLI inspection and HTTP baseline on October 23, 2026:

| Item | Observed state | Design consequence |
| --- | --- | --- |
| Subscription | `ca-devrelstudios-ha-project`, `91a0e6ac-7b46-4b5e-9a38-f5b1f22dc875` | Explicitly scope all future operations |
| Resource group / region | `rg-devrel-studio` / `eastus2` | Place proposed regional networking and gateway here unless governance requires a shared gateway |
| Static Web App | `azswa655zgsp5au6gu`, Standard | Retain this resource, custom domains, identities, and role assignments |
| SWA hostname | `nice-meadow-0d36a1f0f.6.azurestaticapps.net` | Baseline and fallback site hostname |
| Custom domains | `azureinfrasummit.com`, `www.azureinfrasummit.com`, both Ready | No public DNS cutover needed for the proposed API migration |
| Current backend link | Function App `azfn655zgsp5au6gu`, provisioning Succeeded | Replace only during an approved cutover |
| Function plan | `azasp655zgsp5au6gu`, Flex Consumption FC1 | Retain plan and existing scale configuration |
| Function network | Public access Enabled; allow-all IP rule; no private endpoint | Add inbound Private Link before disabling public access |
| Function authentication | Enabled, requireAuthentication true; SWA and Entra ID providers enabled | Authentication exists, but is not private network isolation |
| Function transport | HTTPS-only; minimum TLS 1.2 | Preserve |
| Existing VNet | `azvnet655zgsp5au6gu`, `10.0.0.0/16` | Reuse; do not recreate |
| Function integration subnet | `functionapp`, `10.0.1.0/24`, delegation `Microsoft.App/environments` | Retain unchanged; this is outbound integration, not private ingress |
| Private endpoint subnet | `private-endpoints`, `10.0.2.0/24`, no delegation | Candidate location for the Function private endpoint |
| Existing private endpoints | Blob, Table, Queue | Retain endpoints, DNS, identity, and storage permissions |
| Existing private DNS | Blob, Table, Queue zones | Add the separate App Service private DNS zone |
| Gateway inventory | No APIM, Application Gateway, or Front Door profile found in this resource group | A shared approved gateway elsewhere remains an option; subscription-wide gateway discovery was not performed |
| Monitoring | `azai655zgsp5au6gu`, `azlog655zgsp5au6gu` | Reuse for gateway/backend correlation and alerts where supported |

Other inventoried resources include the existing managed identity, Cosmos DB,
public DNS zone, storage endpoint NICs, DNS VNet links, network security group,
Event Grid system topic, load-testing resource, and monitoring alert resources.
Retain them; this finding does not authorize changing their network posture.
No assessment of their wider compliance is implied.

### HTTP baseline

These were non-mutating GETs, without following redirects:

| URL | HTTP status |
| --- | --- |
| `https://nice-meadow-0d36a1f0f.6.azurestaticapps.net/` | 200 |
| `https://nice-meadow-0d36a1f0f.6.azurestaticapps.net/api/schedule` | 200 |
| `https://azfn655zgsp5au6gu.azurewebsites.net/api/schedule` | 401 |

The direct 401 confirms rejection of this anonymous request, not rejection of
all other callers. Full endpoint authorization and browser sign-in have not
been exercised.

## 3. Resource and configuration changes

Names below are candidates, not reserved names or an approved bill of materials.
Validate naming, regional availability, permissions, and capacity before IaC.

| Action | Resource / configuration | Details |
| --- | --- | --- |
| Add | `Microsoft.ApiManagement/service` | Candidate `apim-summit-655zgsp5au6gu`, Standard v2, eastus2; dedicated managed identity |
| Add | APIM integration subnet | Candidate `apim-integration`, `10.0.3.0/24`; confirm IPAM availability beyond the observed subnet list |
| Add | Subnet delegation and dedicated NSG | Delegate APIM subnet to `Microsoft.Web/serverFarms`; do not reuse the Function integration or private endpoint subnet |
| Add | `Microsoft.Network/privateEndpoints` | Candidate `pe-function-655zgsp5au6gu`, targeting the existing Function App's `sites` subresource |
| Add | `Microsoft.Network/privateDnsZones` | `privatelink.azurewebsites.net`, VNet link with registration disabled, private endpoint DNS zone group |
| Configure | APIM APIs, operations, backend, product, policies | Preserve exact `/api/*` routes and HTTP methods; expose only intended operations |
| Configure | Function backend authentication | Explicit Entra audience, issuer, and APIM identity authorization; reject other callers |
| Configure | SWA backend link | Change from Function App to APIM only after test gates pass |
| Configure | Function network access | Set `publicNetworkAccess: Disabled` only after the production private path passes |
| Update | Application identity handling and deployment hooks | See sections 4 and 5 |
| Add | Diagnostics and alerts | Gateway failures, backend failures, latency, private endpoint/DNS health, and drift detection |

### Networking requirements

- APIM outbound integration requires a dedicated subnet in the same subscription
  and region. Microsoft specifies at least `/27`, recommends `/24`, requires an
  NSG, and requires delegation to `Microsoft.Web/serverFarms`.
- Retain `10.0.1.0/24` and its existing delegation. Do not change the existing
  VNet's inline subnet list in a way that removes or replaces live subnets.
- Use the existing `10.0.2.0/24` private endpoint subnet only after capacity,
  NSG, route, and policy review. Its observed private endpoint network policies
  are Disabled; do not claim its NSG filters private endpoint traffic.
  Enabling those policies would affect existing storage endpoints and needs a
  separate impact review. Use a separate endpoint subnet if isolation requires it.
- Allow APIM outbound TCP 443 to the Function endpoint and required platform
  dependencies, including documented Azure Key Vault access and working DNS.
  Review the complete service dependency rules before adding deny rules.
- From the gateway network, resolve
  `azfn655zgsp5au6gu.azurewebsites.net` to the private endpoint address through
  `privatelink.azurewebsites.net`. Preserve the original hostname for HTTPS
  certificate validation and host routing; do not use a raw IP backend URL.
- Confirm DNS for the deployment endpoint used by the actual Flex deployment
  tooling, including SCM where applicable. Verify records rather than assuming
  a DNS zone group covers every endpoint the tooling needs.
- Private endpoints and public access can coexist during migration. Adding a
  private endpoint alone does not close the S360 finding.
- Do not use public IP allowlists as a substitute for the requested
  `publicNetworkAccess: Disabled` state.

## 4. Authentication and authorization design

### Browser to SWA

Retain the existing SWA resource, Entra sign-in, user invitations, and route
rules in [staticwebapp.config.json](../src/web/staticwebapp.config.json).
Keep frontend calls same-origin, avoiding new browser tokens, CORS exceptions,
and public gateway URLs in JavaScript.

Preserve these user experiences:

- Anonymous reads of public schedule, speakers, sponsors, branding,
  registration configuration, content, and image proxy endpoints.
- Administrator-only writes and upload/extraction operations.
- Authenticated per-user favorites.

### SWA to APIM

Use the supported SWA-to-APIM linking operation. It creates a linked product,
product subscription, and product-level JWT validation policy; SWA supplies
the corresponding subscription key and access token server-side.

- Add every required API to the generated product; a successful link alone
  does not publish APIs.
- Preserve generated validation and subscription configuration. Do not rotate
  the generated primary key independently of the integration.
- Apply policy inheritance correctly: API/operation policies must not bypass
  product validation by omitting the required inherited policies.
- Do not publish the same backend through another product, all-access
  subscription, subscription-free API, wildcard operation, or diagnostic route
  that bypasses the intended authorization boundary.
- Match `/api` exactly once: SWA forwards the complete `/api/*` path.
- Configure request-size limits and timeouts to preserve existing image upload
  and extraction operations within SWA's supported API limits.

### APIM to Function

Use a dedicated APIM managed identity and
`authentication-managed-identity` with the backend's agreed Entra audience.
Keep token acquisition fail-closed. Function authentication must require the
expected issuer/audience and authorize only the APIM identity for this path.
Accepting every valid tenant token is not sufficient.

Inventory and export the existing authentication configuration securely before
changing it. The Function already has an Entra provider; determine whether its
registration can safely support this backend audience or needs an approved
replacement. During transition, retain the working SWA provider until direct
link rollback is no longer required. Prove the provider-specific caller
restrictions do not break the existing path before applying them to production.
API authentication failures should return API errors, not interactive login HTML.

**User identity is separate from gateway identity.** Favorites currently reads
`x-ms-client-principal` in
[favorites.js](../api/src/functions/favorites.js).
Do not assume this header will remain unchanged through APIM and Function
App authentication: the Function may receive the gateway's machine principal.

Required prototype and implementation contract:

1. Prove how linked SWA forwards authenticated user context to APIM, including
   anonymous requests, role assignments, and attempted browser header overrides.
   The general SWA user-information documentation does not establish all these
   properties for the complete proposed chain.
2. Only after successful SWA token/subscription validation, have APIM overwrite
   a dedicated internal user-context header, for example
   `x-summit-client-principal`, using the trusted SWA context. Never pass through
   a browser-supplied value for this header.
3. The Function may consume that context only on the backend path authenticated
   as the explicitly authorized APIM identity. Add a shared, validated principal
   helper; reject malformed context rather than treating it as an authenticated
   user. Keep any legacy-path handling explicitly limited to the transition.
4. Preserve the existing SWA `userId` exactly. It is application-specific and is
   the favorites partition key; replacing it with an Entra object ID would make
   existing favorites appear missing.
5. Enforce the route/method role matrix on the trusted gateway/backend path as
   defense in depth, not by trusting a decoded header from arbitrary callers.
6. If trustworthy context propagation cannot be demonstrated, stop. Do not
   weaken authorization to make the proxy work. Revise the identity design
   before approving implementation.

Do not remove Function authentication, switch to shared Function keys in the
browser, treat CORS as authorization, or rely only on an IP being private.

## 5. Required repository and deployment work

The repository now includes the staged implementation below. This does not
mean any of it has been deployed or passed live acceptance.

| Surface | Required work |
| --- | --- |
| [resources.bicep](../infra/resources.bicep) | Add gateway, integration subnet/NSG, Function private endpoint/DNS, identity and diagnostics; explicitly model the final disabled public-access state |
| [main.bicep](../infra/main.bicep) | Add parameters/outputs for gateway and staged migration state without renaming/recreating existing resources |
| [azure.yaml](../azure.yaml) | Register `Microsoft.ApiManagement`; replace the unconditional direct Function backend link in `postprovision`; make hooks idempotent and fail on unexpected errors |
| [deploy.ps1](../deploy.ps1) | Keep provider registration and operator instructions consistent with the selected gateway/deployment mode |
| [favorites.js](../api/src/functions/favorites.js) and shared API code | Implement the approved trusted-user-context contract and authorization checks |
| [staticwebapp.config.json](../src/web/staticwebapp.config.json) | Preserve current route/method authorization and same-origin URLs; change only for a demonstrated requirement |
| [api.spec.js](../tests/api.spec.js) and authenticated browser tests | Add exact response, identity isolation, role, and network-boundary acceptance tests |
| [deployment.md](deployment.md) / [architecture.md](architecture.md) | Document final topology, private deployments, rollback, and operational ownership once deployed |

### Deployment path is a release gate

The repository deploys the Flex API with `azd` and deploys SWA separately using
the SWA CLI from the postdeploy hook. It also temporarily enables Storage
public access in predeploy and disables it afterward.

- Do not assume a developer laptop or public hosted runner can reach the
  private Function/deployment endpoints.
- Select an approved VNet-connected deployment agent or operator environment.
  It needs DNS and network access to the actual Flex deployment endpoints and
  deployment storage, plus least-privilege deployment permissions.
- Test the existing remote-build/One Deploy flow end to end on an isolated
  environment with Function public access Disabled. Do not substitute generic
  App Service ZIP/SCM assumptions for Flex behavior.
- Evaluate replacing the Storage public-access toggle with private deployment
  connectivity. This is a directly related deployment dependency, not permission
  to redesign all storage networking. Agree its scope with the storage owner.
- Prove both an application update and an infrastructure redeploy preserve the
  APIM link and disabled Function public access.
- No deployment hook may silently relink to the public Function, temporarily
  reopen Function public access, or report success after failed lockdown.

## 6. Staged migration and gates

### Phase A - Approval and baseline

1. Obtain approval for a public authenticated APIM boundary and private Function.
   Check for an existing centrally managed gateway before buying a dedicated one.
2. Confirm SKU/region/quota, owner, deployment identity, network permissions,
   retention, latency/error objectives, and budget. Do not infer availability
   merely from the documented SKU capabilities.
3. Price APIM base capacity/units, Private Link hourly/data charges, private DNS,
   logs, data transfer, and a private deployment agent. No cost quote is included
   in this draft.
4. Export existing backend link, auth settings, routes, deployment configuration,
   and network state securely. Do not commit tokens, keys, or secret settings.
5. Record representative website/API functional results, response shapes, p95
   latency and error rate. Agree a quiet maintenance window and rollback owners.

**Gate A:** architecture/security/network/cost owners approve the candidate and
the acceptance criteria. Do not provision billable resources before approval.

### Phase B - Isolated prototype

1. Use a dedicated SWA Standard test resource, test Function, and synthetic test
   data. Linked backends are not supported in SWA pull-request environments.
   Do not point destructive tests at production storage or Cosmos DB.
2. Build the complete SWA -> APIM -> private Function chain, including managed
   identity authentication, trusted end-user context, private DNS, and exact
   route/method mappings.
3. Disable public access on the test Function and execute the full acceptance
   matrix below, including a code deployment while it remains disabled.
4. Test all gateway policy scopes and negative authorization cases. Protect
   traces and do not log credentials or full user-principal payloads.

**Gate B:** all functional, identity, network, and deployment tests pass.
SWA user IDs differ across SWA resources, so use synthetic users/data here;
the production SWA must be retained to preserve existing favorites keys.

### Phase C - Add production private infrastructure

1. Use reviewed IaC and what-if/plan output. Initially add APIM, its subnet/NSG,
   Function private endpoint, DNS link/group, and diagnostics while keeping the
   current SWA -> Function connection working.
   If the current Function `publicNetworkAccess` is null, explicitly set it to
   `Enabled` for this approved preparation phase **before** creating its private
   endpoint: Azure can otherwise change effective public access to denied as soon
   as the endpoint exists. A null value does not preserve the direct SWA path.
   Never perform this preparation update on an already locked-down Function.
2. Ensure the private endpoint connection is Approved and private DNS resolves
   correctly from the APIM network and deployment agent.
3. Stage the approved Function authentication and application changes using
   compatibility-tested transition behavior.
4. Prove APIM reaches the existing Function over the private endpoint, with
   authenticated requests and correct responses. Do not mistake a public
   fallback or a login redirect for successful private connectivity.
5. Stage policies and operations, deployment-hook fixes, alerting, and a tested
   rollback configuration. A temporary validation product must not expose a
   weaker public route and must be removed before cutover.

**Gate C:** private production backend connectivity and rollback readiness
demonstrated. Public Function access remains enabled at this phase.

Adding a subnet modifies the existing VNet, and auth/code updates modify the
Function; identify these explicitly in what-if and obtain approval. Never use
complete-mode deployment or permit replacement/destruction of live resources.
Validate and security-scan implementation IaC before any deployment.

For an existing production application, the additive
[existing gateway entrypoint](../infra/existing-api-gateway.bicep) reuses the tested
gateway module while adding only the dedicated gateway resources and subnet.
It does not replay the full application template, alter the existing subnet
NSGs, reset policy-owned tags, or change data services. Explicitly supply the
environment, resource token, production backend application and publisher.
The linked product defaults to `unlinked` for initial preparation only; after
cutover always supply the persisted `linkedProductId` on later deployments.

### Phase D - Switch the production SWA backend

1. Start the approved maintenance window.
2. Replace the direct Function link with the APIM link; attach the APIs to the
   generated linked product and preserve its JWT/subscription configuration.
3. Test through both public custom domains and the default SWA hostname:
   public reads, images, login/logout, administrator operations, favorites.
4. Check backend traces and identity to establish that requests use the private
   connection and preserve the correct user.
5. Roll back immediately on a failed identity or authorization test.

**Gate D:** all acceptance tests pass through the production website.
There is one linked backend per SWA environment. Unlink/link and product
association may cause a short API interruption; this plan does not promise
an atomic or zero-downtime cutover.

### Phase E - Disable Function public access

1. Obtain explicit approval for the production lockdown step.
2. Set Function `properties.publicNetworkAccess` to `Disabled`.
3. Repeat the acceptance matrix, including direct external requests, private
   gateway requests, browser identity flows, and private code deployment.
4. Verify the ARM state explicitly. An authentication-only 401 is not evidence
   that public access has been disabled.
5. Remove obsolete transition access/providers only after the agreed rollback
   window and a separate impact review.

**Gate E:** no public data-plane access to the Function, healthy website/API,
and working private deployments. Leave the authenticated APIM ingress public.

### Phase F - Observe and close

- Observe through an agreed representative load period before final sign-off.
  Proposed minimum: 24 hours including a representative synthetic load test;
  the service owner must approve the duration and load profile.
- Proposed performance gates: p95 API latency no more than 20% above the
  measured baseline and 5xx rate below 0.1% at the agreed load, subject to the
  service owner's actual SLO. These are targets, not measured results.
- Add an alert/policy check for Function public access being re-enabled and
  backend linkage changing unexpectedly. Any enforcement policy must be
  coordinated with the approved emergency rollback procedure.
- Attach ARM state, approved private endpoint state, gateway configuration,
  test evidence, deployment evidence, and approvals to the S360 remediation.
  Request reevaluation; actual closure depends on the S360 control evaluation.

## 7. Acceptance matrix

Run write/negative tests in the isolated environment using test records.
For production, use approved test accounts and explicitly authorized reversible
records; do not create or delete real event content to validate this plan.

| Test | Required result |
| --- | --- |
| Private DNS from APIM/deployer | Function hostname resolves to the approved private endpoint IP |
| Private backend connection | TLS hostname validation succeeds and request reaches the Function privately |
| ARM Function network state | `properties.publicNetworkAccess == "Disabled"` |
| External direct Function request, anonymous and valid test credential | Blocked by network boundary; no application response/data, even with a valid credential |
| Website pages and public APIs | Expected status and exact content type/schema; no login HTML masquerading as JSON |
| All public images/content/config | Same successful behavior as baseline |
| Anonymous admin write | Denied or expected sign-in redirect; prove no data mutation |
| Signed-in non-admin write | Denied; prove no data mutation |
| Administrator CRUD and upload/extraction | Authorized operations succeed, expected data changes only |
| Anonymous favorites | Denied; no user data returned or changed |
| Favorites for users A and B | Original production user IDs retained; no cross-user reads/writes |
| Forged user-context headers | Cannot impersonate a user or administrator through SWA or direct APIM |
| Direct APIM without valid SWA token/subscription | Rejected without reaching the backend |
| Alternate APIM product/subscription/policy scope | Cannot bypass intended linked-SWA validation |
| Backend call with a non-APIM identity | Rejected even from a host in the VNet |
| Backend auth/token failure | Explicit API error; no anonymous fallback |
| Code deployment after lockdown | Succeeds from approved private environment without reopening Function access |
| Infrastructure redeploy | Retains APIM link, private DNS/endpoints, and disabled Function public access |
| Load/observability | Approved latency/error targets met; correlation and alerts work without sensitive logs |

The unauthorized-write API tests now stop at redirects and reject HTTP 200
instead of accepting a login HTML response as evidence. Authorization unit
tests also prove denied writes do not invoke the handler. Live data-isolation,
administrator, and non-mutation acceptance still require the isolated test
environment and approved accounts.

## 8. Rollback

Assign named cutover and rollback owners before execution. Preserve the
pre-change state securely and rehearse recovery in the isolated environment.

| Failure point | Recovery |
| --- | --- |
| Before SWA backend switch | Leave existing link in place; repair or remove only failed new components |
| After APIM switch, before Function lockdown | Restore original Function backend link and compatible auth/application behavior; verify website and user data |
| After Function lockdown | Prefer fixing APIM/DNS/auth privately; if full rollback is necessary, explicitly approve re-enabling Function public access before restoring the old SWA link |

Restoring the old SWA link while Function public access remains Disabled will
not restore service. Reopening public access reintroduces the S360 finding:
record the incident, obtain security authorization, and track a time-bound
exception if required. Never automate this as a silent fallback.

Do not delete existing SWA users, change favorites partition keys, delete
storage data, replace the Function App, or tear down the VNet for rollback.
After an approved manual rollback, use `prepare` rather than `direct` while
the gateway and its integration subnet still exist. Restore the original
Function authentication explicitly: incremental deployment of `prepare`
does not undo a previously deployed `authsettingsV2` configuration.

## 9. Alternatives and intentional limits

| Option | Assessment |
| --- | --- |
| Approved shared APIM with suitable private connectivity | Prefer if ownership, isolation, capacity, availability, and policy requirements are satisfied; avoids a dedicated gateway |
| Dedicated APIM Standard v2 | Recommended candidate; preserves supported SWA `/api` integration but adds steady gateway cost and operational ownership |
| APIM Developer tier | Possible non-production experiment only; not the production reliability choice |
| APIM Consumption / Basic v2 | Do not select for this proposed outbound-VNet integration design; Standard v2 or Premium v2 support that feature |
| Front Door Premium with Private Link | Separate architecture candidate; requires Function-origin support and SWA authentication/routing design verification, not a drop-in linked-backend replacement |
| Application Gateway with private backend | Separate candidate requiring a supported replacement for the current SWA API proxy/auth path; not assumed to be an SWA linked backend |
| Function public IP restrictions only | Does not implement the explicit disabled-public-access requirement |
| Immediately disable public access | Breaks the supported current SWA -> Function path |
| Time-bound exception | Contingency while approvals/migration are pending, not the selected permanent remediation |

The original proposal did not establish regional capacity, price, approvals,
load-test success, zero downtime or end-to-end identity acceptance. The production
record at the top now documents the completed migration and its actual approvals/
tests. It still does not claim load-test success, multi-region failover or a
redesign of existing data stores. The deployed gateway is single-region.

## 10. Original approval checklist (historical)

This is the original planning checklist, not a current deployment authorization.
Refer to the production record and separately approve any new environment/change.

- [ ] Security/S360 owner accepts a public authenticated APIM gateway.
- [ ] Existing shared gateway assessed; dedicated SKU, capacity, and budget approved.
- [ ] Network owner approves subnet, NSG, DNS, private endpoint, and routing design.
- [ ] Identity owner approves backend audience, APIM caller restriction, and user-context contract.
- [ ] Application owner approves test criteria, SLOs, compatibility work, and downtime window.
- [ ] Private code/infrastructure deployment and rollback rehearsed.
- [ ] Implementation IaC generated, validated, security-scanned, and reviewed.
- [ ] Production changes and final Function lockdown explicitly authorized.

## 11. Implemented rollout controls and operator commands

The existing azd/Bicep entry point remains in use. No new Function App, SWA,
VNet, identity for data access, or data store replaces an existing resource.

| `API_NETWORK_STAGE` | Provisioned network | Function authorization | SWA backend |
| --- | --- | --- | --- |
| `direct` (explicit legacy option) | Existing topology | Existing SWA authentication, legacy principal handling | Function |
| `prepare` | Adds APIM Standard v2, dedicated identity/subnet/NSG, Function private endpoint and DNS | Existing authentication retained; APIM API denies access while product is `unlinked` | Function |
| `gateway` | Same private infrastructure; Function public access still Enabled | Entra-authenticated APIM caller plus trusted SWA user context | APIM, explicit switch required |
| `private` (new-site default) | Function and deployment Storage public access Disabled | Same gateway/user authorization | APIM; existing migration link retained, or explicit empty-link bootstrap |

Stages are inputs, not an automatic migration. Do not select `gateway` or
`private` for production until the corresponding gates above pass.
The prerequisite hook refuses unsafe downgrades, reopening a private Function,
unknown subnets, mismatched NSGs, and unmodeled routes/service endpoints/NAT.
Always review what-if as well: these checks are not a complete drift detector.

### Prepare a separate test environment

Run these commands only after test scope, price, capacity, and permissions
are approved. They do not reuse production data or production SWA users:

```powershell
azd env new summit-private-test --no-prompt
azd env set AZURE_SUBSCRIPTION_ID <approved-test-subscription-id>
azd env set AZURE_LOCATION eastus2
azd env set API_NETWORK_STAGE prepare
azd env set APIM_PUBLISHER_NAME "<approved publisher>"
azd env set APIM_PUBLISHER_EMAIL "<monitored owner email>"
azd env set RESILIENCY_CLASSIFICATION "Test Resource" --environment summit-private-test
```

The approved test classification is applied as the resource-group tag
`ms-resiliency-classification`. The optional parameter defaults to empty for
other environments; do not label production as a test resource. This tag is
not a policy exemption.

The template's default resource group for that environment is
`rg-summit-private-test`. Review the actual evaluated resource group and names
in what-if; never run it against `rg-devrel-studio` by mistake.
After deployment approval, provision the `prepare` stage, deploy the updated
API entry point while it still uses direct authentication, and verify the
existing website path. APIM is intentionally fail-closed at this stage.

For the existing production VNet, preserve both observed subnet NSG IDs before
provisioning. Their current values must be fetched and reviewed; do not copy
these settings to an unrelated test VNet:

```powershell
azd env set FUNCTION_SUBNET_NSG_ID "<current functionapp subnet NSG resource ID>"
azd env set PRIVATE_ENDPOINT_SUBNET_NSG_ID "<current private-endpoints subnet NSG resource ID>"
```

### Backend Entra application prerequisite

Have the identity owner supply a dedicated, single-tenant backend application:

- Application ID URI: `api://<application-client-id>`.
- Access token version: 2 (`api.requestedAccessTokenVersion`).
- Service principal exists in the same tenant as the APIM managed identity.
- No browser client secret or Function key is needed.
- Backend authorization uses both the APIM managed identity's application ID
  and object ID. Merely belonging to the tenant grants no access.

The template does not create directory applications or assume directory
administration permissions. Set `BACKEND_APPLICATION_ID` only after review.
Do not repurpose the website's login application without identity-owner approval.

### Approve and exercise the gateway in the test environment

First deploy the new API code in `prepare`, then obtain environment-specific
cutover approval. The following flags acknowledge operator approval; they
are not test evidence and must not be used to bypass production release gates.

```powershell
azd env set BACKEND_APPLICATION_ID "<approved backend application client ID>"
azd env set API_GATEWAY_CUTOVER_APPROVED true
azd env set API_NETWORK_STAGE gateway

# Process-scoped only, during the approved maintenance/cutover window.
$env:API_ALLOW_BACKEND_SWITCH = "true"
# Run the approved provisioning operation for this selected environment.
# Its postprovision hook performs the explicit switch and product association.
# Clear this process variable afterward, including on failure:
Remove-Item Env:\API_ALLOW_BACKEND_SWITCH
```

The switch hook preserves the linked product JWT policy, requires its
subscription, attaches the Summit API, and persists the generated product ID
as `APIM_LINKED_PRODUCT_ID`. Do not delete or reset that value on redeployment.
Product discovery accepts the legacy linked display name and the observed
hostname-prefix product name with its exact generated display name. ARM requests
explicitly accept JSON so product policies are not returned as raw XML.
An unexpected link/product/policy state throws an error; no automatic public
fallback or rollback is attempted.

Gateway provisioning replaces Function authentication with the dedicated
backend Entra configuration. Export the original auth settings first and
restore them explicitly if rolling back. The global Node invocation hook is
registered before all 33 HTTP functions and checks the APIM identity and
operation role before invoking a handler. The API and APIM operation list share
[one manifest](../api/src/shared/http-operations.json).

### Lock down and test private deployment

After gateway acceptance, select a VNet-connected agent and authorize the
private transition:

```powershell
azd env set PRIVATE_DEPLOYMENT_APPROVED true --environment <approved-environment>
azd env set API_NETWORK_STAGE private --environment <approved-environment>
```

After the separately approved provisioning step, the deployment prehook
checks the actual Function public-access state, approved endpoint IPs, DNS,
HTTPS reachability, and Storage lockdown. It does not reopen public access.
Perform the real Flex remote-build/One Deploy acceptance test from this agent.
The check is a prerequisite, not proof that package upload/build/SCM works.

For a temporary Linux deployment agent, deny all inbound access, omit a public
IP, and manage it through Azure Run Command. Use an existing approved,
nondelegated subnet or model a new subnet in IaC before provisioning; the drift
guard intentionally rejects unmodeled subnets. Do not rely on an upstream Git
clone when the migration changes are still uncommitted. Transfer only the
allowlisted current API source, manifest and lockfile, then verify the archive
SHA256 on the agent. Never transfer local settings or environment files.

A supported alternative to remote build is a Linux-ready package: run
`npm ci --omit=dev` on the agent, put `host.json`, source and production
`node_modules` at the ZIP root, then use One Deploy through Azure CLI:

```bash
# Run inside the approved Linux VNet-connected agent, not the public workstation.
az login --identity
az account set --subscription <approved-subscription-id>
az functionapp deployment source config-zip \
  --resource-group <approved-test-resource-group> \
  --name <approved-test-function> \
  --src <verified-linux-package.zip> \
  --build-remote false --timeout 1800
```

Verify Function, SCM and Blob DNS exclusively match their approved private
endpoint addresses. Both Function and Storage public access must remain
Disabled throughout the deployment and a repeat deployment. A 202 response
only acknowledges submission; require completed deployment/trigger-sync and
health verification. Azure Run Command transport success does not prove guest
script success: require explicit completion evidence and fail on a missing
marker. Its output is limited, so do not infer success from empty output.

Flex CLI JSON output may be a string rather than a deployment object. Verify the
actual private SCM record using the deployment ID reported by the command:

```bash
az rest --method get \
  --url https://<function>.scm.azurewebsites.net/api/deployments/<deployment-id> \
  --resource https://management.azure.com/ \
  --query '{id:id,status:status,complete:complete,active:active}' --output json
```

Require `status=4` and `complete=true`, then verify API health and unchanged
network lockdown. Do not infer completion from an unrecognized CLI output shape.

Use narrowly scoped deployment roles rather than resource-group Contributor.
The isolated test used Function-scoped Website Contributor, Storage-scoped
Blob Data Contributor and resource-group Reader. Wait for RBAC propagation;
do not enable shared keys or public storage to bypass an authorization failure.
Remove temporary packages, role assignments, VM, NIC, OS disk and agent-only
NSG after acceptance. Future releases still require an approved private agent.
After tearing down that agent, reset `PRIVATE_DEPLOYMENT_APPROVED=false` for
that environment until its replacement is validated; retain
`API_NETWORK_STAGE=private`. A public workstation must fail the deployment
prechecks rather than reopen the Function or Storage.

Review the provision preview for unrelated provider-default or policy-owned
drift. If all private connectivity/authentication already exists and the only
required live transition is Function public-access lockdown, an explicitly
approved, narrowly scoped ARM update can set that property without replaying
unrelated changes. Keep the environment's private stage persisted, validate the
matching Bicep state, and record the precise live operation and acceptance.

Ordinary deployments will not silently change a different linked backend.
Ordinary private-stage provisioning and deployment will not enable public
network access on the Function or Storage. Code deployments also run the
stage/drift checks, so a missing stage variable cannot silently revert to a
public path.

### Local and deployed validation

```powershell
npm run test:authorization
npm run test:migration
az bicep build --file infra\main.bicep

# Read-only tests, explicitly enabled only against the approved test site.
$env:PRIVATE_API_ACCEPTANCE = "true"
$env:BASE_URL = "https://<test-site>.azurestaticapps.net"
$env:FUNCTION_BASE_URL = "https://<test-function>.azurewebsites.net"
$env:APIM_BASE_URL = "https://<test-gateway>.azure-api.net"
npx playwright test private-api.spec.js --project=chromium
```

The read-only suite checks schedule JSON, forged client-principal headers,
external direct Function access, and unauthenticated direct gateway access.
It must run from outside the VNet for the external Function test. The complete
acceptance matrix, especially signed-in favorites, administrator writes,
valid-token external denial, private deployments, and load tests, remains a
release gate. Log routing/alerts, operational recipients, cost/quota, and the
maintenance window must also be signed off before production rollout.

### Local validation record (October 27, 2026)

- Bicep build completed with zero diagnostics.
- Fourteen local authorization/timezone tests passed on Node 20.20.2 and
  Node 22.23.4, including all 33 operation mappings and favorites partition
  isolation.
- PowerShell safety/synchronization tests and XML checks passed.
- Twelve API/acceptance tests were discovered; live acceptance was not run.
- Compiled ARM explicitly contains required authentication, Return401,
  gateway identity restriction, the `sites` endpoint, StandardV2, and the
  conditional disabled-public-access state.
- Checkov 3.3.30 ran locally without uploading results. It is **not clean**:
  current templates have 30 passing and 20 failing checks; the unchanged
  baseline has 23 passing and 13 failing checks.

| Scan category | Result / required disposition |
| --- | --- |
| Twelve findings shared with baseline | Existing Function, Storage, plan, and Cosmos configuration findings; not silently fixed as part of this migration |
| Seven new checks against `authsettingsV2` | CKV_AZURE_13, 65, 80, 66, 63, 222, 88 apply generic/legacy web-config expectations to the auth resource; review with security using the compiled V2 settings rather than weakening authentication to satisfy the scanner |
| Scanner exception | CKV_AZURE_70 raises `KeyError: properties` on the conditional V2 auth resource; no pass is inferred |
| Public APIM gateway | CKV_AZURE_174 flags the intentional public gateway; requires explicit approval of this architecture boundary |
| Conditional Function public access | Static scanning still flags the Function; only the private stage selects Disabled. Validate the live ARM state after lockdown |

This historical local-only record did not establish deployment acceptance.
The production deployment record above distinguishes completed live checks from
remaining limitations. No finding has been silently suppressed and no clean
security scan is claimed.

### Test gateway retail cost evidence

The [Azure Retail Prices API](https://prices.azure.com/api/retail/prices)
returned USD **0.9589 per hour** for the East US 2 `Standard v2 Unit` meter
on October 27, 2026: approximately **USD 23.01 per day** or **USD 700 per
730-hour month** for the proposed single gateway unit alone. This is public
retail pricing, not a subscription-specific quote. Calls beyond included
allowances, private endpoints, DNS, logs, transfer, deployment agents, and the
rest of the isolated application stack can add charges. No gateway was
created, and this estimate does not approve spending or regional capacity.

## Sources

- [SWA linked Functions security constraints](https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own#security-constraints):
  direct linked Functions require public accessibility; IP restrictions and
  Private Link/service endpoint restrictions are not supported for that path.
- [SWA API Management integration](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-api-management):
  Standard SWA requirement, complete `/api` path forwarding, generated
  product/subscription/JWT validation, and API product association.
- [APIM outbound VNet integration](https://learn.microsoft.com/en-us/azure/api-management/integrate-vnet-outbound):
  Standard v2/Premium v2 support; public gateway remains; subnet, delegation,
  region, and NSG requirements.
- [Azure Functions networking](https://learn.microsoft.com/en-us/azure/azure-functions/functions-networking-options):
  Flex Consumption private endpoint support and inbound/outbound distinction.
- [App Service private endpoints](https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint):
  DNS/hostname behavior and the need to disable public access separately.
- [APIM managed identity policy](https://learn.microsoft.com/en-us/azure/api-management/authentication-managed-identity-policy):
  gateway-to-backend token acquisition and authorization header behavior.
- [SWA user information](https://learn.microsoft.com/en-us/azure/static-web-apps/user-information):
  client-principal structure and application-specific SWA user IDs.
- [Functions deployment technologies](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies#secured-virtual-networks):
  secured-network deployment considerations; confirm exact Flex tooling behavior.
