#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# The Run Command wrapper keeps all tool output in a root-only file on the VM.
work=$1
cd "$work"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip zip python3 xz-utils
if ! command -v az >/dev/null 2>&1; then
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://aka.ms/InstallAzureCLIDeb -o install-azure-cli.sh
    bash install-azure-cli.sh
fi

node_version=20.20.2
archive="node-v${node_version}-linux-x64.tar.xz"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o SHASUMS256.txt
curl --fail --silent --show-error --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${node_version}/${archive}" -o "$archive"
awk -v file="$archive" '$2 == file { print; found++ } END { if (found != 1) exit 1 }' SHASUMS256.txt > node.sha256
sha256sum --check node.sha256
tar -xf "$archive"
export PATH="$work/node-v${node_version}-linux-x64/bin:$PATH"
test "$(node --version)" = "v${node_version}"

readarray -t settings < <(python3 - <<'PY'
import json
c = json.load(open("config.json"))
for k in ("subscriptionId", "resourceGroup", "functionId", "functionName", "storageId"):
    print(c[k])
PY
)
subscription=${settings[0]}
group=${settings[1]}
function_id=${settings[2]}
function_name=${settings[3]}
storage_id=${settings[4]}
export AZURE_CORE_ONLY_SHOW_ERRORS=true
az login --identity --allow-no-subscriptions --output none
az account set --subscription "$subscription"

assert_private() {
    az rest --method get --url "https://management.azure.com${function_id}?api-version=2024-04-01" -o json > site.json
    az rest --method get --url "https://management.azure.com${storage_id}?api-version=2023-05-01" -o json > storage.json
    python3 - <<'PY'
import json
for f in ("site.json", "storage.json"):
    assert json.load(open(f))["properties"]["publicNetworkAccess"] == "Disabled", "Public access must remain Disabled"
PY
}
# Reader assignments can take several minutes to propagate to the new identity.
ready=false
for attempt in $(seq 1 36); do
    if assert_private; then ready=true; break; fi
    sleep 10
done
test "$ready" = true

python3 - <<'PY'
import json, socket, subprocess

def arm(resource, version="2023-11-01"):
    return json.loads(subprocess.check_output(
        ["az", "rest", "--method", "get", "--url",
         "https://management.azure.com" + resource + "?api-version=" + version, "-o", "json"]))

def endpoint_addresses(resource, group):
    addresses = set()
    for connection in resource["properties"].get("privateEndpointConnections", []):
        props = connection["properties"]
        if props["privateLinkServiceConnectionState"]["status"] != "Approved":
            continue
        endpoint = arm(props["privateEndpoint"]["id"])
        links = endpoint["properties"].get("privateLinkServiceConnections", []) + endpoint["properties"].get("manualPrivateLinkServiceConnections", [])
        if not any(group in link["properties"].get("groupIds", []) for link in links):
            continue
        for nic in endpoint["properties"]["networkInterfaces"]:
            for config in arm(nic["id"])["properties"]["ipConfigurations"]:
                addresses.add(config["properties"]["privateIPAddress"])
    assert addresses, "Missing approved private endpoint NIC addresses"
    return addresses

site = json.load(open("site.json"))
storage = json.load(open("storage.json"))
host = site["properties"]["defaultHostName"]
scm = host.split(".", 1)[0] + ".scm." + host.split(".", 1)[1]
blob = storage["properties"]["primaryEndpoints"]["blob"].split("/")[2]
site_ips = endpoint_addresses(site, "sites")
blob_ips = endpoint_addresses(storage, "blob")
for hostname, expected in ((host, site_ips), (scm, site_ips), (blob, blob_ips)):
    actual = {entry[4][0] for entry in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    assert actual and actual <= expected, "DNS does not match ARM private endpoint NIC addresses"
    # Default certificate and hostname verification is deliberately mandatory.
    import ssl
    with socket.create_connection((hostname, 443), timeout=30) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname=hostname):
            pass
json.dump({"host": host}, open("host.json", "w"))
PY

mkdir source
unzip -q source.zip -d source
cd source
test -f host.json && test -f package.json && test -f package-lock.json && test -d src
npm ci --omit=dev
if test -d test; then node --test test/*.test.js; fi
test -d node_modules
zip -q -r "$work/package.zip" host.json package.json package-lock.json src node_modules
cd "$work"
python3 - <<'PY'
import zipfile
with zipfile.ZipFile("package.zip") as package:
    names = package.namelist()
    assert "host.json" in names and "package.json" in names
    assert any(p.startswith("src/") for p in names)
    assert any(p.startswith("node_modules/") for p in names)
    assert not any(p.startswith("source/") for p in names)
PY
assert_private
az webapp log deployment list --subscription "$subscription" --resource-group "$group" \
    --name "$function_name" --output json > prior-deployments.json
az functionapp deployment source config-zip --subscription "$subscription" --resource-group "$group" \
    --name "$function_name" --src "$work/package.zip" --build-remote false --output json > deployment-result.json
# Some CLI versions return a string instead of the deployment record.
python3 - <<'PY'
import json, subprocess, time
record = json.load(open("deployment-result.json"))
c = json.load(open("config.json"))
prior = {str(r["id"]) for r in json.load(open("prior-deployments.json"))}
candidate = str(record["id"]) if isinstance(record, dict) and record.get("id") else None
if candidate:
    assert candidate not in prior, "SCM record is stale"
for attempt in range(36):
    records = json.loads(subprocess.check_output([
        "az", "webapp", "log", "deployment", "list", "--subscription", c["subscriptionId"],
        "--resource-group", c["resourceGroup"], "--name", c["functionName"], "-o", "json"]))
    assert isinstance(records, list), "Missing actual SCM deployment records"
    fresh = [r for r in records if str(r.get("id", "")) not in prior and r.get("id")]
    assert len(fresh) <= 1, "Ambiguous concurrent SCM deployments"
    if fresh:
        record = fresh[0]
        assert not candidate or str(record["id"]) == candidate, "SCM deployment ID mismatch"
        status = int(record.get("status", -1))
        assert status != 3, "Actual SCM deployment failed"
        if status == 4:
            break
    time.sleep(5)
else:
    raise AssertionError("Missing or incomplete actual SCM deployment record")
json.dump(record, open("scm-deployment.json", "w"))
PY
assert_private
host=$(python3 -c 'import json; print(json.load(open("host.json"))["host"])')
smoke=false
for attempt in $(seq 1 24); do
    status=$(curl --silent --show-error --output smoke-body.json --write-out '%{http_code}' \
        --connect-timeout 15 --max-time 30 --proto '=https' --tlsv1.2 "https://${host}/api/schedule") || status=000
    if [[ "$status" == 401 || "$status" == 403 ]]; then smoke=true; break; fi
    sleep 10
done
test "$smoke" = true
assert_private
python3 - <<'PY'
import hashlib, json, re
record = json.load(open("scm-deployment.json"))
assert re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", str(record["id"])), "Unsafe SCM deployment identifier"
evidence = {"deploymentId": str(record["id"]), "status": 4,
            "packageSha256": hashlib.sha256(open("package.zip", "rb").read()).hexdigest(),
            "nodeVersion": "20.20.2", "privateDnsAndTls": True, "anonymousScheduleDenied": True}
print("PRIVATE_PACKAGE_EVIDENCE=" + json.dumps(evidence, separators=(",", ":")))
PY
