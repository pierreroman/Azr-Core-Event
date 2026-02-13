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
$envName = Read-Host "Environment name (e.g. dev, staging, prod)"
if ([string]::IsNullOrWhiteSpace($envName)) {
    Write-Host "Environment name is required." -ForegroundColor Red
    exit 1
}

# ── 2. Tenant ID ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Fetching available tenants..." -ForegroundColor DarkGray
$tenants = az account tenant list --query "[].{id:tenantId, name:displayName}" -o json 2>$null | ConvertFrom-Json

if ($tenants -and $tenants.Count -gt 0) {
    Write-Host ""
    Write-Host "Available tenants:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $tenants.Count; $i++) {
        $t = $tenants[$i]
        Write-Host "  [$($i + 1)] $($t.name)  ($($t.id))"
    }
    Write-Host ""
    $tenantChoice = Read-Host "Select a tenant by number, or paste a Tenant ID"
    if ($tenantChoice -match '^\d+$' -and [int]$tenantChoice -ge 1 -and [int]$tenantChoice -le $tenants.Count) {
        $tenantId = $tenants[[int]$tenantChoice - 1].id
    } else {
        $tenantId = $tenantChoice
    }
} else {
    $tenantId = Read-Host "Tenant ID (GUID)"
}

if ([string]::IsNullOrWhiteSpace($tenantId)) {
    Write-Host "Tenant ID is required." -ForegroundColor Red
    exit 1
}

# ── 3. Authenticate to the tenant ────────────────────────────────────────────
Write-Host ""
Write-Host "Logging in to tenant $tenantId ..." -ForegroundColor DarkGray
azd auth login --tenant-id $tenantId
if ($LASTEXITCODE -ne 0) {
    Write-Host "azd auth login failed." -ForegroundColor Red
    exit 1
}

# Also ensure az CLI is logged in to the same tenant (needed by post-provision hooks)
az login --tenant $tenantId --output none 2>$null

# ── 4. Subscription ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Fetching subscriptions for tenant $tenantId ..." -ForegroundColor DarkGray
$subs = az account list --query "[?tenantId=='$tenantId'].{id:id, name:name, isDefault:isDefault}" -o json 2>$null | ConvertFrom-Json

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
    Write-Host "Subscription ID is required." -ForegroundColor Red
    exit 1
}

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

azd env new $envName 2>$null   # no-op if it already exists
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
} else {
    Write-Host ""
    Write-Host "Deployment finished with errors (exit code $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}
