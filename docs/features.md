# Features

## Public Website

The public site is split into six focused pages, each sharing a persistent side-rail navigation. Clean URLs are configured in `staticwebapp.config.json` so `/watch`, `/about`, `/schedule`, `/speakers`, and `/sponsors` rewrite to their respective `.html` files.

| URL | File | Purpose |
|-----|------|---------|
| `/` | `index.html` | Home — logo, title, tagline, primary CTAs |
| `/watch` | `watch.html` | Watch — full-bleed video player + now-playing & up-next |
| `/about` | `about.html` | About content (Markdown from Content API) |
| `/schedule` | `schedule.html` | Full event schedule with session modals |
| `/speakers` | `speakers.html` | Speaker grid with detail modals |
| `/sponsors` | `sponsors.html` | Sponsor grid grouped by tier with detail modals |

### Side-rail Navigation

- **Persistent rail** on every public and admin page — mounted by [rail.js](../src/web/rail.js) and configured via `body[data-rail="public|admin"]` and `body[data-rail-active="<id>"]`
- **Fluent UI inline SVG icons** (no font dependency) for Home, Watch, About, Schedule, Speakers, Sponsors
- **Collapse toggle** in the rail header — collapsed state persisted to `localStorage` key `rail.collapsed`
- **Mobile drawer** below 900px — hamburger toggles off-canvas overlay; Escape or scrim click closes
- **Register button** in the rail footer — shown when registration is enabled, opens the registration modal
- **Active state** marked with `.is-active` class and `aria-current="page"` for assistive tech

### Theme System (Dark / Light)

- **Dual themes** — both keyed off CSS custom properties on `:root[data-theme="dark|light"]`
- **First-visit default** — honors the user's OS-level `prefers-color-scheme`
- **Manual toggle** in the rail footer (sun/moon icon) — persists to `localStorage` key `site.theme`
- **Brand colors preserved** — Azure gradients, sponsor tier badges, and the LIVE indicator stay branded across both themes

### Sign-in & Personal Favorites

- **Sign in with Microsoft (Entra ID)** — uses Azure Static Web Apps' built-in `aad` provider, no app registration needed
- **Sign-in button** in the rail footer for anonymous visitors; swaps to user name + Sign out once authenticated
- **Star (★) on every session card** — toggles a session as a favorite; one click adds, another removes
- **"My Schedule" filter chip** on `/schedule` — hides everything except starred sessions
- **Anonymous → signed-in handoff** — anonymous favorites stored in `localStorage` (`event-favorites`) are pushed up to the user's account on first sign-in and then cleared locally
- **Per-user persistence** — signed-in favorites live in Cosmos DB (Serverless tier) under partition key `/userId`; the user's ID is the SWA-issued per-provider hash, never the email
- **Data-plane auth via managed identity** — the Function App uses its user-assigned identity with the *Cosmos DB Built-in Data Contributor* role; no Cosmos keys are issued or stored anywhere

### Hero & Branding (Home page)

- **Event Logo** — Customizable conference logo displayed prominently above the title
- Configurable branding and tagline via Admin Dashboard
- Primary CTAs route to the Watch page and the Schedule page

### Video Player Section (Watch page)

- **Embedded YouTube Player** — Automatically loads and plays the current session
- **Live Stream Detection** — Shows "LIVE" badge when stream is broadcasting
- **Now Playing Info Box** — Displays current session title, description, and YouTube link
- **Up Next Box** — Shows the next scheduled session with live countdown timer
- **Live Chat Button** — Opens YouTube live chat in a popup window during streams

### Dynamic Schedule

- Fetches sessions from Azure Table Storage API
- Groups sessions by day with date headers
- Clickable session cards open detailed modal with:
  - Session time and date
  - Full title and description (with clickable links)
  - Direct YouTube link
  - **Past sessions:** "Watch Recording" button linking to the YouTube video
  - **Future sessions:** "Add to Calendar" button that downloads an ICS file with correct start time and duration

### Registration

- **Register Button** — Appears in the rail footer when registration is enabled by an admin
- **Registration Modal** — Opens with configurable title, Markdown-rendered description, and external registration link
- Configuration managed via the Admin Dashboard (stored in Blob Storage)

### Featured Speakers Section (speakers.html)

- Dynamically loads speakers from API
- Speaker cards with avatar (headshot or initials), name, title, and company
- Hover effect with subtle lift animation
- **Speaker Modal Popup** on click showing:
  - Large avatar/headshot
  - Name, title, and company
  - Social links (Twitter/X, LinkedIn, GitHub, Website)
  - Full biography with clickable links
  - List of their sessions (clickable to open session details)

### Sponsors Section (sponsors.html)

- Fetches sponsors from API, grouped by tier (Platinum, Gold, Silver, Bronze, Community)
- Logo grid with tier headings
- **Sponsor Detail Modal** on click showing:
  - Large logo image
  - Sponsor name and tier badge
  - Website link
  - Markdown-rendered description

### About Page (about.html)

