const { ManagedIdentityCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");

module.exports = async function (context, req) {
    const storageAccountName = process.env.STORAGE_ACCOUNT_NAME;
    const containerName = process.env.STORAGE_CONTAINER_NAME || "schedules";
    const blobName = process.env.STORAGE_BLOB_NAME || "video-schedule.json";

    if (!storageAccountName) {
        context.res = {
            status: 500,
            headers: { "Content-Type": "application/json" },
            body: { error: "Configuration error", message: "STORAGE_ACCOUNT_NAME not configured" }
        };
        return;
    }

    try {
        // Use ManagedIdentityCredential for SWA
        const credential = new ManagedIdentityCredential();
        
        // Create blob service client using managed identity
        const blobServiceClient = new BlobServiceClient(
            `https://${storageAccountName}.blob.core.windows.net`,
            credential
        );

        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blobClient = containerClient.getBlockBlobClient(blobName);

        if (req.method === "GET") {
            await handleGet(context, blobClient);
        } else if (req.method === "POST") {
            await handlePost(context, req, blobClient);
        }
    } catch (error) {
        context.log.error("Authentication error:", error.message);
        context.res = {
            status: 500,
            headers: { "Content-Type": "application/json" },
            body: { error: "Authentication failed", message: error.message }
        };
    }
};

async function handleGet(context, blobClient) {
    try {
        // Download blob content
        const downloadResponse = await blobClient.download(0);
        const content = await streamToString(downloadResponse.readableStreamBody);
        const schedule = JSON.parse(content);

        context.res = {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-cache"
            },
            body: schedule
        };
    } catch (error) {
        context.log.error("Error fetching schedule from Azure Storage:", error.message);
        
        context.res = {
            status: 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                error: "Failed to fetch schedule",
                message: error.message
            }
        };
    }
}

async function handlePost(context, req, blobClient) {
    try {
        const scheduleData = req.body;
        
        if (!scheduleData || !scheduleData.schedule) {
            context.res = {
                status: 400,
                headers: { "Content-Type": "application/json" },
                body: { error: "Invalid schedule data", message: "Request body must contain a schedule array" }
            };
            return;
        }

        // Convert to JSON string
        const content = JSON.stringify(scheduleData, null, 2);
        
        // Upload to blob storage
        await blobClient.upload(content, content.length, {
            blobHTTPHeaders: { blobContentType: "application/json" },
            overwrite: true
        });

        context.log("Schedule saved successfully to Azure Storage");

        context.res = {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: { success: true, message: "Schedule saved successfully" }
        };
    } catch (error) {
        context.log.error("Error saving schedule to Azure Storage:", error.message);
        
        context.res = {
            status: 500,
            headers: { "Content-Type": "application/json" },
            body: {
                error: "Failed to save schedule",
                message: error.message
            }
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
