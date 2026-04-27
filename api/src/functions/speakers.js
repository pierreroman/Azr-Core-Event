const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const { ManagedIdentityCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("crypto");
const cache = require("../shared/cache");

const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT || process.env.STORAGE_ACCOUNT_NAME;
const clientId = process.env.AZURE_CLIENT_ID;
const tableName = "Speakers";
const headshotsContainer = "speakerheadshots";

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

// Generate a URL-safe speaker ID from name
function generateSpeakerId(name) {
    const slug = name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
    const random = crypto.randomBytes(2).toString("hex"); // 4 cryptographically secure hex chars
    return `${slug}-${random}`;
}

// GET /api/speakers - Get all speakers
async function getSpeakers(request, context) {
    try {
        // Check cache first
        const cached = cache.get('speakers:all');
        if (cached) {
            return {
                status: 200,
                headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
                jsonBody: cached
            };
        }

        const client = getTableClient();
        const speakers = [];
        
        for await (const entity of client.listEntities()) {
            speakers.push({
                id: entity.rowKey,
                name: entity.name,
                title: entity.title || '',
                company: entity.company || '',
                bio: entity.bio || '',
                headshotFile: entity.headshotFile || '', // Filename in blob storage speakerheadshots container
                linkedin: entity.linkedin || '',
                twitter: entity.twitter || '',
                sessionIds: entity.sessionIds ? JSON.parse(entity.sessionIds) : []
            });
        }
        
        // Sort by name
        speakers.sort((a, b) => a.name.localeCompare(b.name));

        const body = {
            speakers,
            storageBaseUrl: `/api/speakers/image`
        };
        cache.set('speakers:all', body);
        
        return {
            status: 200,
            headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
            jsonBody: body
        };
    } catch (error) {
        context.log("Error fetching speakers:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch speakers", details: error.message }
        };
    }
}

// GET /api/speakers/{id} - Get single speaker
async function getSpeaker(request, context) {
    try {
        const id = request.params.id;

        // Guard against sub-route names that should be handled by their own endpoints
        const reservedRoutes = ['headshots', 'headshot', 'extract'];
        if (reservedRoutes.includes(id)) {
            return { status: 404, jsonBody: { error: "Speaker not found" } };
        }

        // Check cache first
        const cacheKey = `speakers:${id}`;
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
                    title: entity.title || '',
                    company: entity.company || '',
                    bio: entity.bio || '',
                    headshotFile: entity.headshotFile || '',
                    linkedin: entity.linkedin || '',
                    twitter: entity.twitter || '',
                    sessionIds: entity.sessionIds ? JSON.parse(entity.sessionIds) : []
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
            jsonBody: { error: "Speaker not found" }
        };
    } catch (error) {
        context.log("Error fetching speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch speaker", details: error.message }
        };
    }
}

// POST /api/speakers - Add a new speaker
async function addSpeaker(request, context) {
    try {
        const body = await request.json();
        const client = getTableClient();
        
        const speakerId = generateSpeakerId(body.name);
        
        const entity = {
            partitionKey: "speaker",
            rowKey: speakerId,
            name: body.name,
            title: body.title || '',
            company: body.company || '',
            bio: body.bio || '',
            headshotFile: body.headshotFile || '', // e.g., "rick-claus.jpg"
            linkedin: body.linkedin || '',
            twitter: body.twitter || '',
            sessionIds: JSON.stringify(body.sessionIds || [])
        };
        
        await client.createEntity(entity);
        cache.invalidate('speakers');
        
        return {
            status: 201,
            jsonBody: {
                message: "Speaker created",
                id: speakerId,
                name: body.name,
                title: body.title || '',
                company: body.company || '',
                bio: body.bio || '',
                headshotFile: body.headshotFile || '',
                linkedin: body.linkedin || '',
                twitter: body.twitter || '',
                sessionIds: body.sessionIds || []
            }
        };
    } catch (error) {
        context.log("Error creating speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to create speaker", details: error.message }
        };
    }
}

// PUT /api/speakers/{id} - Update a speaker
async function updateSpeaker(request, context) {
    try {
        const id = request.params.id;
        const body = await request.json();
        const client = getTableClient();
        
        // Find the existing entity
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
                jsonBody: { error: "Speaker not found" }
            };
        }
        
        const updatedEntity = {
            partitionKey: existingEntity.partitionKey,
            rowKey: id,
            name: body.name || existingEntity.name,
            title: body.title !== undefined ? body.title : existingEntity.title,
            company: body.company !== undefined ? body.company : existingEntity.company,
            bio: body.bio !== undefined ? body.bio : existingEntity.bio,
            headshotFile: body.headshotFile !== undefined ? body.headshotFile : existingEntity.headshotFile,
            linkedin: body.linkedin !== undefined ? body.linkedin : existingEntity.linkedin,
            twitter: body.twitter !== undefined ? body.twitter : existingEntity.twitter,
            sessionIds: body.sessionIds ? JSON.stringify(body.sessionIds) : existingEntity.sessionIds
        };
        
        await client.updateEntity(updatedEntity, "Replace");
        cache.invalidate('speakers');
        
        return {
            status: 200,
            jsonBody: {
                message: "Speaker updated",
                id: id,
                name: updatedEntity.name,
                title: updatedEntity.title,
                company: updatedEntity.company,
                bio: updatedEntity.bio,
                headshotFile: updatedEntity.headshotFile,
                linkedin: updatedEntity.linkedin,
                twitter: updatedEntity.twitter,
                sessionIds: JSON.parse(updatedEntity.sessionIds || '[]')
            }
        };
    } catch (error) {
        context.log("Error updating speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to update speaker", details: error.message }
        };
    }
}

