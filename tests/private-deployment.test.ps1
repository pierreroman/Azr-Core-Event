$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $root 'scripts\Deploy-PrivateApi.ps1'
$guestPath = Join-Path $root 'scripts\private-api-deploy.sh'
$modulePath = Join-Path $root 'infra\deployment-agent.bicep'
$errors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
Write-Output 'PASS: PowerShell syntax'
. $scriptPath -EnvironmentName 'offline-test'

function Assert-True([bool]$Value, [string]$Message) {
    if (-not $Value) { throw $Message }
    Write-Host "PASS: $Message"
}
function Assert-Fails([scriptblock]$Operation, [string]$Message) {
    $failed = $false
    try { & $Operation } catch { $failed = $true }
    Assert-True $failed $Message
}
$global:PrivateAgentTestMode = 'success'
function Invoke-AzureCli {
    param([string[]]$Arguments)
    if (($Arguments[0..2] -join ' ') -ne 'vm run-command invoke') { throw 'Unexpected mocked command.' }
    $body = [IO.File]::ReadAllText($Arguments[([array]::IndexOf($Arguments, '--scripts') + 1)].Substring(1))
    Assert-True (-not $body.Contains("`r")) 'Run Command scripts are LF normalized'
    $marker = [regex]::Match($body, 'PRIVATE_AGENT_COMPLETE_[a-f0-9]{32}').Value
    $stdout = switch ($global:PrivateAgentTestMode) {
        'success' { $marker }
        'evidence' { "PRIVATE_PACKAGE_EVIDENCE={`"status`":4}`n$marker" }
        'missing' { 'tool returned exit zero without marker' }
        'trailing' { "$marker`nsubsequent unexpected output" }
        'oversize' { ('x' * 4097) + "`n$marker" }
    }
    return (@{ value = @(@{ code = 'ComponentStatus/StdOut/succeeded'; message = $stdout },
        @{ code = 'ComponentStatus/StdErr/succeeded'; message = '' }) } | ConvertTo-Json -Depth 5)
}
$null = Invoke-PrivateAgentCommand '/offline/vm' "printf 'test'`r`n"
Write-Output 'PASS: exact final completion marker accepted'
$global:PrivateAgentTestMode = 'evidence'
$evidence = @(Invoke-PrivateAgentCommand '/offline/vm' 'true')
Assert-True ($evidence.Count -eq 1 -and $evidence[0] -eq 'PRIVATE_PACKAGE_EVIDENCE={"status":4}') 'Explicit evidence is returned separately from completion marker'
foreach ($mode in @('missing', 'trailing', 'oversize')) {
    $global:PrivateAgentTestMode = $mode
    Assert-Fails { Invoke-PrivateAgentCommand '/offline/vm' 'true' } "Run Command fails closed for $mode output"
}
$commandDirectory = Join-Path $root '.azure\offline-test'
if ((Test-Path -LiteralPath $commandDirectory) -and -not @(Get-ChildItem -LiteralPath $commandDirectory -Force).Count) {
    Remove-Item -LiteralPath $commandDirectory
}

$directory = Join-Path $root ('.azure\private-agent-offline-' + [guid]::NewGuid().ToString('N'))
try {
    $api = Join-Path $directory 'api'
    New-Item -ItemType Directory -Path (Join-Path $api 'src'), (Join-Path $api 'test') -Force | Out-Null
    foreach ($name in @('host.json', 'package.json', 'package-lock.json')) {
        '{}' | Set-Content -LiteralPath (Join-Path $api $name)
    }
    'working-tree-current' | Set-Content -LiteralPath (Join-Path $api 'src\index.js')
    'test-content' | Set-Content -LiteralPath (Join-Path $api 'test\authorization.test.js')
    'DO_NOT_SHIP' | Set-Content -LiteralPath (Join-Path $api '.env')
    'DO_NOT_SHIP' | Set-Content -LiteralPath (Join-Path $api 'local.settings.json')
    New-Item -ItemType Directory -Path (Join-Path $api 'node_modules') | Out-Null
    'DO_NOT_SHIP' | Set-Content -LiteralPath (Join-Path $api 'node_modules\index.js')
    $package = Join-Path $directory 'source.zip'
    New-PrivateSourcePackage $api $package
    $archive = [IO.Compression.ZipFile]::OpenRead($package)
    try {
        $names = @($archive.Entries.FullName)
        Assert-True ($names.Count -eq 5) 'Only allowlisted source, manifests, host and optional tests packaged'
        Assert-True ('src/index.js' -in $names -and 'host.json' -in $names -and 'test/authorization.test.js' -in $names) 'ZIP has root-level host and current source'
        $reader = [IO.StreamReader]::new($archive.GetEntry('src/index.js').Open())
        try { Assert-True ($reader.ReadToEnd().Trim() -eq 'working-tree-current') 'Packaging reads working tree, not stale archive or git HEAD' }
        finally { $reader.Dispose() }
    } finally { $archive.Dispose() }
    '{}' | Set-Content -LiteralPath (Join-Path $api 'src\credentials.json')
    Assert-Fails { New-PrivateSourcePackage $api (Join-Path $directory 'unsafe.zip') } 'Secret-like source paths fail closed'

    $sub = '11111111-2222-3333-4444-555555555555'
    $groupId = "/subscriptions/$sub/resourceGroups/offline"
    $function = "$groupId/providers/Microsoft.Web/sites/function"
    $storage = "$groupId/providers/Microsoft.Storage/storageAccounts/storage"
    $name = 'pda-1234567890abcdef'
    $snapshot = @{
        version = 1; environmentName = 'offline-test'; subscriptionId = $sub; resourceGroupId = $groupId
        state = 'Ready'; ownerToken = '1234567890abcdef1234567890abcdef'; agentName = $name
        outputs = @{
            vmId = "$groupId/providers/Microsoft.Compute/virtualMachines/$name"
            nicId = "$groupId/providers/Microsoft.Network/networkInterfaces/$name-nic"
            diskId = "$groupId/providers/Microsoft.Compute/disks/$name-os"
            diskUniqueId = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'
            nsgId = "$groupId/providers/Microsoft.Network/networkSecurityGroups/$name-nsg"
            principalId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
            ownerToken = '1234567890abcdef1234567890abcdef'; functionId = $function; storageId = $storage
            subnetId = "$groupId/providers/Microsoft.Network/virtualNetworks/vnet/subnets/private-endpoints"
            roleAssignments = @()
        }
    }
    foreach ($role in @(@($function, 'de139f84-1756-47ae-9be6-808fbbe84772'),
            @($storage, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'),
            @($groupId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7'))) {
        $snapshot.outputs.roleAssignments += @{
            id = "$($role[0])/providers/Microsoft.Authorization/roleAssignments/$([guid]::NewGuid())"
            scope = $role[0]; roleDefinitionId = "/subscriptions/$sub/providers/Microsoft.Authorization/roleDefinitions/$($role[1])"
        }
    }
    Assert-PrivateAgentSnapshot $snapshot $groupId $function $storage
    Write-Output 'PASS: exact scoped snapshot accepted'
    $snapshot.outputs.vmId = "$groupId/providers/Microsoft.Compute/virtualMachines/unrelated"
    Assert-Fails { Assert-PrivateAgentSnapshot $snapshot $groupId $function $storage } 'Unrelated VM cleanup ID rejected'
    $snapshot.outputs.vmId = "$groupId/providers/Microsoft.Compute/virtualMachines/$name"
    $snapshot.outputs.roleAssignments[0].scope = $groupId
    Assert-Fails { Assert-PrivateAgentSnapshot $snapshot $groupId $function $storage } 'Broadened role cleanup scope rejected'
    $snapshot.outputs.roleAssignments[0].scope = $function
    Assert-Fails {
        Assert-PrivateAgentOwnership $snapshot @(@{ id = $snapshot.outputs.nicId; tags = @{ 'private-deployment-owner' = 'other' } })
    } 'Foreign resource ownership rejected before deletion'
    function Invoke-AzureRest {
        return [pscustomobject]@{ id = $snapshot.outputs.diskId; properties = @{ uniqueId = $snapshot.outputs.diskUniqueId } }
    }
    Assert-PrivateAgentOwnership $snapshot @(@{ id = $snapshot.outputs.diskId })
    Write-Output 'PASS: Detached disk without managedBy can be cleaned after a partial cleanup retry'
    function Invoke-AzureRest {
        return [pscustomobject]@{ managedBy = '/unrelated/vm'; properties = @{ uniqueId = $snapshot.outputs.diskUniqueId } }
    }
    Assert-Fails {
        Assert-PrivateAgentOwnership $snapshot @(@{ id = $snapshot.outputs.diskId })
    } 'Disk attached to another VM cannot be deleted'
    function Invoke-AzureRest {
        return [pscustomobject]@{ properties = @{ uniqueId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } }
    }
    Assert-Fails {
        Assert-PrivateAgentOwnership $snapshot @(@{ id = $snapshot.outputs.diskId })
    } 'Replacement disk with same resource ID cannot be deleted'
    function Invoke-AzureRest {
        return [pscustomobject]@{
            properties = @{ uniqueId = $snapshot.outputs.diskUniqueId }
            managedByExtended = @('/unrelated/shared-vm')
        }
    }
    Assert-Fails {
        Assert-PrivateAgentOwnership $snapshot @(@{ id = $snapshot.outputs.diskId })
    } 'Shared managed disk cannot be deleted'
    function Invoke-AzureRest {
        return [pscustomobject]@{ properties = [pscustomobject]@{
            virtualMachine = @{ id = '/unrelated/vm' }; networkSecurityGroup = @{ id = $snapshot.outputs.nsgId }
            ipConfigurations = @(@{ properties = @{ subnet = @{ id = $snapshot.outputs.subnetId } } })
        } }
    }
    $ownedNic = @{ id = $snapshot.outputs.nicId; tags = @{ 'private-deployment-owner' = $snapshot.ownerToken } }
    Assert-Fails { Assert-PrivateAgentOwnership $snapshot @($ownedNic) } 'NIC attached to an unrelated VM cannot be deleted'
    function Invoke-AzureRest {
        return [pscustomobject]@{ properties = [pscustomobject]@{
            networkSecurityGroup = @{ id = $snapshot.outputs.nsgId }
            ipConfigurations = @(@{ properties = @{ subnet = @{ id = $snapshot.outputs.subnetId } } })
        } }
    }
    Assert-PrivateAgentOwnership $snapshot @($ownedNic)
    Write-Output 'PASS: Detached owned NIC is safe on partial cleanup retry'
    function Invoke-AzureRest {
        return [pscustomobject]@{ properties = [pscustomobject]@{ networkInterfaces = @(@{ id = '/unrelated/nic' }) } }
    }
    Assert-Fails {
        Assert-PrivateAgentOwnership $snapshot @(@{ id = $snapshot.outputs.nsgId; tags = @{ 'private-deployment-owner' = $snapshot.ownerToken } })
    } 'NSG shared with another NIC cannot be deleted'
    $snapshotPath = Join-Path $directory 'snapshot.json'
    Save-PrivateAgentSnapshot $snapshotPath $snapshot
    Assert-True ((Get-Content -Raw $snapshotPath | ConvertFrom-Json).outputs.principalId -eq $snapshot.outputs.principalId) 'Atomic snapshot persists exact principal and outputs'
    $recovery = @{
        version = 1; environmentName = 'offline-test'; subscriptionId = $sub; resourceGroupId = $groupId
        state = 'Provisioning'; ownerToken = $snapshot.ownerToken; agentName = $name; deploymentName = $name
        outputs = $null; plannedOutputs = ($snapshot.outputs | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
    }
    $recovery.plannedOutputs.principalId = ''
    $recovery.plannedOutputs.diskUniqueId = ''
    $recovery.plannedOutputs.roleAssignments = @()
    $fixture = $snapshot.outputs
    $global:PrivateRecoveryUnproven = $false
    function Invoke-AzureCli {
        param([string[]]$Arguments)
        if (($Arguments[0..2] -join ' ') -eq 'deployment group show') {
            return (@{ properties = @{ provisioningState = 'Failed'; parameters = @{
                agentName = @{ value = $name }; ownerToken = @{ value = $fixture.ownerToken }
                subnetId = @{ value = $fixture.subnetId }; functionAppName = @{ value = 'function' }
                storageAccountName = @{ value = 'storage' }
            } } } | ConvertTo-Json -Depth 10)
        }
        if (($Arguments[0..3] -join ' ') -eq 'deployment operation group list') {
            $id = if ($global:PrivateRecoveryUnproven) { '/unrelated/nic' } else { $fixture.nicId }
            return (ConvertTo-Json -InputObject @(@{ properties = @{ targetResource = @{ id = $id } } }) -Depth 8)
        }
        if ($Arguments[0] -eq 'resource') { return (ConvertTo-Json -InputObject @($ownedNic) -Depth 8) }
        if ($Arguments[0] -eq 'role') { return '[]' }
        throw 'Unexpected recovery CLI request'
    }
    function Invoke-AzureRest {
        return [pscustomobject]@{ properties = [pscustomobject]@{
            networkSecurityGroup = @{ id = $fixture.nsgId }
            ipConfigurations = @(@{ properties = @{ subnet = @{ id = $fixture.subnetId } } })
        } }
    }
    Restore-PrivateAgentOutputs $recovery $snapshotPath $sub 'offline' -ForCleanup
    Assert-True ($recovery.state -eq 'CleanupReady' -and @($recovery.outputs.roleAssignments).Count -eq 0) 'Failed ARM deployment safely recovers proven owned NIC without requiring VM or roles'
    $recovery.state = 'Provisioning'
    $global:PrivateRecoveryUnproven = $true
    Assert-Fails { Restore-PrivateAgentOutputs $recovery $snapshotPath $sub 'offline' -ForCleanup } 'Failed ARM recovery refuses resources not proven by exact deployment operations'
    Remove-Variable PrivateRecoveryUnproven -Scope Global
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
    Remove-Variable PrivateAgentTestMode -Scope Global
}
$guest = [IO.File]::ReadAllText($guestPath)
$module = [IO.File]::ReadAllText($modulePath)
$driver = [IO.File]::ReadAllText($scriptPath)
foreach ($requirement in @('20.20.2', 'SHASUMS256.txt', 'sha256sum --check', 'npm ci --omit=dev',
        '--build-remote false', 'socket.getaddrinfo', 'ssl.create_default_context()', 'privateIPAddress',
        'publicNetworkAccess',         'PRIVATE_PACKAGE_EVIDENCE=', 'prior-deployments.json', 'Ambiguous concurrent SCM deployments')) {
    Assert-True $guest.Contains($requirement) "Guest enforces $requirement"
}
Assert-True (-not ($guest -match '(--insecure|curl\s+-k|publicNetworkAccess.*Enabled)')) 'Guest never bypasses TLS or enables public access'
Assert-True ($module.Contains("targetScope = 'resourceGroup'") -and $module.Contains("access: 'Deny'") -and
    $module.Contains('disablePasswordAuthentication: true') -and -not $module.Contains('publicIPAddress')) 'Module has RG scope, deny inbound, key-only SSH and no public IP'
Assert-True (-not ($driver -match 'npm (ci|install)|az storage blob|--sas-token')) 'No local Node dependency install or public blob transfer'
Assert-True ($driver.Contains('-Name PRIVATE_DEPLOYMENT_APPROVED -Value false') -and $driver.Contains("if (`$Action -eq 'Cleanup')")) 'Cleanup explicitly resets environment approval'
$scmTests = @'
import builtins, io, json, re, subprocess, sys, time
from unittest.mock import patch
guest = open(sys.argv[1], encoding="utf-8").read()
block = re.search(r"python3 - <<'PY'\n(import json, subprocess, time\n.*?)\nPY", guest, re.S).group(1)
config = {"subscriptionId":"sub","resourceGroup":"rg","functionName":"fn"}
def run(result, prior, batches, fails=False):
    files = {"deployment-result.json":json.dumps(result), "prior-deployments.json":json.dumps(prior),
             "config.json":json.dumps(config)}
    written = io.StringIO()
    def fake_open(path, mode="r"):
        return written if mode == "w" else io.StringIO(files[path])
    sequence = iter(batches)
    last = batches[-1]
    def cli(args):
        assert args[1:5] == ["webapp","log","deployment","list"]
        return json.dumps(next(sequence, last)).encode()
    failed = False
    with patch.object(builtins, "open", fake_open), patch.object(subprocess, "check_output", cli), patch.object(time, "sleep"):
        try:
            exec(compile(block, "scm-evidence", "exec"), {})
        except AssertionError:
            failed = True
    assert failed == fails
    if not fails:
        assert json.loads(written.getvalue())["id"] == "new"
run("CLI result was string", [{"id":"old"}], [[{"id":"new","status":4}]])
print("PASS: String config-zip result resolves fresh actual SCM deployment")
run({"id":"new","status":4}, [], [[{"id":"new","status":1}], [{"id":"new","status":4}]])
print("PASS: CLI object is corroborated by bounded SCM status polling")
run("string", [{"id":"old"}], [[{"id":"old","status":4}]], True)
print("PASS: Stale SCM deployment cannot prove completion")
run("string", [], [[{"id":"new","status":4},{"id":"other","status":4}]], True)
print("PASS: Concurrent SCM deployment ambiguity fails closed")
run({"id":"different"}, [], [[{"id":"new","status":4}]], True)
print("PASS: SCM deployment identifier mismatch fails closed")
run("string", [], [[{"id":"new","status":3}]], True)
print("PASS: Failed SCM deployment cannot prove completion")
'@
& python -c $scmTests $guestPath
if ($LASTEXITCODE -ne 0) { throw 'Offline SCM deployment evidence tests failed.' }
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path -LiteralPath $bash)) { $bash = (Get-Command bash -ErrorAction Stop).Source }
& $bash -n $guestPath
if ($LASTEXITCODE -ne 0) { throw 'Guest Bash syntax check failed.' }
Write-Output 'PASS: Bash syntax'
Write-Output 'All offline private deployment checks passed. No Azure resource operation was executed.'
