const { DefaultAzureCredential } = require("@azure/identity");
const { BlobServiceClient } = require("@azure/storage-blob");

module.exports = async function (context, req) {
    try {
        // Configure these values - update with your actual storage account details
        const storageAccountName = process.env.STORAGE_ACCOUNT_NAME || "YOUR_STORAGE_ACCOUNT_NAME";
        const containerName = process.env.STORAGE_CONTAINER_NAME || "schedules";
        const blobName = process.env.STORAGE_BLOB_NAME || "video-schedule.json";

        // Use DefaultAzureCredential which will use the managed identity in Azure
        const credential = new DefaultAzureCredential();
        
        // Create blob service client using managed identity
        const blobServiceClient = new BlobServiceClient(
            `https://${storageAccountName}.blob.core.windows.net`,
            credential
        );

        // Get container and blob client
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blobClient = containerClient.getBlobClient(blobName);

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
};

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
