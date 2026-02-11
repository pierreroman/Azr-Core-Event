# Security Improvements Documentation

This document details three critical security improvements implemented in the Community Online Event Website project.

## Overview

Based on security analysis, three vulnerabilities were identified and fixed:

1. **Cross-Site Scripting (XSS) vulnerability**
2. **Missing authentication on Speakers API**
3. **Missing Content Security Policy (CSP) header**

---

## 1. Cross-Site Scripting (XSS) Fix

### Vulnerability
The `formatDescription()` function in `index.html` was converting user-controlled text (session descriptions, speaker bios) into HTML without properly sanitizing it. This could allow attackers to inject malicious JavaScript code.

**Vulnerable code:**
```javascript
function formatDescription(text) {
    if (!text) return '';
    // Convert URLs to clickable links
    return text.replace(
        /(https?:\/\/[^\s]+)/g, 
        '<a href="$1" target="_blank" rel="noopener">$1</a>'
    ).replace(/\n/g, '<br>');
}
```

### Fix
Modified the function to first escape all HTML entities before processing URLs. This ensures that any malicious HTML/JavaScript is neutralized.

**Fixed code:**
```javascript
function formatDescription(text) {
    if (!text) return '';
    // First, escape HTML to prevent XSS attacks
    const escaped = escapeHtml(text);
    // Then convert URLs to clickable links (now safe because HTML is escaped)
    return escaped.replace(
        /(https?:\/\/[^\s<]+)/g, 
        '<a href="$1" target="_blank" rel="noopener">$1</a>'
    ).replace(/\n/g, '<br>');
}
```

### Impact
- **Before**: Attackers could inject malicious scripts through session descriptions or speaker bios
- **After**: All HTML is safely escaped, preventing XSS attacks while still allowing legitimate URLs to be clickable

### Testing
Verified that:
- ✓ Normal URLs are converted to clickable links
- ✓ Script tags are escaped and not executed
- ✓ Image tags with onerror handlers are escaped
- ✓ Multiline text with URLs works correctly

---

## 2. Speakers API Authentication

### Vulnerability
All Speakers API endpoints (POST, PUT, DELETE) were configured with `authLevel: "anonymous"` in the Azure Functions code, allowing anyone to create, modify, or delete speaker data without authentication.

Additionally, the `/speakers-admin.html` page was not protected by authentication in the Static Web App configuration.

### Fix
Added proper authentication requirements in `staticwebapp.config.json`:

```json
{
  "route": "/speakers-admin.html",
  "allowedRoles": ["authenticated"]
},
{
  "route": "/api/speakers",
  "methods": ["POST"],
  "allowedRoles": ["authenticated"]
},
{
  "route": "/api/speakers/*",
  "methods": ["PUT", "DELETE"],
  "allowedRoles": ["authenticated"]
},
{
  "route": "/api/speakers",
  "methods": ["GET"],
  "allowedRoles": ["anonymous"]
},
{
  "route": "/api/speakers/*",
  "methods": ["GET"],
  "allowedRoles": ["anonymous"]
}
```

### Impact
- **Before**: Anyone could modify or delete speaker data
- **After**: Only authenticated users (via Azure AD) can create, update, or delete speakers
- **Note**: GET requests remain public so the main website can display speaker information

---

## 3. Content Security Policy (CSP)

### Vulnerability
The application was missing a Content Security Policy header, which is a critical defense-in-depth mechanism against XSS, clickjacking, and other code injection attacks.

### Fix
Added a comprehensive CSP header to `staticwebapp.config.json`:

```json
"globalHeaders": {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.google.com https://www.gstatic.com https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; frame-src https://www.youtube.com; connect-src 'self' https://www.googleapis.com"
}
```

### Policy Details

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Default policy: only load resources from same origin |
| `script-src` | `'self' 'unsafe-inline' https://www.youtube.com ...` | Allow scripts from same origin, inline scripts (required for current implementation), and YouTube/Google APIs |
| `style-src` | `'self' 'unsafe-inline'` | Allow styles from same origin and inline styles |
| `img-src` | `'self' data: https:` | Allow images from same origin, data URIs, and any HTTPS source |
| `font-src` | `'self' data:` | Allow fonts from same origin and data URIs |
| `frame-src` | `https://www.youtube.com` | Only allow iframes from YouTube (for video player) |
| `connect-src` | `'self' https://www.googleapis.com` | Allow API calls to same origin and Google APIs (for playlist import) |

