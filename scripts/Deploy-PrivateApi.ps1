[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$')][string]$EnvironmentName,
    [ValidateSet('Deploy', 'Cleanup')][string]$Action = 'Deploy',
    [switch]$ProvisionAgent,
    [switch]$RemoveAgent,
    [string]$VmSize = 'Standard_D2s_v5'
)

. (Join-Path $PSScriptRoot 'AzureCli.ps1')

function Save-PrivateAgentSnapshot {
    param([string]$Path, [object]$Snapshot)
    $Snapshot | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath "$Path.new" -Encoding utf8
    Move-Item -LiteralPath "$Path.new" -Destination $Path -Force
}

function Invoke-PrivateAgentCommand {
    param([string]$VmId, [string]$Script)
    $marker = 'PRIVATE_AGENT_COMPLETE_' + [guid]::NewGuid().ToString('N')
    $log = '/var/log/private-agent-' + [guid]::NewGuid().ToString('N') + '.log'
    $normalized = $Script.Replace("`r`n", "`n").Replace("`r", "`n")
    # Never relay npm, CLI, application, or installation logs: they may contain credentials.
    $wrapped = @"
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
exec 3>&1
exec >'$log' 2>&1
trap 'printf "%s\n" PRIVATE_AGENT_FAILED >&3' ERR
$normalized
grep '^PRIVATE_PACKAGE_EVIDENCE=' '$log' | tail -n 1 | head -c 2048 >&3 || true
printf '\n%s\n' '$marker' >&3
"@
    $commandDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) ".azure\$EnvironmentName"
    New-Item -ItemType Directory -Path $commandDirectory -Force | Out-Null
    $commandPath = Join-Path $commandDirectory ('private-command-' + [guid]::NewGuid().ToString('N') + '.sh')
    try {
        [IO.File]::WriteAllText($commandPath, $wrapped.Replace("`r", ''), [Text.UTF8Encoding]::new($false))
        $result = Invoke-AzureCli -Arguments @('vm', 'run-command', 'invoke', '--ids', $VmId,
            '--command-id', 'RunShellScript', '--scripts', "@$commandPath", '--output', 'json') | ConvertFrom-Json
    } finally { Remove-Item -LiteralPath $commandPath -Force -ErrorAction SilentlyContinue }
    $stdout = @($result.value | Where-Object { $_.code -match '/StdOut/' } | ForEach-Object { $_.message }) -join "`n"
    $lines = @($stdout.Trim() -split "`n")
    if ($stdout.Length -gt 4096 -or $lines.Count -eq 0 -or $lines[-1].Trim() -cne $marker -or
        @($result.value | Where-Object { $_.code -match '/StdErr/' -and $_.message.Trim() }).Count -gt 0) {
        throw 'Private agent command failed or completion marker is missing; inspect the VM root-only logs. Agent retained.'
    }
    return @($lines | Where-Object { $_ -like 'PRIVATE_PACKAGE_EVIDENCE=*' })
}

