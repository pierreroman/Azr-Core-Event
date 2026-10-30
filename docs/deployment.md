# Deployment and operations

The supported from-scratch entrypoint is [deploy.ps1](../deploy.ps1), backed by
Azure Developer CLI (azd), Bicep, and repository-owned deployment scripts.
**Do not use bare `azd up` from a public workstation:** the Function and deployment
Storage are private from their initial provision.

This deploys a reusable, empty event site, not a copy of the Summit production
database, uploaded images, user favorites, custom domains or administrator roles.
Existing production migration history is in the
[private API migration runbook](private-api-migration.md). Never bootstrap over an
existing production resource group.

## What is provisioned

| Component | Configuration |
|---|---|
| Static Web Apps | Standard; static HTML/CSS/JS; built-in Entra `aad` sign-in |
| API Management | Standard v2; authenticated SWA gateway, outbound VNet integration |
| Azure Functions | Flex Consumption; private Function/SCM endpoint; managed identity |
| Storage | Standard_ZRS; private Blob/Table/Queue endpoints, shared keys disabled |
| Cosmos DB | Serverless; empty `event/favorites`, `/userId` partition, Entra data RBAC |
| Networking | VNet, three service subnets, private endpoints and private DNS |
| Monitoring | Application Insights, Log Analytics, gateway diagnostics |
| Backend identity | Dedicated single-tenant, secretless Entra application and service principal |
| Temporary deployment agent | Linux VM, NIC, OS disk, inbound-deny NSG, scoped roles; no public IP |

Function and Storage public network access remain **Disabled**, including during
API deployment. SWA and the authenticated APIM gateway remain public. Cosmos uses
its public endpoint with local/key authentication disabled; this is not a claim
that every resource has a private endpoint.

APIM Standard v2 is the main fixed cost: the production-migration retail estimate
was about USD 700 per 730-hour month, **not a current price quote**. Also budget for
SWA, private endpoints/DNS, logs, Storage, Cosmos, Function execution, traffic and
the temporary VM/disk. Check regional availability, quotas and organizational
policies before approving deployment.

## Prerequisites and permissions

- PowerShell 7+, Azure CLI (`az`), Azure Developer CLI (`azd`), Node.js/npm and
  `ssh-keygen` on the operator workstation. The workstation needs Azure management
  and frontend deployment connectivity; it does not need Function private access.
- The private VM needs outbound HTTPS for Azure management/Entra, Ubuntu package
  repositories, Node.js downloads and npm. No inbound SSH access is used.
- Azure permissions to create the resource group/services and register providers;
  role-assignment write/delete at the required scopes. **Contributor alone is not
  sufficient** for role assignments; use an appropriately scoped RBAC administrator
  or approved equivalent.
- Entra permissions to create/manage the dedicated backend application and service
  principal. Application registration may be restricted by your tenant. Supply
  `-BackendApplicationId` for a pre-created compatible app instead; the operator
  still needs permission to verify/configure it and its service principal.
- Approval for one APIM Standard v2, Flex Consumption, ZRS Storage and a temporary
  VM in the chosen region. `-AgentVmSize` defaults to `Standard_D2s_v5`; ensure quota.
- The current API runtime is retained as Node.js 20; the private build pins
  20.20.2 and verifies the download checksum. Review runtime lifecycle/tenant
  policy before a new production rollout; this packaging work does not upgrade it.

The deployment registers required providers, including `Microsoft.DocumentDB`,
`Microsoft.Compute` and `Microsoft.ApiManagement`. It does not bypass Azure Policy.
Corporate tenants may require `-ServiceManagementReference` for the backend app
and/or `-ResiliencyClassification`. Classification is optional; use the approved
value for the new environment rather than copying the Summit's tag.

## 1. Get the source and dependencies

Use the repository or extract a source package created by
[New-SitePackage.ps1](../scripts/New-SitePackage.ps1).

