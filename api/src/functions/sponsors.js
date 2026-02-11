const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const { ManagedIdentityCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("crypto");
const cache = require("../shared/cache");

const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT || process.env.STORAGE_ACCOUNT_NAME || "azcorestorage2026";
const clientId = process.env.AZURE_CLIENT_ID;
const tableName = "Sponsors";
const logosContainer = "sponsorlogos";

function getCredential() {
    return clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
}

function getTableClient() {
    const credential = getCredential();
    const url = `https://${storageAccountName}.table.core.windows.net`;
    return new TableClient(url, tableName, credential);
}

function getBlobServiceClient() {
    const credential = getCredential();
    const url = `https://${storageAccountName}.blob.core.windows.net`;
    return new BlobServiceClient(url, credential);
}

// Generate a URL-safe sponsor ID from name
function generateSponsorId(name) {
    const slug = name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
    const random = crypto.randomBytes(2).toString("hex");
    return `${slug}-${random}`;
}

// GET /api/sponsors - Get all sponsors
async function getSponsors(request, context) {
    try {
        // Check cache first
        const cached = cache.get('sponsors:all');
        if (cached) {
            return {
                status: 200,
                headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
                jsonBody: cached
            };
        }

        const client = getTableClient();
        const sponsors = [];

        for await (const entity of client.listEntities()) {
            sponsors.push({
                id: entity.rowKey,
                name: entity.name,
                logoFile: entity.logoFile || '',
                tier: entity.tier || 'silver',
                website: entity.website || '',
                description: entity.description || '',
                sortOrder: entity.sortOrder ? parseInt(entity.sortOrder) : 999,
                enabled: entity.enabled !== false && entity.enabled !== 'false'
            });
        }

        // Sort by tier priority then sortOrder then name
        const tierOrder = { platinum: 0, gold: 1, silver: 2, bronze: 3, community: 4 };
        sponsors.sort((a, b) => {
            const tierDiff = (tierOrder[a.tier] || 99) - (tierOrder[b.tier] || 99);
            if (tierDiff !== 0) return tierDiff;
            const orderDiff = a.sortOrder - b.sortOrder;
            if (orderDiff !== 0) return orderDiff;
            return a.name.localeCompare(b.name);
        });

        const body = { sponsors };
        cache.set('sponsors:all', body);

        return {
            status: 200,
            headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
            jsonBody: body
        };
    } catch (error) {
        context.log("Error fetching sponsors:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch sponsors", details: error.message }
        };
    }
}