function Send-PrivateAgentFile {
    param([string]$VmId, [string]$LocalPath, [string]$RemotePath)
    if ($RemotePath -notmatch '^/opt/private-api/[a-f0-9]{32}/[a-z.-]+$') { throw 'Unsafe remote path.' }
    $bytes = [IO.File]::ReadAllBytes($LocalPath)
    if ($bytes.Length -gt 4MB) { throw 'Source transfer exceeds the bounded 4 MiB limit.' }
    $parent = $RemotePath.Substring(0, $RemotePath.LastIndexOf('/'))
    $null = Invoke-PrivateAgentCommand $VmId "mkdir -p '$parent'; chmod 700 '$parent'; : > '$RemotePath'"
    for ($offset = 0; $offset -lt $bytes.Length; $offset += 24576) {
        $chunk = [Convert]::ToBase64String($bytes, $offset, [Math]::Min(24576, $bytes.Length - $offset))
        $null = Invoke-PrivateAgentCommand $VmId "printf '%s' '$chunk' | base64 --decode >> '$RemotePath'"
    }
    $hash = (Get-FileHash -LiteralPath $LocalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $null = Invoke-PrivateAgentCommand $VmId "printf '%s  %s\n' '$hash' '$RemotePath' | sha256sum --check --status"
}

function New-PrivateSourcePackage {
    param([string]$ApiRoot, [string]$Destination)
    Add-Type -AssemblyName System.IO.Compression
    $paths = [Collections.Generic.List[IO.FileInfo]]::new()
    foreach ($required in @('host.json', 'package.json', 'package-lock.json')) {
        $item = Get-Item -LiteralPath (Join-Path $ApiRoot $required) -ErrorAction Stop
        $paths.Add($item)
    }
    foreach ($directory in @('src', 'test')) {
        $path = Join-Path $ApiRoot $directory
        if ($directory -eq 'src' -and -not (Test-Path -LiteralPath $path -PathType Container)) { throw 'Missing api src.' }
        if (Test-Path -LiteralPath $path) {
            # Explicitly reject links before recursive enumeration; never follow content outside the allowlist.
            $items = @((Get-Item -LiteralPath $path)) + @(Get-ChildItem -LiteralPath $path -Recurse -Force)
            if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
                throw 'Symlinks and reparse points are not permitted in API source.'
            }
            if (@($items | Where-Object { $_.Name -match '(?i)(^\.|secret|credential|local\.settings|^env\.)' }).Count) {
                throw 'Secret-like API source path rejected.'
            }
            foreach ($item in $items | Where-Object { -not $_.PSIsContainer }) {
                if ($item.Extension -notin @('.js', '.json')) { throw "Non-allowlisted API source extension: $($item.Name)" }
                if ($item.Name -match '(?i)(^\.|secret|credential|local\.settings|^env\.)') { throw 'Secret-like API source file rejected.' }
                $paths.Add($item)
            }
        }
    }
    if (@($paths | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Linked package input rejected.' }
    $archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $paths) {
            $relative = [IO.Path]::GetRelativePath($ApiRoot, $file.FullName).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative) | Out-Null
        }
    } finally { $archive.Dispose() }
    if ((Get-Item -LiteralPath $Destination).Length -gt 4MB) { throw 'Source package exceeds 4 MiB.' }
}

function Assert-PrivateAgentSnapshot {
    param([object]$Snapshot, [string]$GroupId, [string]$FunctionId, [string]$StorageId)
    if ($Snapshot.version -ne 1 -or $Snapshot.environmentName -cne $EnvironmentName -or
        $Snapshot.resourceGroupId -ine $GroupId -or $Snapshot.state -notin @('Ready', 'CleanupReady', 'Cleaned') -or
        $Snapshot.subscriptionId -ine ($GroupId -split '/')[2] -or
        $Snapshot.ownerToken -notmatch '^[a-f0-9]{32}$' -or $Snapshot.agentName -notmatch '^pda-[a-f0-9]{16}$' -or
        $Snapshot.agentName -cne ('pda-' + $Snapshot.ownerToken.Substring(0, 16))) {
        throw 'Untrusted, incomplete, or mismatched private agent snapshot.'
    }
    $o = $Snapshot.outputs
    $expected = @{
        vmId = "$GroupId/providers/Microsoft.Compute/virtualMachines/$($Snapshot.agentName)"
        nicId = "$GroupId/providers/Microsoft.Network/networkInterfaces/$($Snapshot.agentName)-nic"
        diskId = "$GroupId/providers/Microsoft.Compute/disks/$($Snapshot.agentName)-os"
        nsgId = "$GroupId/providers/Microsoft.Network/networkSecurityGroups/$($Snapshot.agentName)-nsg"
    }
    foreach ($key in $expected.Keys) {
        if ($o.$key -ine $expected[$key]) { throw "Snapshot resource ID mismatch: $key" }
    }
    $partial = $Snapshot.state -eq 'CleanupReady' -or
        ($Snapshot.state -eq 'Cleaned' -and @($o.roleAssignments).Count -lt 3)
    if ((-not $partial -and ($o.principalId -notmatch '^[0-9a-fA-F-]{36}$' -or $o.diskUniqueId -notmatch '^[0-9a-fA-F-]{36}$')) -or
        ($partial -and (($o.principalId -and $o.principalId -notmatch '^[0-9a-fA-F-]{36}$') -or
        ($o.diskUniqueId -and $o.diskUniqueId -notmatch '^[0-9a-fA-F-]{36}$'))) -or
        $o.ownerToken -cne $Snapshot.ownerToken -or
        $o.functionId -ine $FunctionId -or $o.storageId -ine $StorageId) { throw 'Snapshot principal or target mismatch.' }
    $roles = @{
        $FunctionId = 'de139f84-1756-47ae-9be6-808fbbe84772'
        $StorageId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
        $GroupId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
    }
    if ((-not $partial -and @($o.roleAssignments).Count -ne 3) -or @($o.roleAssignments).Count -gt 3 -or
        (@($o.roleAssignments).Count -gt 0 -and -not $o.principalId)) { throw 'Snapshot has an invalid role assignment set.' }
    foreach ($role in $o.roleAssignments) {
        if (-not $roles.ContainsKey($role.scope) -or
            $role.id -notmatch ('^' + [regex]::Escape($role.scope) + '/providers/Microsoft.Authorization/roleAssignments/[a-fA-F0-9-]{36}$') -or
            $role.roleDefinitionId -ine "/subscriptions/$($Snapshot.subscriptionId)/providers/Microsoft.Authorization/roleDefinitions/$($roles[$role.scope])") {
            throw 'Snapshot role scope or definition mismatch.'
        }
        $roles.Remove($role.scope)
    }
}

