const { test, expect } = require("@playwright/test");

test.describe("Private API read-only acceptance", () => {
    test.skip(process.env.PRIVATE_API_ACCEPTANCE !== "true", "Enable explicitly for an approved deployed test environment");

    test("public SWA API still returns schedule JSON", async ({ request }) => {
        const response = await request.get("/api/schedule", { maxRedirects: 0 });
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toContain("application/json");
        const body = await response.json();
        expect(body.timezone).toBe("America/New_York");
        expect(Array.isArray(body.schedule)).toBe(true);
    });

    test("browser-supplied internal identity cannot access favorites", async ({ request }) => {
        const response = await request.get("/api/favorites", {
            maxRedirects: 0,
            headers: Object.fromEntries(["x-summit-client-principal", "x-ms-client-principal"].map(name => [
                name, Buffer.from(JSON.stringify({
                    userId: "forged-user", identityProvider: "aad",
                    userRoles: ["anonymous", "authenticated", "administrator"]
                })).toString("base64")
            ]))
        });
        expect([302, 401, 403]).toContain(response.status());
        expect(await response.text()).not.toContain("sessionIds");
    });

    for (const [label, variable, expectedStatus] of [
        ["Function", "FUNCTION_BASE_URL", 403],
        ["APIM", "APIM_BASE_URL", 401]
    ]) {
        test(`direct ${label} access is rejected`, async ({ request }) => {
            const origin = process.env[variable];
            expect(origin, `${variable} is required`).toBeTruthy();
            const url = new URL("/api/schedule", origin);
            expect(url.protocol).toBe("https:");
            const response = await request.get(url.toString(), { maxRedirects: 0 });
            if (label === "APIM") expect([401, 403]).toContain(response.status());
            else expect(response.status()).toBe(expectedStatus);
            expect(await response.text()).not.toContain('"schedule":');
        });
    }
});
