const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const { ManagedIdentityCredential } = require("@azure/identity");
const cache = require("../shared/cache");

const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT || process.env.STORAGE_ACCOUNT_NAME;
const clientId = process.env.AZURE_CLIENT_ID;
const contentContainer = "sitecontent";
const blobName = "branding-config.json";

function getCredential() {
    return clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
}

function getBlobServiceClient() {
    const credential = getCredential();
    const url = `https://${storageAccountName}.blob.core.windows.net`;
    return new BlobServiceClient(url, credential);
}

const defaultConfig = {
    eventName: "Community Online Event",
    tagLine: "A community-driven online event bringing people together.",
    logo: "/assets/event-logo.png",
    primaryColor: "#0078D4",
    secondaryColor: "#50E6FF",
    accentColor: "#FFB900",
    hideSponsors: false,
    eventStartDate: "",
    eventEndDate: ""
};

// GET /api/branding - Get branding config
async function getBranding(request, context) {
    const cacheKey = "branding:config";
    const cached = cache.get(cacheKey);
    if (cached) {
        return {
            status: 200,
            headers: { "Cache-Control": cache.CACHE_CONTROL_PUBLIC },
            jsonBody: cached
        };
    }

    try {
        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(contentContainer);
        const blobClient = containerClient.getBlobClient(blobName);

        const exists = await blobClient.exists();
        if (!exists) {
            const body = { ...defaultConfig, isDefault: true };
            cache.set(cacheKey, body);
            return {
                status: 200,
                headers: { "Cache-Control": cache.CACHE_CONTROL_PUBLIC },
                jsonBody: body
            };
        }

        const downloadResponse = await blobClient.download();
        const content = await streamToString(downloadResponse.readableStreamBody);
        const config = JSON.parse(content);
        const body = { ...defaultConfig, ...config, isDefault: false };
        cache.set(cacheKey, body);

        return {
            status: 200,
            headers: { "Cache-Control": cache.CACHE_CONTROL_PUBLIC },
            jsonBody: body
        };
    } catch (error) {
        context.log("Error fetching branding config:", error);
        if (error.statusCode === 404) {
            const body = { ...defaultConfig, isDefault: true };
            cache.set(cacheKey, body);
            return {
                status: 200,
                headers: { "Cache-Control": cache.CACHE_CONTROL_PUBLIC },
                jsonBody: body
            };
        }
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch branding config", details: error.message }
        };
    }
}

// PUT /api/branding - Save branding config
async function saveBranding(request, context) {
    try {
        const body = await request.json();

        const config = {
            eventName: (body.eventName || defaultConfig.eventName).trim(),
            tagLine: (body.tagLine || defaultConfig.tagLine).trim(),
            logo: body.logo || defaultConfig.logo,
            primaryColor: body.primaryColor || defaultConfig.primaryColor,
            secondaryColor: body.secondaryColor || defaultConfig.secondaryColor,
            accentColor: body.accentColor || defaultConfig.accentColor,
            hideSponsors: !!body.hideSponsors,
            eventStartDate: (body.eventStartDate || "").trim(),
            eventEndDate: (body.eventEndDate || "").trim()
        };

        const blobServiceClient = getBlobServiceClient();
        const containerClient = blobServiceClient.getContainerClient(contentContainer);

        try {
            await containerClient.createIfNotExists();
        } catch (containerErr) {
            context.log("Container may already exist:", containerErr.message);
        }

        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        const content = JSON.stringify(config, null, 2);
        const contentBuffer = Buffer.from(content, "utf-8");
        await blockBlobClient.uploadData(contentBuffer, {
            blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
            overwrite: true
        });

        cache.invalidate("branding");
        context.log("Branding config saved successfully");

        return {
            status: 200,
            jsonBody: { success: true, message: "Branding config saved", ...config }
        };
    } catch (error) {
        context.log("Error saving branding config:", error.message);
        context.log("Error details:", error.stack);
        return {
            status: 500,
            jsonBody: { error: "Failed to save branding config", details: error.message }
        };
    }
}

// Helper function to convert stream to string
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => chunks.push(data.toString()));
        readableStream.on("end", () => resolve(chunks.join("")));
        readableStream.on("error", reject);
    });
}

// Register routes
app.http("getBranding", {
    methods: ["GET"],
    route: "branding",
    authLevel: "anonymous",
    handler: getBranding
});

app.http("saveBranding", {
    methods: ["PUT"],
    route: "branding",
    authLevel: "anonymous",
    handler: saveBranding
});
