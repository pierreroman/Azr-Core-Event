const operations = require("./http-operations.json");
const roles = new Map(operations.map(operation => [operation.name, operation.role]));
const principals = new WeakMap();
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status, error) {
    return { status, headers: { "Cache-Control": "no-store" }, jsonBody: { error } };
}

function decodePrincipal(header) {
    if (!header) return null;
    if (header.length > 16384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(header)) {
        throw new Error("Invalid client principal encoding");
    }
    let principal;
    try {
        principal = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    } catch (error) {
        throw new Error("Invalid client principal JSON", { cause: error });
    }
    if (!principal || typeof principal !== "object" || Array.isArray(principal)
        || typeof principal.userId !== "string" || !principal.userId.trim()
        || principal.userId.length > 256
        || !Array.isArray(principal.userRoles)
        || !principal.userRoles.every(role => typeof role === "string")
        || typeof principal.identityProvider !== "string" || !principal.identityProvider) {
        throw new Error("Invalid client principal shape");
    }
    return principal;
}

function authorizeGatewayRequest(request, functionName, environment = process.env) {
    if (!guidPattern.test(environment.APIM_PRINCIPAL_ID || "")) {
        return { response: errorResponse(503, "Gateway authorization is not configured") };
    }
    // App Service Authentication must validate the bearer token and overwrite this header.
    const caller = request.headers.get("x-ms-client-principal-id");
    if (!caller || caller.toLowerCase() !== environment.APIM_PRINCIPAL_ID.toLowerCase()) {
        return { response: errorResponse(403, "Gateway identity required") };
    }
    const role = roles.get(functionName);
    if (!role) return { response: errorResponse(403, "Operation is not authorized") };
    let principal;
    try {
        principal = decodePrincipal(request.headers.get("x-summit-client-principal"));
    } catch (error) {
        return { response: errorResponse(400, error.message) };
    }
    if (role !== "anonymous") {
        if (!principal || !principal.userRoles.includes("authenticated")) {
            return { response: errorResponse(401, "Authentication required") };
        }
        if (!principal.userRoles.includes(role)) {
            return { response: errorResponse(403, "Insufficient role") };
        }
    }
    return { principal };
}

function registerAuthorization(app) {
    app.hook.preInvocation(hook => {
        if (hook.invocationContext.options.trigger.type !== "httpTrigger") return;
        const mode = process.env.API_AUTH_MODE || "direct";
        if (mode === "direct") return;
        const handler = hook.functionHandler;
        hook.functionHandler = async (request, context) => {
            if (mode !== "apim") {
                context.error("Unsupported API_AUTH_MODE; request denied");
                return errorResponse(503, "API authorization is not configured");
            }
            const result = authorizeGatewayRequest(request, context.functionName);
            if (result.response) {
                context.warn(`Gateway authorization denied ${context.functionName}: ${result.response.status}`);
                return result.response;
            }
            principals.set(request, result.principal);
            return handler(request, context);
        };
    });
}

function getClientPrincipal(request, context) {
    if (process.env.API_AUTH_MODE === "apim") return principals.get(request) || null;
    if (process.env.API_AUTH_MODE && process.env.API_AUTH_MODE !== "direct") {
        context.error("Unsupported API_AUTH_MODE; principal access denied");
        return null;
    }
    try {
        const principal = decodePrincipal(request.headers.get("x-ms-client-principal"));
        return principal?.userRoles.includes("authenticated") ? principal : null;
    } catch (error) {
        context.warn(error.message);
        return null;
    }
}

module.exports = { authorizeGatewayRequest, decodePrincipal, getClientPrincipal, registerAuthorization };
