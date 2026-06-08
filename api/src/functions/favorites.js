/*
 * favorites.js — per-user favorite sessions stored in Cosmos DB.
 *
 * Auth model: this API runs behind Azure Static Web Apps' managed
 * authentication. SWA injects the signed-in user's claims into the
 * `x-ms-client-principal` header (base64-encoded JSON). We never trust
 * a client-supplied userId — the identity comes only from that header.
 *
 * Routes (all require an authenticated user; enforced by
 * staticwebapp.config.json):
 *   GET    /api/favorites              -> { sessionIds: string[] }
 *   PUT    /api/favorites/{sessionId}  -> { sessionId, added: true }
 *   DELETE /api/favorites/{sessionId}  -> 204
 *   POST   /api/favorites/merge        -> body: { sessionIds: string[] }
 *                                         bulk-upserts; used once on
 *                                         first sign-in to migrate any
 *                                         anonymous localStorage stars.
 *
 * Storage: one Cosmos document per (userId, sessionId) pair:
 *   { id: "<sessionId>", userId: "<oid|sub>", sessionId, addedAt }
 * Partition key /userId keeps every user's stars in their own partition,
 * so the per-user list is a single-partition query (cheap).
 */

const { app } = require("@azure/functions");
const { CosmosClient } = require("@azure/cosmos");
const { ManagedIdentityCredential, DefaultAzureCredential } = require("@azure/identity");

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosDatabase = process.env.COSMOS_DATABASE || "event";
const cosmosContainer = "favorites";
const clientId = process.env.AZURE_CLIENT_ID;

let _container = null;
function getContainer() {
    if (_container) return _container;
    if (!cosmosEndpoint) {
        throw new Error("COSMOS_ENDPOINT is not configured");
    }
    // ManagedIdentityCredential in Azure; DefaultAzureCredential locally
    // so `func start` works with `az login` credentials.
    const credential = process.env.WEBSITE_INSTANCE_ID
        ? (clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential())
        : new DefaultAzureCredential();
    const client = new CosmosClient({ endpoint: cosmosEndpoint, aadCredentials: credential });
    _container = client.database(cosmosDatabase).container(cosmosContainer);
    return _container;
}

/**
 * Pull the SWA-issued client principal out of the request. Returns null
 * for anonymous requests. The header is base64-encoded JSON shaped like:
 *   { userId, userRoles, identityProvider, userDetails, claims }
 */
function getClientPrincipal(request) {
    const header = request.headers.get("x-ms-client-principal");
    if (!header) return null;
    try {
        const decoded = Buffer.from(header, "base64").toString("utf8");
        const principal = JSON.parse(decoded);
        // SWA's userId is a stable per-provider hash; good enough as a
        // partition key. We never expose it to other users.
        if (!principal || !principal.userId) return null;
        return principal;
    } catch (e) {
        return null;
    }
}

function unauthorized() {
    return { status: 401, jsonBody: { error: "Authentication required" } };
}

// GET /api/favorites — list current user's favorite session IDs
async function listFavorites(request, context) {
    const principal = getClientPrincipal(request);
    if (!principal) return unauthorized();

    try {
        const container = getContainer();
        const { resources } = await container.items
            .query({
                query: "SELECT c.sessionId FROM c WHERE c.userId = @userId",
                parameters: [{ name: "@userId", value: principal.userId }]
            }, { partitionKey: principal.userId })
            .fetchAll();
        return {
            status: 200,
            headers: { "Cache-Control": "no-store" },
            jsonBody: { sessionIds: resources.map(r => r.sessionId) }
        };
    } catch (err) {
        context.error("listFavorites failed:", err);
        return { status: 500, jsonBody: { error: "Failed to load favorites" } };
    }
}

// PUT /api/favorites/{sessionId} — add a favorite
async function addFavorite(request, context) {
    const principal = getClientPrincipal(request);
    if (!principal) return unauthorized();

    const sessionId = request.params.sessionId;
    if (!sessionId || sessionId.length > 200) {
        return { status: 400, jsonBody: { error: "Invalid sessionId" } };
    }

    try {
        const container = getContainer();
        await container.items.upsert({
            id: sessionId,
            userId: principal.userId,
            sessionId,
            addedAt: new Date().toISOString()
        });
        return { status: 200, jsonBody: { sessionId, added: true } };
    } catch (err) {
        context.error("addFavorite failed:", err);
        return { status: 500, jsonBody: { error: "Failed to add favorite" } };
    }
}

// DELETE /api/favorites/{sessionId} — remove a favorite
async function removeFavorite(request, context) {
    const principal = getClientPrincipal(request);
    if (!principal) return unauthorized();

    const sessionId = request.params.sessionId;
    if (!sessionId) {
        return { status: 400, jsonBody: { error: "Invalid sessionId" } };
    }

    try {
        const container = getContainer();
        await container.item(sessionId, principal.userId).delete();
        return { status: 204 };
    } catch (err) {
        // 404 from Cosmos when the doc never existed — treat as success
        if (err && err.code === 404) {
            return { status: 204 };
        }
        context.error("removeFavorite failed:", err);
        return { status: 500, jsonBody: { error: "Failed to remove favorite" } };
    }
}

// POST /api/favorites/merge — bulk upsert (for anon -> signed-in handoff)
async function mergeFavorites(request, context) {
    const principal = getClientPrincipal(request);
    if (!principal) return unauthorized();

    let body;
    try {
        body = await request.json();
    } catch (_) {
        return { status: 400, jsonBody: { error: "Invalid JSON body" } };
    }
    const incoming = Array.isArray(body && body.sessionIds) ? body.sessionIds : null;
    if (!incoming) {
        return { status: 400, jsonBody: { error: "sessionIds array is required" } };
    }
    // Defensive cap so a malicious client can't blow up the partition.
    if (incoming.length > 500) {
        return { status: 400, jsonBody: { error: "Too many sessionIds (max 500)" } };
    }

    try {
        const container = getContainer();
        const now = new Date().toISOString();
        // Fire-and-await in parallel; Cosmos serverless handles small bursts fine.
        await Promise.all(incoming
            .filter(id => typeof id === "string" && id.length > 0 && id.length <= 200)
            .map(id => container.items.upsert({
                id,
                userId: principal.userId,
                sessionId: id,
                addedAt: now
            }))
        );
        return { status: 200, jsonBody: { merged: incoming.length } };
    } catch (err) {
        context.error("mergeFavorites failed:", err);
        return { status: 500, jsonBody: { error: "Failed to merge favorites" } };
    }
}

app.http("favorites-list", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "favorites",
    handler: listFavorites
});

app.http("favorites-add", {
    methods: ["PUT"],
    authLevel: "anonymous",
    route: "favorites/{sessionId}",
    handler: addFavorite
});

app.http("favorites-remove", {
    methods: ["DELETE"],
    authLevel: "anonymous",
    route: "favorites/{sessionId}",
    handler: removeFavorite
});

app.http("favorites-merge", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "favorites/merge",
    handler: mergeFavorites
});