// GET /api/sponsors/{id} - Get single sponsor
async function getSponsor(request, context) {
    try {
        const id = request.params.id;

        // Guard against sub-route names that should be handled by their own endpoints
        const reservedRoutes = ['logos', 'logo'];
        if (reservedRoutes.includes(id)) {
            return { status: 404, jsonBody: { error: "Sponsor not found" } };
        }

        // Check cache first
        const cacheKey = `sponsors:${id}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return {
                status: 200,
                headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
                jsonBody: cached
            };
        }

        const client = getTableClient();

        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                const body = {
                    id: entity.rowKey,
                    name: entity.name,
                    logoFile: entity.logoFile || '',
                    tier: entity.tier || 'silver',
                    website: entity.website || '',
                    description: entity.description || '',
                    sortOrder: entity.sortOrder ? parseInt(entity.sortOrder) : 999,
                    enabled: entity.enabled !== false && entity.enabled !== 'false'
                };
                cache.set(cacheKey, body);
                return {
                    status: 200,
                    headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
                    jsonBody: body
                };
            }
        }

        return {
            status: 404,
            jsonBody: { error: "Sponsor not found" }
        };
    } catch (error) {
        context.log("Error fetching sponsor:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch sponsor", details: error.message }
        };
    }
}

// POST /api/sponsors - Add a new sponsor
async function addSponsor(request, context) {
    try {
        const body = await request.json();
        const client = getTableClient();

        const sponsorId = generateSponsorId(body.name);

        const entity = {
            partitionKey: "sponsor",
            rowKey: sponsorId,
            name: body.name,
            logoFile: body.logoFile || '',
            tier: body.tier || 'silver',
            website: body.website || '',
            description: body.description || '',
            sortOrder: (body.sortOrder || 999).toString(),
            enabled: (body.enabled !== false).toString()
        };

        await client.createEntity(entity);
        cache.invalidate('sponsors');

        return {
            status: 201,
            jsonBody: {
                message: "Sponsor created",
                id: sponsorId,
                name: body.name,
                logoFile: body.logoFile || '',
                tier: body.tier || 'silver',
                website: body.website || '',
                description: body.description || '',
                sortOrder: body.sortOrder || 999,
                enabled: body.enabled !== false
            }
        };
    } catch (error) {
        context.log("Error creating sponsor:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to create sponsor", details: error.message }
        };
    }
}

// PUT /api/sponsors/{id} - Update a sponsor
async function updateSponsor(request, context) {
    try {
        const id = request.params.id;
        const body = await request.json();
        const client = getTableClient();

        // Find existing entity
        let existingEntity = null;
        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                existingEntity = entity;
                break;
            }
        }

        if (!existingEntity) {
            return {
                status: 404,
                jsonBody: { error: "Sponsor not found" }
            };
        }

        const updatedEntity = {
            partitionKey: existingEntity.partitionKey,
            rowKey: id,
            name: body.name || existingEntity.name,
            logoFile: body.logoFile !== undefined ? body.logoFile : existingEntity.logoFile,
            tier: body.tier !== undefined ? body.tier : existingEntity.tier,
            website: body.website !== undefined ? body.website : existingEntity.website,
            description: body.description !== undefined ? body.description : existingEntity.description,
            sortOrder: (body.sortOrder !== undefined ? body.sortOrder : existingEntity.sortOrder).toString(),
            enabled: (body.enabled !== undefined ? body.enabled : existingEntity.enabled).toString()
        };

        await client.updateEntity(updatedEntity, "Replace");
        cache.invalidate('sponsors');

        return {
            status: 200,
            jsonBody: {
                message: "Sponsor updated",
                id: id,
                name: updatedEntity.name,
                logoFile: updatedEntity.logoFile,
                tier: updatedEntity.tier,
                website: updatedEntity.website,
                description: updatedEntity.description,
                sortOrder: parseInt(updatedEntity.sortOrder),
                enabled: updatedEntity.enabled === 'true'
            }
        };
    } catch (error) {
        context.log("Error updating sponsor:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to update sponsor", details: error.message }
        };
    }
}

// DELETE /api/sponsors/{id} - Delete a sponsor
async function deleteSponsor(request, context) {
    try {
        const id = request.params.id;
        const client = getTableClient();

        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                await client.deleteEntity(entity.partitionKey, entity.rowKey);
                cache.invalidate('sponsors');
                return {
                    status: 200,
                    jsonBody: { message: "Sponsor deleted", id: id }
                };
            }
        }

        return {
            status: 404,
            jsonBody: { error: "Sponsor not found" }
        };
    } catch (error) {
        context.log("Error deleting sponsor:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to delete sponsor", details: error.message }
        };
    }
}

// POST /api/sponsors/logo - Upload a sponsor logo
async function uploadLogo(request, context) {
    try {
        const contentType = request.headers.get('content-type') || '';

        if (!contentType.includes('multipart/form-data')) {
            return {
                status: 400,
                jsonBody: { error: "Content-Type must be multipart/form-data" }
            };
        }

        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return {
                status: 400,
                jsonBody: { error: "No file provided" }
            };
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
        if (!allowedTypes.includes(file.type)) {
            return {
                status: 400,
                jsonBody: { error: "Invalid file type. Allowed: JPEG, PNG, WebP, SVG" }
            };
        }

        // Validate file size (10MB max)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            return {
                status: 400,
                jsonBody: { error: "File too large. Maximum size: 10MB" }
            };
        }

        // Sanitize filename
        const originalName = file.name || 'logo.png';
        const safeName = originalName
            .toLowerCase()
            .replace(/[^a-z0-9.-]/g, '-')
            .replace(/-+/g, '-');

        // Upload to blob storage
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(logosContainer);
        const blockBlobClient = containerClient.getBlockBlobClient(safeName);

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await blockBlobClient.uploadData(buffer, {
            blobHTTPHeaders: {
                blobContentType: file.type
            }
        });

        const url = `https://${storageAccountName}.blob.core.windows.net/${logosContainer}/${safeName}`;

        return {
            status: 201,
            jsonBody: {
                message: "Logo uploaded successfully",
                filename: safeName,
                url: url,
                size: file.size,
                contentType: file.type
            }
        };
    } catch (error) {
        context.log("Error uploading logo:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to upload logo", details: error.message }
        };
    }
}

// GET /api/sponsors/logos - List all logo images
async function listLogos(request, context) {
    try {
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(logosContainer);

        const logos = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            logos.push({
                name: blob.name,
                size: blob.properties.contentLength,
                contentType: blob.properties.contentType,
                lastModified: blob.properties.lastModified
            });
        }

        logos.sort((a, b) => a.name.localeCompare(b.name));

        return {
            status: 200,
            jsonBody: { logos }
        };
    } catch (error) {
        context.log("Error listing logos:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to list logos", details: error.message }
        };
    }
}

// Register routes
app.http("getSponsors", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "sponsors",
    handler: getSponsors
});

// Specific sub-routes MUST be registered before the parameterized {id} route
app.http("listSponsorLogos", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "sponsors/logos",
    handler: listLogos
});

app.http("uploadSponsorLogo", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "sponsors/logo",
    handler: uploadLogo
});

app.http("getSponsor", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "sponsors/{id}",
    handler: getSponsor
});

app.http("addSponsor", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "sponsors",
    handler: addSponsor
});

app.http("updateSponsor", {
    methods: ["PUT"],
    authLevel: "anonymous",
    route: "sponsors/{id}",
    handler: updateSponsor
});

app.http("deleteSponsor", {
    methods: ["DELETE"],
    authLevel: "anonymous",
    route: "sponsors/{id}",
    handler: deleteSponsor
});

module.exports = {
    getSponsors,
    getSponsor,
    addSponsor,
    updateSponsor,
    deleteSponsor,
    uploadLogo,
    listLogos
};
