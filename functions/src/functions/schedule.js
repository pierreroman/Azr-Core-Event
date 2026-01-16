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

// Timezone offset mapping for common timezones
const timezoneOffsets = {
    "America/New_York": { standard: "-05:00", dst: "-04:00" },
    "America/Chicago": { standard: "-06:00", dst: "-05:00" },
    "America/Denver": { standard: "-07:00", dst: "-06:00" },
    "America/Los_Angeles": { standard: "-08:00", dst: "-07:00" },
    "America/Phoenix": { standard: "-07:00", dst: "-07:00" }, // No DST
    "America/Anchorage": { standard: "-09:00", dst: "-08:00" },
    "Pacific/Honolulu": { standard: "-10:00", dst: "-10:00" }, // No DST
    "Europe/London": { standard: "+00:00", dst: "+01:00" },
    "Europe/Paris": { standard: "+01:00", dst: "+02:00" },
    "Europe/Berlin": { standard: "+01:00", dst: "+02:00" },
    "Asia/Tokyo": { standard: "+09:00", dst: "+09:00" }, // No DST
    "Asia/Shanghai": { standard: "+08:00", dst: "+08:00" }, // No DST
    "Australia/Sydney": { standard: "+11:00", dst: "+10:00" },
    "UTC": { standard: "+00:00", dst: "+00:00" }
};

// Check if a date is in DST for a given timezone
function isDST(date, timezone) {
    // Simple DST check for US timezones (March-November)
    // For US: DST starts 2nd Sunday of March, ends 1st Sunday of November
    const month = date.getMonth(); // 0-11
    const day = date.getDate();
    const dayOfWeek = date.getDay(); // 0=Sunday
    
    if (timezone.startsWith("America/") && timezone !== "America/Phoenix") {
        // March (2) through October (9) - rough DST period
        if (month > 2 && month < 10) return true;
        if (month === 2) {
            // 2nd Sunday of March
            const secondSunday = 14 - new Date(date.getFullYear(), 2, 1).getDay();
            return day >= secondSunday;
        }
        if (month === 10) {
            // 1st Sunday of November
            const firstSunday = 7 - new Date(date.getFullYear(), 10, 1).getDay();
            if (firstSunday === 0) return day < 7;
            return day < firstSunday;
        }
        return false;
    }
    
    // For European timezones (last Sunday March - last Sunday October)
    if (timezone.startsWith("Europe/")) {
        if (month > 2 && month < 9) return true;
        if (month === 2) {
            const lastSunday = 31 - new Date(date.getFullYear(), 2, 31).getDay();
            return day >= lastSunday;
        }
        if (month === 9) {
            const lastSunday = 31 - new Date(date.getFullYear(), 9, 31).getDay();
            return day < lastSunday;
        }
        return false;
    }
    
    // Australia (first Sunday October - first Sunday April, reversed)
    if (timezone === "Australia/Sydney") {
        if (month >= 10 || month < 3) return true;
        if (month === 9) {
            const firstSunday = 7 - new Date(date.getFullYear(), 9, 1).getDay();
            return day >= firstSunday;
        }
        if (month === 3) {
            const firstSunday = 7 - new Date(date.getFullYear(), 3, 1).getDay();
            return day < firstSunday;
        }
        return false;
    }
    
    return false;
}

// Get timezone offset for a given date and timezone
function getTimezoneOffset(date, timezone) {
    const tz = timezoneOffsets[timezone];
    if (!tz) return "-05:00"; // Default to EST if unknown
    
    return isDST(date, timezone) ? tz.dst : tz.standard;
}

// Process schedule items to ensure startTime has correct timezone offset
function processScheduleTimezones(scheduleData) {
    if (!scheduleData.timezone || !scheduleData.schedule) {
        return scheduleData;
    }
    
    const timezone = scheduleData.timezone;
    
    scheduleData.schedule = scheduleData.schedule.map(item => {
        if (item.startTime) {
            // Parse the datetime (remove any existing timezone offset)
            let dateTimeStr = item.startTime;
            
            // Remove existing offset if present (e.g., -05:00 or +00:00 or Z)
            const offsetMatch = dateTimeStr.match(/([+-]\d{2}:\d{2}|Z)$/);
            if (offsetMatch) {
                dateTimeStr = dateTimeStr.slice(0, -offsetMatch[0].length);
            }
            
            // Parse the date to determine DST
            const date = new Date(dateTimeStr);
            const offset = getTimezoneOffset(date, timezone);
            
            // Reconstruct with correct timezone offset
            item.startTime = dateTimeStr + offset;
        }
        return item;
    });
    
    return scheduleData;
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

            // Process schedule items to ensure startTime has correct timezone offset
            const processedData = processScheduleTimezones(scheduleData);

            const blobClient = getBlobClient();
            const content = JSON.stringify(processedData, null, 2);
            
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
