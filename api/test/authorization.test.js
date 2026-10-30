const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { authorizeGatewayRequest, decodePrincipal, getClientPrincipal, registerAuthorization } = require("../src/shared/authorization");
const operations = require("../src/shared/http-operations.json");

const gatewayId = "11111111-2222-3333-4444-555555555555";
const environment = { APIM_PRINCIPAL_ID: gatewayId };
const user = (id = "original-swa-user", roles = ["anonymous", "authenticated"]) => ({
    userId: id, userRoles: roles, identityProvider: "aad"
});
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64");
const request = (principal, headers = {}) => ({
    headers: new Headers({
        "x-ms-client-principal-id": gatewayId,
        ...(principal ? { "x-summit-client-principal": encode(principal) } : {}),
        ...headers
    })
});

function configure(t, values) {
    for (const [name, value] of Object.entries(values)) {
        const old = process.env[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
        t.after(() => {
            if (old === undefined) delete process.env[name];
            else process.env[name] = old;
        });
    }
}

function createHook() {
    let callback;
    registerAuthorization({ hook: { preInvocation: value => { callback = value; } } });
    return (functionName, handler) => {
        const messages = [];
        const context = {
            functionName, options: { trigger: { type: "httpTrigger" } },
            warn: message => messages.push(message), error: message => messages.push(message)
        };
        const hook = { invocationContext: context, functionHandler: handler };
        callback(hook);
        return { invoke: req => hook.functionHandler(req, context), messages, context };
    };
}

function loadFunctions() {
    const registrations = new Map();
    const favorites = new Map();
    const container = {
        items: {
            query: (query, options) => {
                assert.equal(query.parameters[0].value, options.partitionKey);
                return { fetchAll: async () => ({ resources: [...favorites.values()].filter(item => item.userId === options.partitionKey) }) };
            },
            upsert: async item => { favorites.set(`${item.userId}:${item.id}`, item); }
        },
        item: (id, partition) => ({ delete: async () => { favorites.delete(`${partition}:${id}`); } })
    };
    let hooksRegistered = 0;
    const modules = new Map();
    function load(filename) {
        if (modules.has(filename)) return modules.get(filename).exports;
        const localRequire = createRequire(filename);
        const module = { exports: {} };
        modules.set(filename, module);
        vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
            module, exports: module.exports, Buffer, URL,
            process: { env: { ...process.env, COSMOS_ENDPOINT: "https://test.invalid" } },
            require: name => {
                if (name === "@azure/functions") return { app: {
                    hook: { preInvocation: () => { hooksRegistered++; } },
                    http: (id, config) => {
                        assert.equal(hooksRegistered, 1, "authorization hook must load before every registration");
                        assert.ok(!registrations.has(id), "duplicate registration");
                        registrations.set(id, config);
                    }
                } };
                if (name === "@azure/cosmos") return { CosmosClient: class {
                    database() { return { container: () => container }; }
                } };
                if (name === "@azure/identity") return { DefaultAzureCredential: class {} };
                if (name.startsWith("@azure/")) return {};
                if (name.startsWith("./functions/")) return load(localRequire.resolve(name));
                return localRequire(name);
            }
        }, { filename });
        return module.exports;
    }
    load(path.resolve(__dirname, "../src/index.js"));
    return { registrations, favorites };
}

test("validates SWA principal encoding and shape without changing the user ID", () => {
    const principal = user();
    assert.deepEqual(decodePrincipal(encode(principal)), principal);
    assert.equal(decodePrincipal(null), null);
    for (const header of ["!", "e30", encode({}), encode({ ...principal, userRoles: "administrator" }),
        encode({ ...principal, userId: "" }), "a".repeat(16388), Buffer.from("{").toString("base64")]) {
        assert.throws(() => decodePrincipal(header));
    }
});

test("requires a configured, authenticated APIM caller even for public reads", () => {
    assert.equal(authorizeGatewayRequest(request(), "getSchedule", {}).response.status, 503);
    for (const caller of ["", "other-identity"]) {
        assert.equal(authorizeGatewayRequest(request(user(), {
            "x-ms-client-principal-id": caller
        }), "getSchedule", environment).response.status, 403);
    }
    assert.equal(authorizeGatewayRequest(request(), "getSchedule", environment).response, undefined);
    assert.equal(authorizeGatewayRequest(request(null, {
        "x-ms-client-principal-id": gatewayId.toUpperCase()
    }), "getSchedule", environment).response, undefined);
});

test("enforces the complete operation/role matrix and rejects unknown operations", () => {
    for (const operation of operations) {
        const anonymous = authorizeGatewayRequest(request(), operation.name, environment);
        const signedIn = authorizeGatewayRequest(request(user()), operation.name, environment);
        const admin = authorizeGatewayRequest(request(user("admin", ["authenticated", "administrator"])), operation.name, environment);
        assert.equal(anonymous.response?.status, operation.role === "anonymous" ? undefined : 401, operation.name);
        assert.equal(signedIn.response?.status, operation.role === "administrator" ? 403 : undefined, operation.name);
        assert.equal(admin.response, undefined, operation.name);
    }
    assert.equal(authorizeGatewayRequest(request(user()), "unknown", environment).response.status, 403);
    assert.equal(authorizeGatewayRequest(request(user("fake", ["administrator"])), "saveBranding", environment).response.status, 401);
});