// DELETE /api/speakers/{id} - Delete a speaker
async function deleteSpeaker(request, context) {
    try {
        const id = request.params.id;
        const client = getTableClient();
        
        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                await client.deleteEntity(entity.partitionKey, entity.rowKey);
                cache.invalidate('speakers');
                return {
                    status: 200,
                    jsonBody: { message: "Speaker deleted", id: id }
                };
            }
        }
        
        return {
            status: 404,
            jsonBody: { error: "Speaker not found" }
        };
    } catch (error) {
        context.log("Error deleting speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to delete speaker", details: error.message }
        };
    }
}

// POST /api/speakers/extract - Extract speakers from schedule descriptions
async function extractSpeakers(request, context) {
    try {
        const credential = getCredential();
        const scheduleClient = new TableClient(
            `https://${storageAccountName}.table.core.windows.net`,
            "VideoSchedule",
            credential
        );
        
        const speakerClient = getTableClient();
        
        // Get existing speakers
        const existingSpeakers = new Map();
        for await (const entity of speakerClient.listEntities()) {
            existingSpeakers.set(entity.name.toLowerCase(), entity);
        }
        
        // Extract speakers from schedule
        const extractedSpeakers = new Map();
        const speakerSessions = new Map();
        
        for await (const session of scheduleClient.listEntities()) {
            const description = session.description || '';
            
            // Look for "Speaker:" or "Speakers:" patterns
            const speakerMatches = description.match(/Speakers?:\s*([^\n]+(?:\n(?![A-Z#✅📅⁉️])[^\n]+)*)/gi);
            
            if (speakerMatches) {
                for (const match of speakerMatches) {
                    const namesSection = match.replace(/Speakers?:\s*/i, '').trim();
                    
                    // Split by common delimiters
                    const names = namesSection
                        .split(/[,\n]/)
                        .map(n => n.trim())
                        .filter(n => n && n.length > 2 && !n.includes('http') && !n.includes('@'));
                    
                    for (const name of names) {
                        // Clean up the name:
                        // 1. Strip leading bullet/list markers: -, –, —, •, *, ·, ●, ○,
                        //    ▪, ▫, ►, ▶, →, »,  ., …, and numbered "1." / "1)" forms
                        //    (repeated in case the source uses "- • Name").
                        // 2. Strip leading numeric markers: "1.", "1)", "(1)"
                        // 3. Drop anything after a separating dash (title/role)
                        // 4. Drop trailing parenthesised qualifiers
                        const cleanName = name
                            .replace(/^[\s\-\u2010-\u2015\u2022\u00B7\u25CF\u25CB\u25AA\u25AB\u25BA\u25B6\u2192\u00BB\.\u2026*]+/, '')
                            .replace(/^\(?\d+[\.\)]\s*/, '')
                            .replace(/^[\s\-\u2010-\u2015\u2022\u00B7\u25CF\u25CB\u25AA\u25AB\u25BA\u25B6\u2192\u00BB\.\u2026*]+/, '')
                            .replace(/\s*[-\u2013\u2014]\s*.*$/, '')
                            .replace(/\s*\(.*\)/, '')
                            .trim();
                        
                        if (cleanName && cleanName.length > 2 && cleanName.split(' ').length <= 4) {
                            const lowerName = cleanName.toLowerCase();
                            
                            if (!extractedSpeakers.has(lowerName)) {
                                extractedSpeakers.set(lowerName, cleanName);
                                speakerSessions.set(lowerName, []);
                            }
                            
                            speakerSessions.get(lowerName).push(session.rowKey);
                        }
                    }
                }
            }
        }
        
        // Create/update speakers
        const results = { created: 0, updated: 0, speakers: [] };
        
        for (const [lowerName, displayName] of extractedSpeakers) {
            const sessionIds = speakerSessions.get(lowerName) || [];
            
            if (existingSpeakers.has(lowerName)) {
                const existing = existingSpeakers.get(lowerName);
                const existingSessionIds = existing.sessionIds ? JSON.parse(existing.sessionIds) : [];
                const mergedSessionIds = [...new Set([...existingSessionIds, ...sessionIds])];
                
                existing.sessionIds = JSON.stringify(mergedSessionIds);
                await speakerClient.updateEntity(existing, "Replace");
                results.updated++;
                results.speakers.push({ name: displayName, action: 'updated', sessions: mergedSessionIds.length });
            } else {
                const speakerId = generateSpeakerId(displayName);
                const entity = {
                    partitionKey: "speaker",
                    rowKey: speakerId,
                    name: displayName,
                    title: '',
                    company: '',
                    bio: '',
                    headshotFile: '',
                    linkedin: '',
                    twitter: '',
                    sessionIds: JSON.stringify(sessionIds)
                };
                
                await speakerClient.createEntity(entity);
                results.created++;
                results.speakers.push({ name: displayName, action: 'created', sessions: sessionIds.length });
            }
        }
        
        cache.invalidate('speakers');

        return {
            status: 200,
            jsonBody: {
                message: "Speaker extraction completed",
                created: results.created,
                updated: results.updated,
                speakers: results.speakers
            }
        };
    } catch (error) {
        context.log("Error extracting speakers:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to extract speakers", details: error.message }
        };
    }
}

// GET /api/speakers/headshots - List all headshot images
async function listHeadshots(request, context) {
    try {
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(headshotsContainer);
        
        const headshots = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            headshots.push({
                name: blob.name,
                size: blob.properties.contentLength,
                contentType: blob.properties.contentType,
                lastModified: blob.properties.lastModified
            });
        }
        
        // Sort by name
        headshots.sort((a, b) => a.name.localeCompare(b.name));
        
        return {
            status: 200,
            jsonBody: { headshots }
        };
    } catch (error) {
        context.log("Error listing headshots:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to list headshots", details: error.message }
        };
    }
}

// POST /api/speakers/headshot - Upload a headshot image
async function uploadHeadshot(request, context) {
    try {
        const contentType = request.headers.get('content-type') || '';
        
        if (!contentType.includes('multipart/form-data')) {
            return {
                status: 400,
                jsonBody: { error: "Content-Type must be multipart/form-data" }
            };
        }
        
        // Parse multipart form data
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file) {
            return {
                status: 400,
                jsonBody: { error: "No file provided" }
            };
        }
        
        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return {
                status: 400,
                jsonBody: { error: "Invalid file type. Allowed: JPEG, PNG, WebP" }
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
        const originalName = file.name || 'headshot.jpg';
        const safeName = originalName
            .toLowerCase()
            .replace(/[^a-z0-9.-]/g, '-')
            .replace(/-+/g, '-');
        
        // Upload to blob storage
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(headshotsContainer);
        const blockBlobClient = containerClient.getBlockBlobClient(safeName);
        
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        await blockBlobClient.uploadData(buffer, {
            blobHTTPHeaders: {
                blobContentType: file.type
            }
        });
        
        const url = `/api/speakers/image/${safeName}`;
        
        return {
            status: 201,
            jsonBody: {
                message: "Headshot uploaded successfully",
                filename: safeName,
                url: url,
                size: file.size,
                contentType: file.type
            }
        };
    } catch (error) {
        context.log("Error uploading headshot:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to upload headshot", details: error.message }
        };
    }
}

// GET /api/speakers/image/{filename} - Proxy speaker headshot from private blob storage
async function proxyImage(request, context) {
    try {
        const filename = request.params.filename;
        if (!filename) {
            return { status: 400, jsonBody: { error: "Filename is required" } };
        }

        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(headshotsContainer);
        const blobClient = containerClient.getBlobClient(filename);

        const downloadResponse = await blobClient.download(0);

        return {
            status: 200,
            headers: {
                'Content-Type': downloadResponse.contentType || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400',
            },
            body: downloadResponse.readableStreamBody
        };
    } catch (error) {
        if (error.statusCode === 404) {
            return { status: 404, jsonBody: { error: "Image not found" } };
        }
        context.log("Error proxying headshot:", error);
        return { status: 500, jsonBody: { error: "Failed to load image" } };
    }
}

// Register routes
app.http("getSpeakers", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "speakers",
    handler: getSpeakers
});

// Specific sub-routes MUST be registered before the parameterized {id} route
app.http("extractSpeakers", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "speakers/extract",
    handler: extractSpeakers
});

app.http("listHeadshots", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "speakers/headshots",
    handler: listHeadshots
});

app.http("proxyHeadshot", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "speakers/image/{filename}",
    handler: proxyImage
});

app.http("uploadHeadshot", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "speakers/headshot",
    handler: uploadHeadshot
});

app.http("getSpeaker", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "speakers/{id}",
    handler: getSpeaker
});

app.http("addSpeaker", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "speakers",
    handler: addSpeaker
});

app.http("updateSpeaker", {
    methods: ["PUT"],
    authLevel: "anonymous",
    route: "speakers/{id}",
    handler: updateSpeaker
});

app.http("deleteSpeaker", {
    methods: ["DELETE"],
    authLevel: "anonymous",
    route: "speakers/{id}",
    handler: deleteSpeaker
});

module.exports = {
    getSpeakers,
    getSpeaker,
    addSpeaker,
    updateSpeaker,
    deleteSpeaker,
    extractSpeakers,
    listHeadshots,
    uploadHeadshot,
    proxyImage
};
