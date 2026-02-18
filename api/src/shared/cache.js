/**
 * Simple in-memory cache with TTL support.
 * 
 * Used to reduce Azure Storage calls on high-traffic GET endpoints.
 * Each Function App instance maintains its own cache, so this is
 * safe for horizontal scaling — worst-case is a cache miss on a
 * fresh instance, which falls through to storage.
 * 
 * Default TTL: 60 seconds. Write operations should call invalidate()
 * to ensure the same instance serves fresh data immediately.
 */

const store = new Map();

const DEFAULT_TTL_MS = 60_000; // 60 seconds

/**
 * Get a cached value if it exists and hasn't expired.
 * @param {string} key - Cache key
 * @param {number} [ttlMs] - TTL in milliseconds (default 60s)
 * @returns {*} Cached data or null
 */
function get(key, ttlMs = DEFAULT_TTL_MS) {
    const entry = store.get(key);
    if (entry && Date.now() - entry.timestamp < ttlMs) {
        return entry.data;
    }
    // Clean up expired entry
    if (entry) store.delete(key);
    return null;
}

/**
 * Store a value in the cache.
 * @param {string} key - Cache key
 * @param {*} data - Data to cache
 */
function set(key, data) {
    store.set(key, { data, timestamp: Date.now() });
}

/**
 * Invalidate a specific cache key or all keys matching a prefix.
 * Call this after any write operation (POST/PUT/DELETE).
 * @param {string} keyOrPrefix - Exact key or prefix to invalidate
 */
function invalidate(keyOrPrefix) {
    if (store.has(keyOrPrefix)) {
        store.delete(keyOrPrefix);
    } else {
        // Prefix-based invalidation
        for (const key of store.keys()) {
            if (key.startsWith(keyOrPrefix)) {
                store.delete(key);
            }
        }
    }
}

/**
 * Schedule version tracker.
 * Incremented on every schedule write operation (POST/PUT/DELETE/import).
 * Clients poll GET /api/schedule/version and refresh when the value changes.
 */
let scheduleVersion = Date.now().toString(36);

function bumpScheduleVersion() {
    scheduleVersion = Date.now().toString(36);
}

function getScheduleVersion() {
    return scheduleVersion;
}

/** Cache-Control header value for public GET responses */
const CACHE_CONTROL_PUBLIC = 'public, max-age=60, stale-while-revalidate=300';

module.exports = { get, set, invalidate, bumpScheduleVersion, getScheduleVersion, CACHE_CONTROL_PUBLIC };