test("rejects malformed or forged context without legacy-header fallback", () => {
    const result = authorizeGatewayRequest(request(null, {
        "x-summit-client-principal": "bad!",
        "x-ms-client-principal": encode(user("legacy-admin", ["authenticated", "administrator"]))
    }), "saveBranding", environment);
    assert.equal(result.response.status, 400);
    assert.equal(authorizeGatewayRequest(request(null, {
        "x-ms-client-principal": encode(user())
    }), "favorites-list", environment).response.status, 401);
});

test("the invocation hook preserves direct mode and fails closed on unknown mode", async t => {
    configure(t, { API_AUTH_MODE: "direct" });
    let called = 0;
    const handler = () => { called++; return { status: 204 }; };
    const makeHook = createHook();
    assert.equal((await makeHook("saveBranding", handler).invoke(request())).status, 204);
    process.env.API_AUTH_MODE = "typo";
    const denied = makeHook("getSchedule", handler);
    assert.equal((await denied.invoke(request())).status, 503);
    assert.equal(called, 1);
    assert.equal(denied.messages.length, 1);
});

test("the invocation hook denies writes before executing the handler", async t => {
    configure(t, { API_AUTH_MODE: "apim", APIM_PRINCIPAL_ID: gatewayId });
    let called = false;
    const hook = createHook()("saveBranding", () => { called = true; });
    assert.equal((await hook.invoke(request(user()))).status, 403);
    assert.equal(called, false);
    assert.equal(hook.messages.length, 1);
});

test("favorites uses only the hook-validated SWA identity in gateway mode", async t => {
    configure(t, { API_AUTH_MODE: "apim", APIM_PRINCIPAL_ID: gatewayId });
    const req = request(user("existing-partition-key"));
    const context = { warn() {}, error() {} };
    assert.equal(getClientPrincipal(req, context), null, "unvalidated request must not expose a principal");
    const hook = createHook()("favorites-list", (incoming, ctx) => getClientPrincipal(incoming, ctx));
    assert.equal((await hook.invoke(req)).userId, "existing-partition-key");
});

test("direct favorites retains SWA principals and rejects malformed identities with logging", t => {
    configure(t, { API_AUTH_MODE: "direct" });
    const messages = [];
    const context = { warn: value => messages.push(value), error: value => messages.push(value) };
    assert.equal(getClientPrincipal(request(null, { "x-ms-client-principal": encode(user("original-key")) }), context).userId, "original-key");
    assert.equal(getClientPrincipal(request(null, { "x-ms-client-principal": "invalid!" }), context), null);
    assert.equal(messages.length, 1);
});

test("every registered HTTP function has exactly one matching gateway operation", () => {
    const { registrations } = loadFunctions();
    assert.equal(registrations.size, operations.length);
    for (const operation of operations) {
        const actual = registrations.get(operation.name);
        assert.ok(actual, operation.name);
        assert.equal(JSON.stringify(actual.methods), JSON.stringify([operation.method]), operation.name);
        assert.equal(`/${actual.route}`, operation.route, operation.name);
    }
});

test("operation roles match the existing SWA route authorization rules", () => {
    const config = require("../../src/web/staticwebapp.config.json");
    for (const operation of operations) {
        const route = `/api${operation.route.replace(/\{[^}]+\}/g, "example")}`;
        const match = config.routes.find(rule =>
            (!rule.methods || rule.methods.includes(operation.method)) &&
            (rule.route.endsWith("*") ? route.startsWith(rule.route.slice(0, -1)) : route === rule.route));
        assert.equal(match?.allowedRoles?.[0] || "anonymous", operation.role, operation.name);
    }
});

test("favorites handlers preserve partition isolation through the gateway hook", async t => {
    configure(t, { API_AUTH_MODE: "apim", APIM_PRINCIPAL_ID: gatewayId });
    const { registrations, favorites } = loadFunctions();
    const invoke = async (operation, principal, extra = {}) => {
        const req = { ...request(principal), ...extra };
        return createHook()(operation, registrations.get(operation).handler).invoke(req);
    };
    const response = await invoke("favorites-add", user("user-A"), { params: { sessionId: "session-1" } });
    assert.equal(response.status, 200);
    assert.equal(favorites.get("user-A:session-1").userId, "user-A");
    assert.equal((await invoke("favorites-list", user("user-A"))).jsonBody.sessionIds[0], "session-1");
    assert.equal((await invoke("favorites-list", user("user-B"))).jsonBody.sessionIds.length, 0);
    assert.equal((await invoke("favorites-remove", user("user-B"), { params: { sessionId: "session-1" } })).status, 204);
    assert.ok(favorites.has("user-A:session-1"));
    assert.equal((await invoke("favorites-add", null, { params: { sessionId: "blocked" } })).status, 401);
    assert.equal(favorites.size, 1);
});
