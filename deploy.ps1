#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Interactive deployment script for the Community Online Event platform.
.DESCRIPTION
    Prompts for Azure environment details (environment name, tenant, subscription, region)
    then runs azd auth login + azd up to provision infrastructure and deploy all services.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Community Online Event - Deployment"   -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Environment name ──────────────────────────────────────────────────────
do {
    $envName = Read-Host "Environment name (e.g. dev, staging, prod)"
    if ([string]::IsNullOrWhiteSpace($envName)) {
        Write-Host "  Environment name is required, please try again." -ForegroundColor Red
    }
} while ([string]::IsNullOrWhiteSpace($envName))

# ── 2. Tenant ID ─────────────────────────────────────────────────────────────
Write-Host ""
do {
    $tenantId = Read-Host "Tenant ID (GUID)"
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        Write-Host "  Tenant ID is required, please try again." -ForegroundColor Red
    }
} while ([string]::IsNullOrWhiteSpace($tenantId))

# ── 3. Authenticate to the tenant ────────────────────────────────────────────
Write-Host ""
Write-Host "Logging in to tenant $tenantId ..." -ForegroundColor DarkGray
azd auth login --tenant-id $tenantId
if ($LASTEXITCODE -ne 0) {
    Write-Host "azd auth login failed." -ForegroundColor Red
    exit 1
}

# Also ensure az CLI is logged in to the same tenant (needed by post-provision hooks)
Write-Host "Logging in to az CLI ..." -ForegroundColor DarkGray
az login --tenant $tenantId --output none
if ($LASTEXITCODE -ne 0) {
    Write-Host "az login failed." -ForegroundColor Red
    exit 1
}

# ── 4. Subscription ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Fetching subscriptions..." -ForegroundColor DarkGray
$subs = az account list --query "[?tenantId=='$tenantId'].{id:id, name:name, isDefault:isDefault}" -o json 2>$null | ConvertFrom-Json

$subscriptionId = $null
do {
    if ($subs -and $subs.Count -gt 0) {
        Write-Host ""
        Write-Host "Available subscriptions:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $subs.Count; $i++) {
            $s = $subs[$i]
            $default = if ($s.isDefault) { " (current default)" } else { "" }
            Write-Host "  [$($i + 1)] $($s.name)  ($($s.id))$default"
        }
        Write-Host ""
        $subChoice = Read-Host "Select a subscription by number, or paste a Subscription ID"
        if ($subChoice -match '^\d+$' -and [int]$subChoice -ge 1 -and [int]$subChoice -le $subs.Count) {
            $subscriptionId = $subs[[int]$subChoice - 1].id
        } else {
            $subscriptionId = $subChoice
        }
    } else {
        $subscriptionId = Read-Host "Subscription ID (GUID)"
    }
    if ([string]::IsNullOrWhiteSpace($subscriptionId)) {
        Write-Host "  Subscription ID is required, please try again." -ForegroundColor Red
    }
} while ([string]::IsNullOrWhiteSpace($subscriptionId))

# ── 5. Region ────────────────────────────────────────────────────────────────
Write-Host ""
$defaultRegion = "eastus2"
$regionInput = Read-Host "Azure region [$defaultRegion]"
$region = if ([string]::IsNullOrWhiteSpace($regionInput)) { $defaultRegion } else { $regionInput }

# ── 6. Confirm ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "─── Deployment Summary ───" -ForegroundColor Cyan
Write-Host "  Environment :  $envName"
Write-Host "  Tenant      :  $tenantId"
Write-Host "  Subscription:  $subscriptionId"
Write-Host "  Region      :  $region"
Write-Host "──────────────────────────" -ForegroundColor Cyan
Write-Host ""

$confirm = Read-Host "Proceed with deployment? (Y/n)"
if ($confirm -and $confirm -notin @('y', 'Y', 'yes', 'Yes', '')) {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

# ── 7. Initialise azd environment & deploy ────────────────────────────────────
Write-Host ""
Write-Host "Initialising azd environment '$envName' ..." -ForegroundColor Green

# Create the environment if it doesn't already exist, then select it
$existingEnvs = azd env list -o json 2>$null | ConvertFrom-Json
$envExists = $existingEnvs | Where-Object { $_.Name -eq $envName }
if (-not $envExists) {
    azd env new $envName
} else {
    Write-Host "Environment '$envName' already exists, reusing it." -ForegroundColor DarkGray
}
azd env select $envName

azd env set AZURE_SUBSCRIPTION_ID $subscriptionId
azd env set AZURE_LOCATION $region

Write-Host "Running azd up (provision + deploy) ..." -ForegroundColor Green
Write-Host ""

azd up --environment $envName

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Deployment completed successfully!"    -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green

    # ── Surface admin invitation details ──────────────────────────────────────
    # Read the SWA hostname from the azd environment so we can display the
    # invitation acceptance URL and remind the deployer to complete the step.
    $swaHostname = azd env get-value AZURE_STATICWEBAPP_HOSTNAME 2>$null
    if ($swaHostname) {
        $inviteUrl = "https://$swaHostname/.auth/invitations"
        Write-Host ""
        Write-Host "────────────────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host "  IMPORTANT: Accept your admin invitation"           -ForegroundColor Yellow
        Write-Host "────────────────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Admin invitations were sent during provisioning."
        Write-Host "  Each invited admin must open the link below in"
        Write-Host "  their browser to accept the 'administrator' role:"
        Write-Host ""
        Write-Host "    $inviteUrl" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  After accepting, log out and log back in so the"
        Write-Host "  new role takes effect."
        Write-Host "────────────────────────────────────────────────────" -ForegroundColor Yellow
        Write-Host ""

        $openNow = Read-Host "Open the invitation URL in your browser now? (Y/n)"
        if (-not $openNow -or $openNow -in @('y', 'Y', 'yes', 'Yes', '')) {
            Start-Process $inviteUrl
            Write-Host "  Browser opened. Accept the invitation, then log out" -ForegroundColor Green
            Write-Host "  and log back in to the admin page." -ForegroundColor Green
        }
    }
} else {
    Write-Host ""
    Write-Host "Deployment finished with errors (exit code $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}