function Restore-PrivateAgentOutputs {
    param([object]$Snapshot, [string]$Path, [string]$Subscription, [string]$Group, [switch]$ForCleanup)
    if ($Snapshot.state -ne 'Provisioning') { return }
    if ($Snapshot.environmentName -cne $EnvironmentName -or $Snapshot.subscriptionId -ine $Subscription -or
        $Snapshot.resourceGroupId -ine "/subscriptions/$Subscription/resourceGroups/$Group" -or
        $Snapshot.ownerToken -notmatch '^[a-f0-9]{32}$' -or
        $Snapshot.agentName -cne ('pda-' + $Snapshot.ownerToken.Substring(0, 16)) -or
        $Snapshot.deploymentName -cne $Snapshot.agentName) { throw 'Untrusted provisioning snapshot.' }
    $deployment = Invoke-AzureCli -Arguments @('deployment', 'group', 'show', '--subscription', $Subscription,
        '--resource-group', $Group, '--name', $Snapshot.deploymentName, '--output', 'json') | ConvertFrom-Json
    if ($deployment.properties.provisioningState -eq 'Succeeded' -and $deployment.properties.outputs) {
        $outputs = @{}
        foreach ($property in $deployment.properties.outputs.PSObject.Properties) { $outputs[$property.Name] = $property.Value.value }
        $Snapshot.outputs = $outputs
        $Snapshot.state = 'Ready'
        Save-PrivateAgentSnapshot $Path $Snapshot
        return
    }
    if (-not $ForCleanup -or $deployment.properties.provisioningState -notin @('Failed', 'Canceled', 'Succeeded')) {
        throw 'Provisioning is incomplete. Only explicit cleanup of a terminal ARM deployment can recover partial resources.'
    }
    $groupId = $Snapshot.resourceGroupId
    $planned = $Snapshot.plannedOutputs
    # ARM parameter records plus operation targets corroborate the pre-write local ownership record.
    foreach ($pair in @(@('agentName', $Snapshot.agentName), @('ownerToken', $Snapshot.ownerToken),
            @('subnetId', $planned.subnetId), @('functionAppName', ($planned.functionId -split '/')[-1]),
            @('storageAccountName', ($planned.storageId -split '/')[-1]))) {
        if ($deployment.properties.parameters.($pair[0]).value -cne $pair[1]) { throw 'ARM deployment ownership parameters do not match snapshot.' }
    }
    $operations = @(Invoke-AzureCli -Arguments @('deployment', 'operation', 'group', 'list',
        '--subscription', $Subscription, '--resource-group', $Group, '--name', $Snapshot.deploymentName,
        '--output', 'json') | ConvertFrom-Json)
    $operationIds = @($operations | ForEach-Object {
        if ($_.properties.PSObject.Properties['targetResource']) { $_.properties.targetResource.id }
    })
    $resources = @(Invoke-AzureCli -Arguments @('resource', 'list', '--subscription', $Subscription,
        '--resource-group', $Group, '--output', 'json') | ConvertFrom-Json)
    foreach ($key in @('vmId', 'nicId', 'nsgId')) {
        foreach ($resource in @($resources | Where-Object { $_.id -ieq $planned.$key })) {
            if ($resource.id -notin $operationIds -or $resource.tags.'private-deployment-owner' -cne $Snapshot.ownerToken) {
                throw 'Partial resource ownership cannot be proven from ARM operations and owner tags.'
            }
        }
    }
    if (@($resources | Where-Object { $_.id -ieq $planned.vmId }).Count) {
        $vm = Invoke-AzureRest -ResourceId $planned.vmId -ApiVersion '2024-07-01'
        $planned.principalId = $vm.identity.principalId
        if ($vm.properties.storageProfile.osDisk.managedDisk.id -ine $planned.diskId) { throw 'Partial VM disk differs from plan.' }
        if (@($resources | Where-Object { $_.id -ieq $planned.diskId }).Count) {
            $disk = Invoke-AzureRest -ResourceId $planned.diskId -ApiVersion '2024-03-02'
            $planned.diskUniqueId = $disk.properties.uniqueId
        }
    } elseif (@($resources | Where-Object { $_.id -ieq $planned.diskId }).Count) {
        throw 'Detached partial disk has no previously recorded immutable identity or owned VM link; refusing cleanup.'
    }
    $roleRecords = @()
    foreach ($scope in @($planned.functionId, $planned.storageId, $groupId)) {
        $roles = @(Invoke-AzureCli -Arguments @('role', 'assignment', 'list', '--subscription', $Subscription,
            '--scope', $scope, '--all', '--output', 'json') | ConvertFrom-Json)
        foreach ($role in $roles | Where-Object { $_.id -in $operationIds }) {
            if (-not $planned.principalId -or $role.principalId -ine $planned.principalId) { throw 'Partial role principal ownership is unproven.' }
            if ($role.id -notin @($roleRecords | ForEach-Object { $_.id })) {
                $roleRecords += @{ id = $role.id; scope = $role.scope; roleDefinitionId = $role.roleDefinitionId }
            }
        }
    }
    $planned.roleAssignments = @($roleRecords)
    $Snapshot.outputs = $planned
    $Snapshot.state = 'CleanupReady'
    Assert-PrivateAgentSnapshot $Snapshot $groupId $planned.functionId $planned.storageId
    Assert-PrivateAgentOwnership $Snapshot $resources
    Save-PrivateAgentSnapshot $Path $Snapshot
}

