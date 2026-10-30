#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [ValidateSet('Bootstrap', 'Deploy', 'Cleanup')][string]$Action = 'Bootstrap',
    [string]$EnvironmentName,
    [string]$SubscriptionId,
    [string]$TenantId,
    [string]$Location,
    [string]$PublisherName,
    [string]$PublisherEmail,
    [string[]]$AdminEmails,
    [string]$BackendApplicationId,
    [string]$ServiceManagementReference,
    [string]$ResiliencyClassification,
    [string]$AgentVmSize = 'Standard_D2s_v5',
    [switch]$Resume,
    [switch]$KeepDeploymentAgent,
    [switch]$Approved
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\AzureCli.ps1')
function Read-RequiredValue {
    param([string]$Value, [string]$Label)
    if ($Value) { return $Value }
    if ($Approved) { throw "$Label is required for noninteractive deployment." }
    $value = Read-Host $Label
    if ([string]::IsNullOrWhiteSpace($value)) { throw "$Label is required." }
    return $value
}
$EnvironmentName = Read-RequiredValue $EnvironmentName 'Environment name'
if ($EnvironmentName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$') { throw 'Invalid environment name.' }
$oldSwitch = $env:API_ALLOW_BACKEND_SWITCH
$oldBootstrap = $env:API_BOOTSTRAP_APPROVED
Push-Location $PSScriptRoot
try {
    foreach ($tool in @('az', 'azd', 'pwsh', 'node', 'npm', 'ssh-keygen')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install required tool: $tool" }
    }
    if ($Action -eq 'Cleanup') {
        & .\scripts\Deploy-PrivateApi.ps1 -EnvironmentName $EnvironmentName -Action Cleanup -RemoveAgent
        return
    }
    if (-not (Test-Path .\node_modules\@azure\static-web-apps-cli)) {
        throw 'Run npm ci in the repository root before deployment.'
    }
    if ($Action -eq 'Bootstrap') {
        $SubscriptionId = Read-RequiredValue $SubscriptionId 'Subscription ID'
        $TenantId = Read-RequiredValue $TenantId 'Tenant ID'
        $Location = Read-RequiredValue $Location 'Azure region (for example eastus2)'
        $PublisherName = Read-RequiredValue $PublisherName 'Gateway publisher name'
        $PublisherEmail = Read-RequiredValue $PublisherEmail 'Monitored gateway publisher email'
        if (-not $AdminEmails) {
            $AdminEmails = (Read-RequiredValue '' 'Administrator email(s), comma separated') -split ','
        }
        foreach ($email in @($PublisherEmail) + $AdminEmails) {
            if ([string]::IsNullOrWhiteSpace($email)) { throw 'Publisher/administrator emails must not be empty.' }
            try { $parsed = [System.Net.Mail.MailAddress]::new($email.Trim()) }
            catch [System.FormatException], [System.ArgumentException] { throw "Invalid publisher/administrator email: $email" }
            if ($parsed.Address -ne $email.Trim()) { throw "Specify only an email address: $email" }
        }
        Write-Host "Target: subscription $SubscriptionId / rg-$EnvironmentName / $Location"
        Write-Host 'Creates a billable APIM Standard v2 (~USD 700/730-hour month before extras), app/data/network resources and temporary VM.'
        Write-Host 'Function and Storage stay private. Empty event data; no production content is copied.'
        if (-not $Approved -and (Read-Host 'Approve this deployment and its costs? Type DEPLOY') -cne 'DEPLOY') {
            throw 'Deployment not approved.'
        }
        Invoke-AzureCli -Arguments @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
        $account = Invoke-AzureCli -Arguments @('account', 'show', '--subscription', $SubscriptionId, '-o', 'json') | ConvertFrom-Json
        if ($account.tenantId -ne $TenantId) { throw 'Signed-in subscription tenant does not match the requested tenant. Sign in to az and azd first.' }
        $environments = & azd env list -o json
        if ($LASTEXITCODE -ne 0) { throw 'Could not list azd environments.' }
        $exists = @(($environments -join "`n" | ConvertFrom-Json) | Where-Object Name -eq $EnvironmentName).Count -eq 1
        if (-not $exists) {
            & azd env new $EnvironmentName --subscription $SubscriptionId --location $Location --no-prompt
            if ($LASTEXITCODE -ne 0) { throw 'Could not create azd environment.' }
        }
        $values = Import-AzdEnvironment -EnvironmentName $EnvironmentName
        if ($values.ContainsKey('AZURE_RESOURCE_GROUP') -and $values.AZURE_RESOURCE_GROUP -ne "rg-$EnvironmentName") {
            throw 'Existing environment resource group differs; refusing to retarget it.'
        }
        foreach ($pair in @(@('AZURE_SUBSCRIPTION_ID', $SubscriptionId), @('AZURE_LOCATION', $Location))) {
            if ($values.ContainsKey($pair[0]) -and $values[$pair[0]] -ne $pair[1]) {
                throw "Existing environment $($pair[0]) differs; do not retarget it."
            }
        }
        $groupExists = Invoke-AzureCli -Arguments @('group', 'exists', '--name', "rg-$EnvironmentName",
            '--subscription', $SubscriptionId, '-o', 'tsv')
        if ($groupExists -eq 'true' -and
            (-not $Resume -or -not $values.ContainsKey('SITE_BOOTSTRAP_STATUS') -or $values.SITE_BOOTSTRAP_STATUS -ne 'in-progress')) {
            throw 'Resource group already exists. Use Deploy for code updates; Resume is only for a recorded incomplete bootstrap. Never bootstrap over production.'
        }
        if ($Resume -and $values.ContainsKey('SITE_BOOTSTRAP_STATUS') -and $values.SITE_BOOTSTRAP_STATUS -eq 'in-progress') {
            foreach ($pair in @(@('APIM_PUBLISHER_NAME', $PublisherName), @('APIM_PUBLISHER_EMAIL', $PublisherEmail))) {
                if ($values.ContainsKey($pair[0]) -and $values[$pair[0]] -ne $pair[1]) { throw "Resume value changed: $($pair[0])" }
            }
        }
        foreach ($pair in @(
            @('AZURE_SUBSCRIPTION_ID', $SubscriptionId), @('AZURE_LOCATION', $Location),
            @('AZURE_RESOURCE_GROUP', "rg-$EnvironmentName"), @('API_NETWORK_STAGE', 'private'),
            @('APIM_PUBLISHER_NAME', $PublisherName), @('APIM_PUBLISHER_EMAIL', $PublisherEmail),
            @('SITE_ADMIN_EMAILS', (($AdminEmails | ForEach-Object { $_.Trim() }) -join ',')),
            @('SITE_BOOTSTRAP_STATUS', 'in-progress'), @('PRIVATE_DEPLOYMENT_APPROVED', 'true'),
            @('API_GATEWAY_CUTOVER_APPROVED', 'true')
        )) { Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name $pair[0] -Value $pair[1] }
        if ($ResiliencyClassification) {
            Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name RESILIENCY_CLASSIFICATION -Value $ResiliencyClassification
        }
        if (-not $BackendApplicationId -and $values.ContainsKey('BACKEND_APPLICATION_ID')) { $BackendApplicationId = $values.BACKEND_APPLICATION_ID }
        & .\scripts\Initialize-BackendApplication.ps1 -EnvironmentName $EnvironmentName `
            -ApplicationId $BackendApplicationId -ServiceManagementReference $ServiceManagementReference
        $env:API_BOOTSTRAP_APPROVED = 'true'
        $env:API_ALLOW_BACKEND_SWITCH = 'true'
        & azd provision --environment $EnvironmentName --no-prompt
        if ($LASTEXITCODE -ne 0) { throw 'Private provisioning failed. Retain the environment; diagnose, review what-if, then use Resume. Never reopen public access.' }
        Import-AzdEnvironment -EnvironmentName $EnvironmentName | Out-Null
    } else {
        Import-AzdEnvironment -EnvironmentName $EnvironmentName | Out-Null
        if ((Get-ApiNetworkStage) -ne 'private') { throw 'This whole-site deploy command requires the private stage. Use the migration runbook for legacy environments.' }
        Write-Host "Code-only update: $EnvironmentName / $env:AZURE_RESOURCE_GROUP / $env:AZURE_SUBSCRIPTION_ID"
        if (-not $Approved -and (Read-Host 'Approve code deployment and temporary VM costs? Type DEPLOY') -cne 'DEPLOY') {
            throw 'Deployment not approved.'
        }
        Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name PRIVATE_DEPLOYMENT_APPROVED -Value true
    }
    try {
        & .\scripts\Deploy-PrivateApi.ps1 -EnvironmentName $EnvironmentName -VmSize $AgentVmSize -ProvisionAgent
        & .\scripts\Deploy-Web.ps1 -EnvironmentName $EnvironmentName
        & .\scripts\Test-SiteDeployment.ps1 -EnvironmentName $EnvironmentName
        if ($Action -eq 'Bootstrap') {
            & .\scripts\Invite-SiteAdministrators.ps1 -EnvironmentName $EnvironmentName
        }
    } finally {
        if (-not $KeepDeploymentAgent) {
            & .\scripts\Deploy-PrivateApi.ps1 -EnvironmentName $EnvironmentName -Action Cleanup -RemoveAgent
        } else {
            Write-Warning 'Temporary deployment agent retained and billable. Run the Cleanup action when diagnostics are complete.'
        }
    }
    if ($Action -eq 'Bootstrap') {
        Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name SITE_BOOTSTRAP_STATUS -Value complete
    }
    Write-Host "Site deployed: https://$env:AZURE_STATICWEBAPP_HOSTNAME"
    Write-Host 'Accept the administrator invitation in your browser, sign out/in, then configure branding and event content.'
} finally {
    $env:API_ALLOW_BACKEND_SWITCH = $oldSwitch
    $env:API_BOOTSTRAP_APPROVED = $oldBootstrap
    Pop-Location
}