- **About** — Event description loaded from Content API (server-side Markdown stored in Blob Storage)

### Shared Across Public Pages

- **Code of Conduct** — Modal with community guidelines loaded from Content API (link in every page footer)
- **Footer** — Privacy Policy (links to Microsoft Privacy Statement), Code of Conduct, Admin link, Powered by Azure

### Accessibility & UX

- Keyboard navigation (Escape to close modals)
- Click outside modal to close
- Responsive design for all screen sizes
- Loading states for async content
- XSS protection via DOMPurify sanitization

---

## Admin Dashboard (admin.html)

**Authentication:** Requires Microsoft Entra ID login (configured in staticwebapp.config.json)

The admin rail (mounted by the same [rail.js](../src/web/rail.js)) provides persistent navigation to Dashboard, Schedule, Speakers, Sponsors, Branding, and Registration sections. The rail footer offers a **Back to site** link, **Logout**, and the theme toggle.

Central dashboard with navigation to all admin functions:

- **Schedule Management** — Link to schedule-admin.html
- **Speaker Management** — Link to speakers-admin.html
- **Sponsor Management** — Link to sponsors-admin.html
- **Registration Management** — Enable/disable registration button, set title, registration URL, and Markdown description with split-pane live preview editor
- **Branding** — Customize event name, logo, and color scheme
- **Headshot Upload** — Upload speaker images directly to blob storage
- **Code of Conduct Editor** — Edit CoC content (saved to Blob Storage via Content API)
- **About Editor** — Edit About section content (saved to Blob Storage via Content API)

---

## Schedule Admin (schedule-admin.html)

**Authentication:** Requires Microsoft Entra ID login

### Schedule Management

- **View All Sessions** — Table with title, video ID, date/time, duration, and actions
- **Add Session** — Form with video ID, title, description, start time, and duration
- **Edit Session** — Inline editing of any session field
- **Delete Session** — Single delete with confirmation
- **Multi-Select Delete** — Checkbox selection for bulk deletion

### CSV Export/Import

- **Export to CSV** — Downloads schedule as RFC 4180 compliant CSV
  - Excel formula protection (prefixes dangerous characters with single quote)
  - Handles multi-line descriptions and special characters
- **Import from CSV** — Upload CSV to create/update sessions
  - Creates new sessions or updates existing (by sessionId)
  - Validates required columns (videoId, title, startTime)
  - Reports success/error counts

### YouTube Playlist Import

- **Import from YouTube Playlist** — Bulk import videos from any public YouTube playlist
  - Enter playlist URL or ID
  - Requires YouTube Data API v3 key (free from Google Cloud Console)
  - Set first session start time and gap between sessions
  - Automatically fetches video titles, descriptions, and durations
  - Creates sequential schedule entries with proper timing
  - Skips private/deleted videos
  - Shows detailed import progress and results

---

## Speakers Admin (speakers-admin.html)

**Authentication:** Requires Microsoft Entra ID login

### Speaker Management

- **View All Speakers** — Card grid with avatar, name, title, company, and social links
- **Add Speaker** — Form with:
  - Name, title, company
  - Biography (multi-line)
  - Headshot filename (references blob in `speakerheadshots` container)
  - Real-time headshot preview as filename is typed
  - Social links (LinkedIn, Twitter/X)
  - **Session Picker** — Dropdown to assign sessions from the schedule; shows assigned sessions as removable tags
- **Edit Speaker** — Full editing of all fields
- **Delete Speaker** — With confirmation

### Extract Speakers

- **Auto-Extract from Schedule** — Parses session descriptions for "Speaker:" patterns
- Automatically creates speaker entries with linked sessions
- Updates existing speakers with new session links
- Reports created/updated counts

---

## Sponsors Admin (sponsors-admin.html)

**Authentication:** Requires Microsoft Entra ID login

### Sponsor Management

- **View All Sponsors** — Card grid with logo, name, tier badge, website link, and enable/disable toggle
- **Add Sponsor** — Form with:
  - Sponsor name, tier (Platinum/Gold/Silver/Bronze/Community), sort order
  - Website URL
  - Logo filename (references blob in `sponsorlogos` container)
  - Real-time logo preview as filename is typed
  - Description with Markdown support and live preview
  - Enable/disable toggle for public visibility
- **Edit Sponsor** — Full editing of all fields
- **Delete Sponsor** — With confirmation
- **Enable/Disable** — Quick toggle for public visibility
- **Hide All Sponsors** — Toggle to hide the entire sponsors section from the public site
- **Stats Bar** — Total sponsors, enabled count, logos count

### Logo Upload

- **Drag & Drop Upload Zone** — Upload logo images (JPG, PNG, WebP, SVG, max 10MB)
- **Automatic Filename Sanitization** — Uploaded files are lowercased and URL-safe
- **"Use this logo" Button** — After upload, one-click auto-fill of the logo filename field
- **Existing Logos Grid** — Browse and click to auto-fill the logo filename field
- Images stored in `sponsorlogos` blob container with private access (served via API)