function Assert-PrivateAgentOwnership {
    param([object]$Snapshot, [object[]]$Resources)
    foreach ($key in @('vmId', 'nicId', 'nsgId', 'diskId')) {
        $resource = @($Resources | Where-Object { $_.id -ieq $Snapshot.outputs.$key })
        if ($resource.Count -gt 1) { throw 'Ambiguous resource ownership.' }
        if ($resource.Count -eq 0) { continue }
        if ($key -ne 'diskId' -and $resource[0].tags.'private-deployment-owner' -cne $Snapshot.ownerToken) {
            throw 'Resource is not owned by the recorded agent.'
        }
        if ($key -eq 'vmId') {
            $vm = Invoke-AzureRest -ResourceId $Snapshot.outputs.vmId -ApiVersion '2024-07-01'
            if ($vm.identity.principalId -ine $Snapshot.outputs.principalId -or
                $vm.properties.storageProfile.osDisk.managedDisk.id -ine $Snapshot.outputs.diskId -or
                @($vm.properties.networkProfile.networkInterfaces).Count -ne 1 -or
                $vm.properties.networkProfile.networkInterfaces[0].id -ine $Snapshot.outputs.nicId) { throw 'VM ownership changed.' }
        }
        if ($key -eq 'nicId') {
            $nic = Invoke-AzureRest -ResourceId $Snapshot.outputs.nicId -ApiVersion '2023-11-01'
            $linkedVm = $nic.properties.PSObject.Properties['virtualMachine']
            $linkedEndpoint = $nic.properties.PSObject.Properties['privateEndpoint']
            if (($null -ne $linkedVm -and $linkedVm.Value -and $linkedVm.Value.id -ine $Snapshot.outputs.vmId) -or
                $nic.properties.networkSecurityGroup.id -ine $Snapshot.outputs.nsgId -or
                @($nic.properties.ipConfigurations).Count -ne 1 -or
                $nic.properties.ipConfigurations[0].properties.subnet.id -ine $Snapshot.outputs.subnetId -or
                ($null -ne $linkedEndpoint -and $null -ne $linkedEndpoint.Value)) { throw 'Recorded NIC is shared, repurposed, or on an unexpected subnet.' }
        }
        if ($key -eq 'nsgId') {
            $nsg = Invoke-AzureRest -ResourceId $Snapshot.outputs.nsgId -ApiVersion '2023-11-01'
            $linkedNics = $nsg.properties.PSObject.Properties['networkInterfaces']
            $linkedSubnets = $nsg.properties.PSObject.Properties['subnets']
            if (($null -ne $linkedNics -and @($linkedNics.Value | Where-Object { $_.id -ine $Snapshot.outputs.nicId }).Count) -or
                ($null -ne $linkedSubnets -and @($linkedSubnets.Value | Where-Object { $null -ne $_ }).Count)) { throw 'Recorded NSG is shared with another resource.' }
        }
        if ($key -eq 'diskId') {
            $disk = Invoke-AzureRest -ResourceId $Snapshot.outputs.diskId -ApiVersion '2024-03-02'
            if ($disk.properties.uniqueId -ine $Snapshot.outputs.diskUniqueId) { throw 'Recorded disk was replaced; cleanup refused.' }
            $managedBy = $disk.PSObject.Properties['managedBy']
            if ($null -ne $managedBy -and $managedBy.Value -and $managedBy.Value -ine $Snapshot.outputs.vmId) {
                throw 'Recorded disk is attached to another VM.'
            }
            $sharedOwners = $disk.PSObject.Properties['managedByExtended']
            if ($null -ne $sharedOwners -and @($sharedOwners.Value | Where-Object { $_ -ine $Snapshot.outputs.vmId }).Count) {
                throw 'Recorded disk is shared with another VM.'
            }
        }
    }
}