```powershell
git clone https://github.com/pierreroman/Azr-Core-Event.git
Set-Location .\Azr-Core-Event
npm ci
az login --tenant <tenant-id>
azd auth login --tenant-id <tenant-id>
```

Commit/retain both dependency lockfiles. The frontend CLI is pinned to 2.1.0;
deployment never downloads a floating `@latest` CLI. Do not copy another
operator's `.azure` directory, local settings, private keys or deployment tokens.

## 2. Bootstrap a NEW environment

Interactive:

```powershell
.\deploy.ps1
```

It collects environment/subscription/tenant/region, a publisher name and monitored
email, and administrator email(s), then asks for deployment/cost approval.
Authenticate the CLIs first; the script does not silently switch tenants.

Explicit/noninteractive (the `-Approved` switch is your deployment/cost consent):

```powershell
.\deploy.ps1 -Action Bootstrap `
  -EnvironmentName my-event -SubscriptionId <subscription-id> -TenantId <tenant-id> `
  -Location eastus2 -PublisherName "Community Events" `
  -PublisherEmail publisher@example.net -AdminEmails owner@example.net `
  -Approved
```

Optional: `-BackendApplicationId <app-id>`,
`-ServiceManagementReference <approved-reference>`,
`-ResiliencyClassification "<approved-value>"`,
`-AgentVmSize <approved-size>`.

The sequence is:

1. Verify the signed-in subscription/tenant and refuse retargeting an azd
   environment or overwriting an existing resource group.
2. Record an incomplete bootstrap; create/verify the secretless backend app.
3. Provision the private infrastructure with `azd provision`.
4. Link SWA to APIM, verify its generated JWT-protected product, and persist the
   product ID. Initial `unlinked` is fail-closed, not a usable production default.
5. Provision the temporary VM on the private endpoint subnet. Transfer only
   allowlisted API source through Azure Run Command, build with `npm ci --omit=dev`,
   and deploy privately. Validate TLS/private DNS, network lockdown and the
   actual completed SCM deployment—not just the CLI's exit code.
6. Publish the static frontend with the pinned CLI (`--env production`) and a
   short-lived process environment token, not a token in command-line arguments.
7. Check the real Function/Storage settings, SWA/APIM link and seven public JSON
   endpoints. Empty schedule/speakers/sponsors arrays are valid.
8. Produce administrator invitations; remove the exact temporary resources and
   role assignments; record bootstrap completion.

Cleanup runs even after API/frontend/acceptance failures. `-KeepDeploymentAgent`
explicitly retains the billable agent for diagnostics; run Cleanup afterwards.
Ownership/scope mismatches intentionally block deletion rather than deleting an
unrelated resource. See recovery below.

## 3. Accept the invitation and configure the event

**The operator must securely deliver each returned invitation URL to its intended
administrator.** Azure invitation creation is not a promise of email delivery.
The links expire after seven days. Accept with the intended Entra account, then
sign out/in. Confirm the SWA principal includes `administrator`; signed-in users
are not automatically administrators.

1. Open `/admin.html`; set event name, logo, colors, dates and video channel.
2. Configure About/Code of Conduct; bundled defaults are sample copy and may be
   Azure-themed. Registration starts disabled; set its destination before enabling.
3. Add/import sessions, speakers and sponsors, and upload images through the admin
   pages. Tables/containers exist but no production records are seeded.
4. Verify a non-admin cannot write, an admin can perform intended CRUD/uploads,
   favorites survive refresh, and two users do not share favorites.
5. Optionally add custom domains through SWA and complete DNS ownership validation
   and certificate issuance. No Summit hostname/DNS record is automatically reused.

Invitations can be explicitly regenerated:

```powershell
.\scripts\Invite-SiteAdministrators.ps1 -EnvironmentName my-event
```

Protect these URLs and private recovery state as sensitive operational data.

## Code updates: no infrastructure reprovision

```powershell
npm ci
.\deploy.ps1 -Action Deploy -EnvironmentName my-event -Approved
```

