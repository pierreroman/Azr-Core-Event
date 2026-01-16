const { app } = require("@azure/functions");
const { ManagedIdentityCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");

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

// Get blob client using managed identity
function getBlobClient() {
    const storageAccountName = process.env.STORAGE_ACCOUNT_NAME;
    const containerName = process.env.STORAGE_CONTAINER_NAME || "schedules";
    const blobName = process.env.STORAGE_BLOB_NAME || "video-schedule.json";

    const credential = new ManagedIdentityCredential();
    const blobServiceClient = new BlobServiceClient(
        `https://${storageAccountName}.blob.core.windows.net`,
        credential
    );

    const containerClient = blobServiceClient.getContainerClient(containerName);
    return containerClient.getBlockBlobClient(blobName);
}

// GET - Fetch schedule
app.http("getSchedule", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "schedule",
    handler: async (request, context) => {
        try {
            const blobClient = getBlobClient();
            const downloadResponse = await blobClient.download(0);
            const content = await streamToString(downloadResponse.readableStreamBody);
            const schedule = JSON.parse(content);

            return {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache"
                },
                body: JSON.stringify(schedule)
            };
        } catch (error) {
            context.log("Error fetching schedule:", error.message);
            return {
                status: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to fetch schedule", message: error.message })
            };
        }
    }
});

// POST - Save schedule
app.http("saveSchedule", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "schedule",
    handler: async (request, context) => {
        try {
            const scheduleData = await request.json();
            
            if (!scheduleData || !scheduleData.schedule) {
                return {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Invalid schedule data", message: "Request body must contain a schedule array" })
                };
            }

            const blobClient = getBlobClient();
            const content = JSON.stringify(scheduleData, null, 2);
            
            await blobClient.upload(content, content.length, {
                blobHTTPHeaders: { blobContentType: "application/json" },
                overwrite: true
            });

            context.log("Schedule saved successfully");

            return {
                status: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ success: true, message: "Schedule saved successfully" })
            };
        } catch (error) {
            context.log("Error saving schedule:", error.message);
            return {
                status: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to save schedule", message: error.message })
            };
        }
    }
});