# Dot sourcing exposes pure helpers to focused offline tests without executing Azure commands.
if ($MyInvocation.InvocationName -eq '.') { return }

$root = Split-Path $PSScriptRoot -Parent
$values = Import-AzdEnvironment -EnvironmentName $EnvironmentName
if ($values -isnot [System.Collections.IDictionary]) { throw 'Import-AzdEnvironment must return environment outputs.' }
foreach ($key in @('AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'RESOURCE_GROUP_ID', 'AZURE_LOCATION',
        'AZURE_FUNCTION_APP_ID', 'AZURE_FUNCTION_APP_NAME', 'AZURE_STORAGE_ACCOUNT_NAME')) {
    if (-not $values.Contains($key) -or [string]::IsNullOrWhiteSpace($values[$key])) { throw "Missing explicit azd output: $key" }
}
$subscription = [string]$values.AZURE_SUBSCRIPTION_ID
$group = [string]$values.AZURE_RESOURCE_GROUP
$groupId = "/subscriptions/$subscription/resourceGroups/$group"
if ($subscription -notmatch '^[a-fA-F0-9-]{36}$' -or $values.RESOURCE_GROUP_ID -ine $groupId -or
    $values.AZURE_FUNCTION_APP_ID -ine "$groupId/providers/Microsoft.Web/sites/$($values.AZURE_FUNCTION_APP_NAME)") {
    throw 'Explicit subscription/resource group/Function outputs do not agree.'
}
$functionId = [string]$values.AZURE_FUNCTION_APP_ID
$storageId = "$groupId/providers/Microsoft.Storage/storageAccounts/$($values.AZURE_STORAGE_ACCOUNT_NAME)"
$stateDirectory = Join-Path $root ".azure\$EnvironmentName"
$snapshotPath = Join-Path $stateDirectory 'private-agent.json'
$snapshot = if (Test-Path -LiteralPath $snapshotPath) { Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json } else { $null }