This reads that exact azd environment, provisions a fresh temporary private agent,
deploys API then frontend, checks the site, and cleans the agent. It does **not**
run Bicep or change the Entra app. It requires the private stage and previously
persisted resource outputs. Confirm the printed subscription/resource group.
Run only one deployment/cleanup at a time per environment; preserve its protected
recovery state rather than copying it to another operator's concurrent checkout.

Bare `azd deploy` remains an advanced path for an already-approved VNet-connected
deployment host; its predeploy guard intentionally rejects a public workstation.
The `api` azd service has project-level frontend/lockdown hooks; there is no `web`
azd service. Use [Deploy-Web.ps1](../scripts/Deploy-Web.ps1) for an approved
frontend-only release.

Full infrastructure changes require separately reviewed parameters and ARM
what-if/validation. Never use Bootstrap/Resume to apply broad changes to an
already-live site. Production remediation used the additive
[existing-api-gateway.bicep](../infra/existing-api-gateway.bicep), not a full rebuild.

## Failures, resume, cleanup and rollback

- **Partial first provision:** retain the environment and deployment logs. Fix
  the cause, inspect ARM deployments/what-if and confirm recorded resource IDs.
  Bootstrap with the same arguments plus `-Resume` is allowed only for a recorded
  `in-progress` environment. Incomplete/missing outputs or unmodeled networking
  fail closed; reconcile them explicitly before retrying. Resume is not a bypass.
- **Provision succeeded, code/checks failed:** correct the issue and use the
  code-only Deploy action rather than reprovisioning. Reissue invitations explicitly
  if bootstrap stopped before them.
- **Agent cleanup:** `.\deploy.ps1 -Action Cleanup -EnvironmentName my-event`.
  Retain `.azure\<environment>\private-agent.json` and ARM deployment
  `pda-<first16-ownerToken>` until cleanup succeeds. Cleanup recovers partially
  created resources only with exact deployment/ownership proof. It resets
  `PRIVATE_DEPLOYMENT_APPROVED=false`; missing/foreign proof requires investigation.
  Recovery needs deployment-operation/resource/role reads; deletion needs the
  corresponding exact resource and role-assignment delete permissions.
- **API rollback:** retain a known-good source/release and deploy it privately
  through the same code-only workflow. This does not roll back content/schema.
  Review API/frontend compatibility and take approved data backups independently.
- Do not reopen Function/Storage public access to repair a deployment. Do not
  delete/purge APIM as routine recovery or reuse old production credentials.
- Teardown is a separately approved destructive operation: inventory data,
  domains, backups, tenant app ownership and costs first. The backend app lives
  in Entra and is not removed by deleting the Azure resource group. Cleanup only
  removes the temporary agent; it does not remove the site.

## Source release package

```powershell
npm run package:site -- -OutputPath C:\releases\community-event.zip
```

The output directory must exist and the ZIP must not already exist. The package
contains frontend/API source, Bicep/policies, scripts, docs, tests, manifests and
both dependency locks. `deployment-manifest.json` records per-file SHA256/length.
It excludes installed dependencies, azd environments, local settings, private
deployment state and live event data. It is a **source** release: run `npm ci`
after extraction. Treat any additional source/assets you add as release material.

## Verification status

Offline syntax, dependency, infrastructure and scripted deployment tests are
described in [Testing](testing.md). The earlier Summit private architecture was
live-tested, including real private redeployment and signed-in favorites/admin
acceptance. **The newly packaged from-scratch workflow has not yet been executed
in a fresh Azure environment.** It needs separate target/cost/policy approval and
the manual identity/admin/content checks above before a production-ready claim.
The [dependency/runtime release gates](testing.md#dependency-and-runtime-release-gates)
also remain open: the current runtime dependency audit reports a high-severity
MSAL/Identity advisory chain, and the retained Node.js 20 lifecycle needs review.

GitHub CodeQL scanning is configured separately. No GitHub Actions deployment
workflow or repository credential is required by this release process.