### Impact
- **Before**: No CSP protection; browsers would load any resource from any source
- **After**: Strict CSP limits what resources can be loaded and from where
- **Note**: `'unsafe-inline'` is currently required for inline scripts/styles but should be removed in future refactoring

---

## Security Best Practices Going Forward

### Recommendations for Future Development

1. **Remove `'unsafe-inline'` from CSP**
   - Move all inline scripts to external `.js` files
   - Move all inline styles to `styles.css`
   - Use nonces or hashes for any remaining inline scripts

2. **Input Validation**
   - Add server-side validation for all user inputs
   - Implement length limits on text fields
   - Validate URL formats before storing

3. **Rate Limiting**
   - Consider adding rate limiting to API endpoints to prevent abuse
   - Implement request throttling for authenticated operations

4. **Regular Security Audits**
   - Run CodeQL or similar security scanning tools regularly
   - Review dependencies for known vulnerabilities
   - Keep Azure Functions and npm packages up to date

5. **Logging and Monitoring**
   - Log all authentication attempts
   - Monitor for unusual API usage patterns
   - Set up alerts for failed authentication attempts

---

## Summary

These three security improvements significantly enhance the security posture of the Community Online Event Website application:

1. **XSS Protection**: Prevents malicious script injection through user content
2. **Authentication**: Ensures only authorized users can modify sensitive data
3. **CSP**: Provides defense-in-depth against various injection attacks

All changes are minimal, focused, and maintain existing functionality while adding critical security protections.
---

## 4. Insecure Randomness Fix (CodeQL)

### Vulnerability
Session IDs and speaker IDs were generated using `Math.random()`, which is not cryptographically secure. This makes IDs potentially predictable.

**Vulnerable code (schedule.js):**
```javascript
const random = Math.random().toString(36).substring(2, 8);
```

### Fix
Replaced with Node.js `crypto.randomBytes()` for cryptographically secure random values:

**Fixed code (schedule.js):**
```javascript
const crypto = require("crypto");
const random = crypto.randomBytes(4).toString("hex");
```

### Impact
- **Before**: IDs could potentially be predicted or brute-forced
- **After**: IDs use cryptographically secure randomness

### Files Modified
- `api/src/functions/schedule.js` - `generateSessionId()` function
- `api/src/functions/speakers.js` - `generateSpeakerId()` function

---

## 5. Subresource Integrity (SRI) for CDN Scripts

### Vulnerability
CDN-loaded scripts (marked.js and DOMPurify) lacked integrity hashes, making them vulnerable to CDN compromise or man-in-the-middle attacks.

**Vulnerable code:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js"></script>
```

### Fix
Added SRI hashes with `integrity` and `crossorigin` attributes:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js" 
        integrity="sha384-QsSpx6a0USazT7nK7w8qXDgpSAPhFsb2XtpoLFQ5+X2yFN6hvCKnwEzN8M5FWaJb" 
        crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js" 
        integrity="sha384-cwS6YdhLI7XS60eoDiC+egV0qHp8zI+Cms46R0nbn8JrmoAzV9uFL60etMZhAnSu" 
        crossorigin="anonymous"></script>
```

### Impact
- **Before**: Browser would execute any script served by CDN
- **After**: Browser verifies script hash before execution; rejects tampered scripts

### Files Modified
- `index.html` - Lines 9, 11
- `admin.html` - Lines 9, 11

---

## 6. URL Sanitization Fix (CodeQL)

### Vulnerability
URL validation in `schedule-admin.html` used simple `includes()` checks which could be bypassed.

**Vulnerable code:**
```javascript
if (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be')) {
    // reject
}
```

### Fix
Replaced with proper URL parsing using the `URL` constructor:

**Fixed code:**
```javascript
try {
    const url = new URL(youtubeUrl);
    const isYouTube = url.hostname === 'www.youtube.com' || 
                      url.hostname === 'youtube.com' || 
                      url.hostname === 'youtu.be';
    if (!isYouTube) {
        // reject
    }
} catch (e) {
    // invalid URL
}
```

### Impact
- **Before**: Attacker could use URLs like `evil.com?x=youtube.com` to bypass validation
- **After**: Only actual YouTube hostnames are accepted

### Files Modified
- `schedule-admin.html` - URL validation in YouTube playlist import