if ($Action -eq 'Cleanup') {
    if (-not $RemoveAgent -or $ProvisionAgent) { throw 'Cleanup requires -RemoveAgent and forbids -ProvisionAgent.' }
    if ($null -eq $snapshot) { throw 'Cleanup requires the exact retained private-agent.json deployment output snapshot.' }
    Restore-PrivateAgentOutputs $snapshot $snapshotPath $subscription $group -ForCleanup
    Assert-PrivateAgentSnapshot $snapshot $groupId $functionId $storageId
    Set-AzdEnvironmentValue -EnvironmentName $EnvironmentName -Name PRIVATE_DEPLOYMENT_APPROVED -Value false
    $resources = @(Invoke-AzureCli -Arguments @('resource', 'list', '--subscription', $subscription,
        '--resource-group', $group, '--output', 'json') | ConvertFrom-Json)
    Assert-PrivateAgentOwnership $snapshot $resources
    $currentRoles = @(foreach ($role in $snapshot.outputs.roleAssignments) {
        Invoke-AzureCli -Arguments @('role', 'assignment', 'list', '--subscription', $subscription,
            '--scope', $role.scope, '--all', '--output', 'json') | ConvertFrom-Json |
            Where-Object { $_.id -ieq $role.id }
    })
    # Validate every remaining role before issuing any delete, including during partial cleanup retries.
    foreach ($role in $snapshot.outputs.roleAssignments) {
        $current = @($currentRoles | Where-Object { $_.id -ieq $role.id })
        if ($current.Count -gt 1 -or ($current.Count -eq 1 -and
            ($current[0].principalId -ine $snapshot.outputs.principalId -or
             $current[0].roleDefinitionId -ine $role.roleDefinitionId -or $current[0].scope -ine $role.scope))) {
            throw 'Role assignment ownership changed; cleanup refused.'
        }
    }
    foreach ($role in $snapshot.outputs.roleAssignments) {
        if (@($currentRoles | Where-Object { $_.id -ieq $role.id }).Count) {
            $null = Invoke-AzureCli -Arguments @('role', 'assignment', 'delete', '--subscription', $subscription, '--ids', $role.id)
        }
    }
    foreach ($key in @('vmId', 'nicId', 'diskId', 'nsgId')) {
        if (@($resources | Where-Object { $_.id -ieq $snapshot.outputs.$key }).Count) {
            $null = Invoke-AzureCli -Arguments @('resource', 'delete', '--subscription', $subscription, '--ids', $snapshot.outputs.$key)
        }
    }
    $remaining = @(Invoke-AzureCli -Arguments @('resource', 'list', '--subscription', $subscription,
        '--resource-group', $group, '--output', 'json') | ConvertFrom-Json)
    $targetIds = @($snapshot.outputs.vmId, $snapshot.outputs.nicId, $snapshot.outputs.diskId, $snapshot.outputs.nsgId)
    if (@($remaining | Where-Object { $_.id -in $targetIds }).Count) { throw 'Cleanup incomplete; snapshot retained for retry.' }
    $remainingRoles = @(foreach ($role in $snapshot.outputs.roleAssignments) {
        Invoke-AzureCli -Arguments @('role', 'assignment', 'list', '--subscription', $subscription,
            '--scope', $role.scope, '--all', '--output', 'json') | ConvertFrom-Json |
            Where-Object { $_.id -ieq $role.id }
    })
    if (@($remainingRoles | Where-Object { $_.id -in @($snapshot.outputs.roleAssignments.id) }).Count) {
        throw 'Role cleanup incomplete; snapshot retained for retry.'
    }
    $snapshot.state = 'Cleaned'
    Save-PrivateAgentSnapshot $snapshotPath $snapshot
    Write-Output 'Exact recorded agent resources and roles removed; approval reset. Audit snapshot retained.'
    return
}

