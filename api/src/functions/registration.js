const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const { ManagedIdentityCredential } = require("@azure/identity");
const cache = require("../shared/cache");

const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT || process.env.STORAGE_ACCOUNT_NAME;
const clientId = process.env.AZURE_CLIENT_ID;
const contentContainer = "sitecontent";
const blobName = "registration-config.json";

function getCredential() {
    return clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
}

function getBlobServiceClient() {
    const credential = getCredential();
    const url = `https://${storageAccountName}.blob.core.windows.net`;
    return new BlobServiceClient(url, credential);
}

const defaultConfig = {
    enabled: false,
    registrationUrl: "",
    title: "Register Now",
    description: "Join us for this community event! Click the link below to register.",
    buttonText: "Register"
};

// GET /api/registration - Get registration config
async function getRegistration(request, context) {
    const cacheKey = "registration:config";
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
        context.log("Error fetching registration config:", error);
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
            jsonBody: { error: "Failed to fetch registration config", details: error.message }
        };
    }
}

// PUT /api/registration - Save registration config
async function saveRegistration(request, context) {
    try {
        const body = await request.json();

        const config = {
            enabled: !!body.enabled,
            registrationUrl: (body.registrationUrl || "").trim(),
            title: (body.title || defaultConfig.title).trim(),
            description: (body.description !== undefined && body.description !== null ? body.description : defaultConfig.description).trim(),
            buttonText: (body.buttonText || defaultConfig.buttonText).trim()
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

        cache.invalidate("registration");
        context.log("Registration config saved successfully");

        return {
            status: 200,
            jsonBody: { success: true, message: "Registration config saved", ...config }
        };
    } catch (error) {
        context.log("Error saving registration config:", error.message);
        context.log("Error details:", error.stack);
        return {
            status: 500,
            jsonBody: { error: "Failed to save registration config", details: error.message }
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
app.http("getRegistration", {
    methods: ["GET"],
    route: "registration",
    authLevel: "anonymous",
    handler: getRegistration
});

app.http("saveRegistration", {
    methods: ["PUT"],
    route: "registration",
    authLevel: "anonymous",
    handler: saveRegistration
});
