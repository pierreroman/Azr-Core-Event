const { app } = require("@azure/functions");
const { ManagedIdentityCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");
const cache = require("../shared/cache");

const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT || process.env.STORAGE_ACCOUNT_NAME;
const clientId = process.env.AZURE_CLIENT_ID;
const contentContainer = "sitecontent";

function getCredential() {
    return clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
}

function getBlobServiceClient() {
    const credential = getCredential();
    const url = `https://${storageAccountName}.blob.core.windows.net`;
    return new BlobServiceClient(url, credential);
}

// Valid content types
const validContentTypes = ['code-of-conduct', 'about'];

// Default content (fallback if blob doesn't exist)
const defaultContent = {
    'code-of-conduct': `# Code of Conduct

This event is dedicated to providing a harassment-free conference experience for everyone.

## Expected Behavior

- **Be respectful and inclusive** - Treat all participants with respect
- **Exercise consideration and empathy** - Be mindful of others
- **Refrain from demeaning or harassing behavior** - Keep it professional

## Unacceptable Behavior

- Harassment, intimidation, or discrimination
- Offensive verbal comments
- Inappropriate use of sexual images or language
- Deliberate intimidation or stalking

## Reporting

If you experience or witness unacceptable behavior, please report it to the event organizers.

---

**Thank you for helping make this a welcoming event for all!**`,

    'about': `# About This Event

This is a **free, community-driven virtual event** bringing together passionate professionals.

## What to Expect

- Deep technical sessions on Azure infrastructure
- Expert speakers from the Azure community
- Live Q&A and interactive discussions
- Networking opportunities with peers

## Who Should Attend

- Cloud architects and engineers
- IT professionals working with Azure
- DevOps and platform engineers
- Anyone interested in Azure infrastructure

---

**Join us for a day of learning and community!**`
};

// GET /api/content/{type} - Get markdown content
async function getContent(request, context) {
    const contentType = request.params.type;
    
    if (!validContentTypes.includes(contentType)) {
        return {
            status: 400,
            jsonBody: { error: `Invalid content type. Valid types: ${validContentTypes.join(', ')}` }
        };
    }

    // Check cache first
    const cacheKey = `content:${contentType}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return {
            status: 200,
            headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
            jsonBody: cached
        };
    }
    
    try {
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(contentContainer);
        const blobName = `${contentType}.md`;
        const blobClient = containerClient.getBlobClient(blobName);
        
        // Check if blob exists
        const exists = await blobClient.exists();
        
        if (!exists) {
            // Return default content
            context.log(`Content blob ${blobName} not found, returning default`);
            const body = {
                type: contentType,
                content: defaultContent[contentType],
                isDefault: true,
                lastModified: null
            };
            cache.set(cacheKey, body);
            return {
                status: 200,
                headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
                jsonBody: body
            };
        }
        
        // Download blob content
        const downloadResponse = await blobClient.download();
        const content = await streamToString(downloadResponse.readableStreamBody);
        const properties = await blobClient.getProperties();

        const body = {
            type: contentType,
            content: content,
            isDefault: false,
            lastModified: properties.lastModified?.toISOString() || null
        };
        cache.set(cacheKey, body);
        
        return {
            status: 200,
            headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
            jsonBody: body
        };
    } catch (error) {
        context.log(`Error fetching content ${contentType}:`, error);
        
        // If container doesn't exist, return default
        if (error.statusCode === 404) {
            const body = {
                type: contentType,
                content: defaultContent[contentType],
                isDefault: true,
                lastModified: null
            };
            cache.set(cacheKey, body);
            return {
                status: 200,
                headers: { 'Cache-Control': cache.CACHE_CONTROL_PUBLIC },
                jsonBody: body
            };
        }
        
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch content", details: error.message }
        };
    }
}

// PUT /api/content/{type} - Save markdown content
async function saveContent(request, context) {
    const contentType = request.params.type;
    
    if (!validContentTypes.includes(contentType)) {
        return {
            status: 400,
            jsonBody: { error: `Invalid content type. Valid types: ${validContentTypes.join(', ')}` }
        };
    }
    
    try {
        const body = await request.json();
        
        if (!body.content || typeof body.content !== 'string') {
            return {
                status: 400,
                jsonBody: { error: "Content is required and must be a string" }
            };
        }
        
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(contentContainer);
        
        // Ensure container exists
        await containerClient.createIfNotExists({
            access: 'blob' // Public read access for blobs
        });
        
        const blobName = `${contentType}.md`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        
        // Upload content
        await blockBlobClient.upload(body.content, Buffer.byteLength(body.content), {
            blobHTTPHeaders: {
                blobContentType: 'text/markdown; charset=utf-8'
            },
            overwrite: true
        });
        
        cache.invalidate('content');
        context.log(`Content ${contentType} saved successfully`);
        
        return {
            status: 200,
            jsonBody: {
                success: true,
                type: contentType,
                message: `${contentType} content saved successfully`,
                lastModified: new Date().toISOString()
            }
        };
    } catch (error) {
        context.log(`Error saving content ${contentType}:`, error);
        return {
            status: 500,
            jsonBody: { error: "Failed to save content", details: error.message }
        };
    }
}

// DELETE /api/content/{type} - Reset to default (delete blob)
async function resetContent(request, context) {
    const contentType = request.params.type;
    
    if (!validContentTypes.includes(contentType)) {
        return {
            status: 400,
            jsonBody: { error: `Invalid content type. Valid types: ${validContentTypes.join(', ')}` }
        };
    }
    
    try {
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(contentContainer);
        const blobName = `${contentType}.md`;
        const blobClient = containerClient.getBlobClient(blobName);
        
        // Delete if exists
        await blobClient.deleteIfExists();
        cache.invalidate('content');
        
        context.log(`Content ${contentType} reset to default`);
        
        return {
            status: 200,
            jsonBody: {
                success: true,
                type: contentType,
                message: `${contentType} content reset to default`,
                content: defaultContent[contentType]
            }
        };
    } catch (error) {
        context.log(`Error resetting content ${contentType}:`, error);
        return {
            status: 500,
            jsonBody: { error: "Failed to reset content", details: error.message }
        };
    }
}

// Helper function to convert stream to string
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => {
            chunks.push(data.toString());
        });
        readableStream.on("end", () => {
            resolve(chunks.join(""));
        });
        readableStream.on("error", reject);
    });
}

// Register routes
app.http("getContent", {
    methods: ["GET"],
    route: "content/{type}",
    authLevel: "anonymous",
    handler: getContent
});

app.http("saveContent", {
    methods: ["PUT"],
    route: "content/{type}",
    authLevel: "anonymous",
    handler: saveContent
});

app.http("resetContent", {
    methods: ["DELETE"],
    route: "content/{type}",
    authLevel: "anonymous",
    handler: resetContent
});