if ($RemoveAgent) { throw '-RemoveAgent is only valid with -Action Cleanup; deployment never automatically removes the agent.' }
if ((Get-ApiNetworkStage) -ne 'private' -or $env:PRIVATE_DEPLOYMENT_APPROVED -cne 'true') {
    throw 'Deploy requires private stage and PRIVATE_DEPLOYMENT_APPROVED=true.'
}
$subnetId = [string]$values.PRIVATE_ENDPOINT_SUBNET_ID
if (-not $subnetId) { $subnetId = [string]$values.AZURE_PRIVATE_ENDPOINT_SUBNET_ID }
if ($subnetId -notmatch ('^' + [regex]::Escape($groupId) + '/providers/Microsoft.Network/virtualNetworks/[^/]+/subnets/private-endpoints$')) {
    throw 'An explicit existing private-endpoints subnet ID in the deployment resource group is required.'
}
foreach ($target in @(@{ id = $functionId; version = '2024-04-01' }, @{ id = $storageId; version = '2023-05-01' })) {
    if ((Invoke-AzureRest -ResourceId $target.id -ApiVersion $target.version).properties.publicNetworkAccess -ne 'Disabled') {
        throw 'Function and Storage public network access must already be Disabled.'
    }
}
if ($null -eq $snapshot -and -not $ProvisionAgent) { throw 'First deployment requires explicit -ProvisionAgent.' }
if ($null -ne $snapshot -and $ProvisionAgent) { throw 'Snapshot already exists; reuse without -ProvisionAgent or explicitly recover/clean it first.' }
if ($null -ne $snapshot) {
    Restore-PrivateAgentOutputs $snapshot $snapshotPath $subscription $group
    if ($snapshot.state -in @('CleanupReady', 'Cleaned')) { throw 'Agent requires cleanup or was cleaned; it cannot be reused for deployment.' }
}
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$operation = [guid]::NewGuid().ToString('N')
$localWork = Join-Path $stateDirectory "private-agent-$operation"
New-Item -ItemType Directory -Path $localWork | Out-Null
try {
    $packagePath = Join-Path $localWork 'source.zip'
    New-PrivateSourcePackage (Join-Path $root 'api') $packagePath
    if ($null -eq $snapshot) {
        $token = [guid]::NewGuid().ToString('N')
        $name = 'pda-' + $token.Substring(0, 16)
        $snapshot = [ordered]@{
            version = 1; environmentName = $EnvironmentName; subscriptionId = $subscription
            resourceGroupId = $groupId; ownerToken = $token; agentName = $name
            deploymentName = $name; state = 'Provisioning'; outputs = $null
            plannedOutputs = @{
                vmId = "$groupId/providers/Microsoft.Compute/virtualMachines/$name"
                nicId = "$groupId/providers/Microsoft.Network/networkInterfaces/$name-nic"
                diskId = "$groupId/providers/Microsoft.Compute/disks/$name-os"
                nsgId = "$groupId/providers/Microsoft.Network/networkSecurityGroups/$name-nsg"
                principalId = ''; diskUniqueId = ''; roleAssignments = @()
                functionId = $functionId; storageId = $storageId; subnetId = $subnetId; ownerToken = $token
            }
        }
        $resources = @(Invoke-AzureCli -Arguments @('resource', 'list', '--subscription', $subscription,
            '--resource-group', $group, '--output', 'json') | ConvertFrom-Json)
        if (@($resources | Where-Object { $_.name -in @($name, "$name-nic", "$name-os", "$name-nsg") }).Count) {
            throw 'Agent resource names already exist; refusing to overwrite.'
        }
        $keyPath = Join-Path $localWork 'agent-key'
        & ssh-keygen -q -t ed25519 -N '' -f $keyPath
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath "$keyPath.pub")) { throw 'SSH key generation failed.' }
        $parameters = @{
            location = $values.AZURE_LOCATION; agentName = $name; ownerToken = $token; subnetId = $subnetId
            functionAppName = $values.AZURE_FUNCTION_APP_NAME; storageAccountName = $values.AZURE_STORAGE_ACCOUNT_NAME
            vmSize = $VmSize; sshPublicKey = (Get-Content -Raw -LiteralPath "$keyPath.pub").Trim()
        }
        $parameterDocument = @{ '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'; contentVersion = '1.0.0.0'; parameters = @{} }
        foreach ($key in $parameters.Keys) { $parameterDocument.parameters[$key] = @{ value = $parameters[$key] } }
        $parameterPath = Join-Path $localWork 'parameters.json'
        $parameterDocument | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $parameterPath -Encoding utf8
        Save-PrivateAgentSnapshot $snapshotPath $snapshot
        $deployment = Invoke-AzureCli -Arguments @('deployment', 'group', 'create', '--subscription', $subscription,
            '--resource-group', $group, '--name', $name, '--template-file', (Join-Path $root 'infra\deployment-agent.bicep'),
            '--parameters', "@$parameterPath", '--output', 'json') | ConvertFrom-Json
        $outputValues = @{}
        foreach ($property in $deployment.properties.outputs.PSObject.Properties) { $outputValues[$property.Name] = $property.Value.value }
        $snapshot.outputs = $outputValues
        $snapshot.state = 'Ready'
        Save-PrivateAgentSnapshot $snapshotPath $snapshot
    }
    Assert-PrivateAgentSnapshot $snapshot $groupId $functionId $storageId
    if ($snapshot.outputs.subnetId -ine $subnetId) { throw 'Snapshot subnet does not match the selected environment.' }
    $resources = @(Invoke-AzureCli -Arguments @('resource', 'list', '--subscription', $subscription,
        '--resource-group', $group, '--output', 'json') | ConvertFrom-Json)
    Assert-PrivateAgentOwnership $snapshot $resources
    if (@($resources | Where-Object { $_.id -ieq $snapshot.outputs.vmId }).Count -ne 1) { throw 'Recorded VM is missing.' }
    $remoteWork = "/opt/private-api/$operation"
    Send-PrivateAgentFile $snapshot.outputs.vmId $packagePath "$remoteWork/source.zip"
    $guestPath = Join-Path $localWork 'private-api-deploy.sh'
    [IO.File]::WriteAllText($guestPath, [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'private-api-deploy.sh')).Replace("`r", ''), [Text.UTF8Encoding]::new($false))
    Send-PrivateAgentFile $snapshot.outputs.vmId $guestPath "$remoteWork/private-api-deploy.sh"
    $configPath = Join-Path $localWork 'config.json'
    @{ subscriptionId = $subscription; resourceGroup = $group; functionId = $functionId
       functionName = $values.AZURE_FUNCTION_APP_NAME; storageId = $storageId } |
        ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
    Send-PrivateAgentFile $snapshot.outputs.vmId $configPath "$remoteWork/config.json"
    $evidenceLines = @(Invoke-PrivateAgentCommand $snapshot.outputs.vmId "timeout 2400 bash '$remoteWork/private-api-deploy.sh' '$remoteWork'")
    if ($evidenceLines.Count -ne 1) { throw 'Missing explicit package completion evidence; agent retained.' }
    $evidence = $evidenceLines[0].Substring('PRIVATE_PACKAGE_EVIDENCE='.Length) | ConvertFrom-Json
    if ($evidence.status -ne 4 -or $evidence.deploymentId -notmatch '^[a-zA-Z0-9_-]{1,128}$' -or
        $evidence.packageSha256 -notmatch '^[a-f0-9]{64}$' -or $evidence.nodeVersion -ne '20.20.2' -or
        -not $evidence.privateDnsAndTls -or -not $evidence.anonymousScheduleDenied) { throw 'Invalid package completion evidence.' }
    if ($snapshot -is [Collections.IDictionary]) { $snapshot['lastDeployment'] = $evidence }
    else { $snapshot | Add-Member -NotePropertyName lastDeployment -NotePropertyValue $evidence -Force }
    Save-PrivateAgentSnapshot $snapshotPath $snapshot
    Write-Output ($evidence | ConvertTo-Json -Compress)
    Write-Output 'Private deployment verified. Agent retained; explicit -Action Cleanup -RemoveAgent is required.'
} finally {
    # Only local transient source/key material is removed. Azure resources and ownership snapshot survive every failure.
    Remove-Item -LiteralPath $localWork -Recurse -Force
}
