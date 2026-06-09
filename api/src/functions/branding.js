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
    eventEndDate: "",
    // On-demand YouTube source used by the watch page once every
    // scheduled session has ended. Admin enters a URL / @handle /
    // channel ID / uploads playlist ID; the PUT handler resolves it
    // server-side and stores all three derived fields. Empty values
    // mean the client falls back to its built-in default channel.
    onDemandChannelInput: "",
    onDemandPlaylistId: "",
    onDemandChannelName: "",
    onDemandChannelUrl: ""
};

// Resolve an admin-supplied YouTube source string to a concrete
// uploads playlist ID + channel display name + canonical channel URL.
// Accepted input shapes:
//   - Full URL: https://www.youtube.com/@Handle, /channel/UC..., /playlist?list=UU...
//   - @handle  : `@ITOpsTalk`
//   - Bare handle: `ITOpsTalk`
//   - Channel ID: `UC...`
//   - Uploads playlist ID: `UU...`
// Throws on unrecognized / non-youtube.com sources to guard against
// arbitrary outbound fetches (SSRF).
async function resolveYouTubeSource(rawInput) {
    const input = (rawInput || "").trim();
    if (!input) return null;

    let pageUrl;
    let assumedPlaylistId = null;

    if (/^UU[\w-]{20,30}$/.test(input)) {
        assumedPlaylistId = input;
        pageUrl = `https://www.youtube.com/playlist?list=${input}`;
    } else if (/^UC[\w-]{20,30}$/.test(input)) {
        pageUrl = `https://www.youtube.com/channel/${input}`;
    } else if (/^@[\w.\-]+$/.test(input)) {
        pageUrl = `https://www.youtube.com/${input}`;
    } else if (/^https?:\/\//i.test(input)) {
        let u;
        try { u = new URL(input); }
        catch (e) { throw new Error(`Invalid URL: ${input}`); }
        if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(u.hostname.toLowerCase())) {
            throw new Error("Only youtube.com URLs are supported.");
        }
        u.hostname = "www.youtube.com";
        u.protocol = "https:";
        pageUrl = u.toString();
        const listParam = u.searchParams.get("list");
        if (listParam && /^UU[\w-]{20,30}$/.test(listParam)) {
            assumedPlaylistId = listParam;
        }
    } else if (/^[\w.\-]+$/.test(input)) {
        pageUrl = `https://www.youtube.com/@${input}`;
    } else {
        throw new Error("Unrecognized YouTube source. Use a channel URL, @handle, channel ID (UC...), or uploads playlist ID (UU...).");
    }

    const resp = await fetch(pageUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Azr-Core-Event/1.0)",
            "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "follow"
    });
    if (!resp.ok) {
        throw new Error(`YouTube returned HTTP ${resp.status} for ${pageUrl}`);
    }
    const html = await resp.text();

    let channelId = null;
    const idMatch = html.match(/"(?:channelId|externalId|channelExternalId)":"(UC[\w-]{20,30})"/);
    if (idMatch) channelId = idMatch[1];

    let playlistId = assumedPlaylistId;
    if (!playlistId && channelId) playlistId = "UU" + channelId.slice(2);
    if (!playlistId) {
        throw new Error("Could not resolve channel from YouTube. Double-check the URL / handle.");
    }

    let channelName = "";
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (ogTitle) {
        channelName = ogTitle[1].replace(/^Uploads from\s+/i, "").trim();
    } else {
        const t = html.match(/<title>([^<]+)<\/title>/);
        if (t) channelName = t[1].replace(/\s*-\s*YouTube\s*$/i, "").trim();
    }

    const channelUrl = channelId
        ? `https://www.youtube.com/channel/${channelId}`
        : pageUrl;

    return { playlistId, channelName, channelUrl };
}

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

        // Resolve the on-demand YouTube source (if any) before we touch
        // storage. A bad value should fail loudly so the admin knows
        // their input wasn't accepted.
        const onDemandInputRaw = typeof body.onDemandChannelInput === "string"
            ? body.onDemandChannelInput.trim()
            : "";
        let resolvedChannel = { playlistId: "", channelName: "", channelUrl: "" };
        if (onDemandInputRaw) {
            try {
                const r = await resolveYouTubeSource(onDemandInputRaw);
                if (r) resolvedChannel = r;
            } catch (resolveErr) {
                context.log("On-demand channel resolution failed:", resolveErr.message);
                return {
                    status: 400,
                    jsonBody: {
                        error: "Could not resolve the on-demand YouTube channel",
                        details: resolveErr.message
                    }
                };
            }
        }

        const config = {
            eventName: (body.eventName || defaultConfig.eventName).trim(),
            tagLine: (body.tagLine || defaultConfig.tagLine).trim(),
            logo: body.logo || defaultConfig.logo,
            primaryColor: body.primaryColor || defaultConfig.primaryColor,
            secondaryColor: body.secondaryColor || defaultConfig.secondaryColor,
            accentColor: body.accentColor || defaultConfig.accentColor,
            hideSponsors: !!body.hideSponsors,
            eventStartDate: (body.eventStartDate || "").trim(),
            eventEndDate: (body.eventEndDate || "").trim(),
            onDemandChannelInput: onDemandInputRaw,
            onDemandPlaylistId: resolvedChannel.playlistId,
            onDemandChannelName: resolvedChannel.channelName,
            onDemandChannelUrl: resolvedChannel.channelUrl
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
