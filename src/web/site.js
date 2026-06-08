/*
 * site.js — shared client behavior for all public pages
 *
 * Extracted from index.html so that the same logic can power the split
 * pages (watch / about / schedule / speakers / sponsors). Loaders guard
 * against missing DOM nodes so each page only runs the work it needs.
 *
 * Function declarations at the top level of a classic script become
 * window properties, which preserves `onclick="..."` references in the
 * markup. Top-level `let`/`const` are file-local — that's fine because
 * all consumers live in this file.
 */

let scheduleData = [];
let speakersData = [];
let sponsorsData = [];
let speakerStorageBaseUrl = '';
let sponsorStorageBaseUrl = '';
let youtubePlayer = null;
let countdownInterval = null;
// Sessions whose video has finished playing. Once a session is in this
// set we treat it as "past" even if its scheduled duration hasn't
// elapsed yet — this prevents the BRB <-> player flicker that would
// otherwise occur when a YouTube video ends earlier than the
// scheduled `duration` (the default duration is 1 hour, so almost
// every recorded talk hits this).
const endedSessionIds = new Set();

function onYouTubeIframeAPIReady() {
    // API is ready, player will be created when needed
}

// Accessibility utilities
let lastFocusedElement = null;

function trapFocus(modalElement) {
    if (!modalElement) return;
    const focusableElements = modalElement.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    function handleKeydown(e) {
        if (e.key === 'Escape') {
            const closeBtn = modalElement.querySelector('.modal-close');
            if (closeBtn) closeBtn.click();
            return;
        }

        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    }

    modalElement._trapFocusHandler = handleKeydown;
    modalElement.addEventListener('keydown', handleKeydown);

    if (firstFocusable) {
        setTimeout(() => firstFocusable.focus(), 50);
    }
}

function releaseFocus(modalElement) {
    if (!modalElement) return;
    if (modalElement._trapFocusHandler) {
        modalElement.removeEventListener('keydown', modalElement._trapFocusHandler);
        delete modalElement._trapFocusHandler;
    }
    if (lastFocusedElement) {
        lastFocusedElement.focus();
        lastFocusedElement = null;
    }
}

function handleCardKeydown(event, callback) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        callback();
    }
}

// ==================== SPEAKERS ====================

async function loadSpeakers() {
    const grid = document.getElementById('speakers-grid');
    if (!grid) return;
    try {
        const response = await fetch('/api/speakers');
        if (!response.ok) throw new Error('Failed to load speakers');
        const data = await response.json();
        speakersData = data.speakers || [];
        speakerStorageBaseUrl = data.storageBaseUrl || '';
        renderSpeakers();
    } catch (error) {
        console.error('Error loading speakers:', error);
        grid.innerHTML =
            '<p class="error">Unable to load speakers. Please try again later.</p>';
    }
}

function renderSpeakers() {
    const grid = document.getElementById('speakers-grid');
    if (!grid) return;

    if (!speakersData || speakersData.length === 0) {
        grid.innerHTML = '<p style="text-align: center; width: 100%;">No speakers available yet.</p>';
        return;
    }

    const sortedSpeakers = [...speakersData].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
    );

    grid.innerHTML = sortedSpeakers.map(speaker => {
        const headshotUrl = speaker.headshotFile && speakerStorageBaseUrl ? `${speakerStorageBaseUrl}/${speaker.headshotFile}` : '';
        const avatarStyle = headshotUrl
            ? `background-image: url('${headshotUrl}')`
            : '';
        const initials = getInitials(speaker.name);

        return `
            <div class="speaker-card" role="button" tabindex="0" onclick="openSpeakerModal('${speaker.id}')" onkeydown="handleCardKeydown(event, () => openSpeakerModal('${speaker.id}'))">
                <div class="speaker-avatar" style="${avatarStyle}">
                    ${!headshotUrl ? initials : ''}
                </div>
                <h3 class="speaker-name">${escapeHtml(speaker.name || 'Unknown')}</h3>
                <p class="speaker-title">${escapeHtml(speaker.title || '')}</p>
                ${speaker.company ? `<p class="speaker-company">${escapeHtml(speaker.company)}</p>` : ''}
            </div>
        `;
    }).join('');
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ')
        .map(part => part.charAt(0).toUpperCase())
        .slice(0, 2)
        .join('');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function openSpeakerModal(speakerId) {
    const modal = document.getElementById('speaker-modal');
    if (!modal) return;
    const speaker = speakersData.find(s => s.id === speakerId);
    if (!speaker) return;

    const avatarEl = document.getElementById('speaker-modal-avatar');
    const headshotUrl = speaker.headshotFile && speakerStorageBaseUrl ? `${speakerStorageBaseUrl}/${speaker.headshotFile}` : '';
    if (headshotUrl) {
        avatarEl.style.backgroundImage = `url('${headshotUrl}')`;
        avatarEl.textContent = '';
    } else {
        avatarEl.style.backgroundImage = '';
        avatarEl.textContent = getInitials(speaker.name);
    }

    document.getElementById('speaker-modal-name').textContent = speaker.name || 'Unknown';
    document.getElementById('speaker-modal-title').textContent = speaker.title || '';
    document.getElementById('speaker-modal-company').textContent = speaker.company || '';

    document.getElementById('speaker-modal-bio').innerHTML = formatDescription(speaker.bio || 'No bio available.');

    const socialsEl = document.getElementById('speaker-modal-socials');
    const socials = [];
    if (speaker.twitter) {
        socials.push(`<a href="${speaker.twitter}" target="_blank" rel="noopener" title="Twitter/X">𝕏</a>`);
    }
    if (speaker.linkedin) {
        socials.push(`<a href="${speaker.linkedin}" target="_blank" rel="noopener" title="LinkedIn">in</a>`);
    }
    if (speaker.github) {
        socials.push(`<a href="${speaker.github}" target="_blank" rel="noopener" title="GitHub">⌨</a>`);
    }
    if (speaker.website) {
        socials.push(`<a href="${speaker.website}" target="_blank" rel="noopener" title="Website">🌐</a>`);
    }
    socialsEl.innerHTML = socials.join(' ');

    const sessionsEl = document.getElementById('speaker-modal-sessions-list');
    const speakerSessions = scheduleData.filter(session => {
        const sessionIds = Array.isArray(speaker.sessionIds) ? speaker.sessionIds : [];
        return sessionIds.includes(session.id) || sessionIds.includes(session.videoId) ||
               (session.description && session.description.toLowerCase().includes(speaker.name.toLowerCase()));
    });

    if (speakerSessions.length > 0) {
        sessionsEl.innerHTML = speakerSessions.map(session => {
            const startTime = new Date(session.startTime);
            const timeStr = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = startTime.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const handler = `closeSpeakerModal(); openSession('${session.id}');`;
            return `
                <div class="speaker-session-item" role="button" tabindex="0"
                    onclick="${handler}"
                    onkeydown="handleCardKeydown(event, () => { ${handler} })">
                    <span class="session-time">${dateStr} ${timeStr}</span>
                    <span class="session-title">${escapeHtml(session.title)}</span>
                </div>
            `;
        }).join('');
    } else {
        sessionsEl.innerHTML = '<p class="no-sessions">No sessions linked yet.</p>';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    lastFocusedElement = document.activeElement;
    trapFocus(modal);
}

function closeSpeakerModal() {
    const modal = document.getElementById('speaker-modal');
    if (!modal) return;
    releaseFocus(modal);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function formatDescription(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    return escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener">$1</a>'
    ).replace(/\n/g, '<br>');
}

function formatCountdown(ms) {
    if (ms <= 0) return 'Starting now...';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `Starting in ${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `Starting in ${minutes}m ${seconds}s`;
    } else {
        return `Starting in ${seconds}s`;
    }
}

function findNextSession(currentSession) {
    const now = new Date();
    let nextSession = null;
    let nextStartTime = null;

    for (const session of scheduleData) {
        const startTime = new Date(session.startTime);

        if (currentSession && session.id === currentSession.id) continue;
        if (startTime <= now) continue;

        if (!nextSession || startTime < nextStartTime) {
            nextSession = session;
            nextStartTime = startTime;
        }
    }

    return nextSession;
}

function updateInfoBoxes(currentSession, nextSession) {
    const nowPlayingBox = document.getElementById('now-playing-box');
    const upNextBox = document.getElementById('up-next-box');
    if (!nowPlayingBox || !upNextBox) return;

    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    if (currentSession) {
        document.getElementById('now-playing-title').textContent = currentSession.title;
        document.getElementById('now-playing-description').innerHTML = formatDescription(currentSession.description);
        document.getElementById('now-playing-link').href = currentSession.url || '#';
        nowPlayingBox.style.display = 'block';

        const liveIndicator = nowPlayingBox.querySelector('.live-indicator');
        if (liveIndicator) {
            liveIndicator.style.display = 'none';
        }
    } else {
        nowPlayingBox.style.display = 'none';
    }

    if (nextSession) {
        const nextStartTime = new Date(nextSession.startTime);
        document.getElementById('up-next-title').textContent = nextSession.title;
        upNextBox.style.display = 'block';

        function updateCountdown() {
            const now = new Date();
            const ms = nextStartTime - now;
            document.getElementById('up-next-countdown').textContent = formatCountdown(ms);

            if (ms <= 0) {
                clearInterval(countdownInterval);
                setTimeout(() => updateVideoPlayer(), 1000);
            }
        }

        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
    } else {
        upNextBox.style.display = 'none';
    }
}

function updateVideoPlayer() {
    const container = document.getElementById('video-container');
    if (!container) return;
    const now = new Date();

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const earliestStart = scheduleData.length
        ? new Date(Math.min(...scheduleData.map(s => new Date(s.startTime).getTime())))
        : null;

    if (earliestStart && earliestStart >= tomorrow) {
        container.innerHTML = '<img src="assets/save-the-date-2.png" alt="Save the date">';
        updateInfoBoxes(null, null);
        return;
    }

    if (scheduleData.length === 0) {
        const stored = localStorage.getItem('event-branding');
        const branding = stored ? JSON.parse(stored) : {};
        let placeholderImg = 'assets/OnDemand.png';
        let placeholderAlt = 'Watch on demand';

        if (branding.eventStartDate) {
            const eventStart = new Date(branding.eventStartDate + 'T00:00:00');
            if (eventStart >= tomorrow) {
                placeholderImg = 'assets/save-the-date-2.png';
                placeholderAlt = 'Save the date';
            }
        }

        container.innerHTML = `<img src="${placeholderImg}" alt="${placeholderAlt}">`;
        updateInfoBoxes(null, null);
        return;
    }

    let currentSession = null;
    let hasUpcomingToday = false;
    let hasUpcomingLater = false;

    for (const session of scheduleData) {
        const startTime = new Date(session.startTime);
        const endTime = new Date(startTime.getTime() + (session.duration || 3600) * 1000);

        if (now >= startTime && now < endTime) {
            if (endedSessionIds.has(session.id)) {
                continue;
            }
            currentSession = session;
            break;
        }

        if (startTime > now) {
            if (startTime < tomorrow) {
                hasUpcomingToday = true;
            } else {
                hasUpcomingLater = true;
            }
        }
    }

    const nextSession = findNextSession(currentSession);

    updateInfoBoxes(currentSession, nextSession);

    if (currentSession) {
        const videoId = currentSession.videoId || extractVideoId(currentSession.url);

        // If the player is already showing this exact video, don't tear it
        // down and rebuild — that would reset playback (and re-mute it).
        if (youtubePlayer && youtubePlayer.__videoId && youtubePlayer.__videoId === videoId) {
            window.currentVideoId = videoId;
            return;
        }

        window.currentVideoId = videoId;

        const chatButton = document.getElementById('live-chat-button');
        if (chatButton) {
            chatButton.style.display = 'none';
        }

        if (videoId) {
            const sessionStart = new Date(currentSession.startTime);
            const elapsedSeconds = Math.floor((now - sessionStart) / 1000);
            const startOffset = Math.max(0, elapsedSeconds);

            container.innerHTML = `
                <div id="youtube-player"></div>
                <div class="live-badge" id="live-badge" style="display: none;">🔴 LIVE</div>
                <div class="video-overlay" id="video-overlay">
                    <div class="now-playing" id="now-playing-status">Now Playing</div>
                    <div class="video-title">${escapeHtml(currentSession.title)}</div>
                </div>`;

            if (youtubePlayer) {
                youtubePlayer.destroy();
                youtubePlayer = null;
            }

            youtubePlayer = new YT.Player('youtube-player', {
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    mute: 1,
                    modestbranding: 1,
                    rel: 0,
                    start: startOffset
                },
                events: {
                    onReady: function(event) {
                        setTimeout(() => {
                            try {
                                const videoData = event.target.getVideoData();
                                const isLive = videoData && videoData.isLive;

                                const liveBadge = document.getElementById('live-badge');
                                if (liveBadge) liveBadge.style.display = isLive ? 'block' : 'none';

                                const statusEl = document.getElementById('now-playing-status');
                                if (statusEl && isLive) statusEl.textContent = '🔴 LIVE';

                                const chatButton = document.getElementById('live-chat-button');
                                if (chatButton) chatButton.style.display = isLive ? 'block' : 'none';

                                const liveIndicator = document.querySelector('.now-playing-box .live-indicator');
                                if (liveIndicator) liveIndicator.style.display = isLive ? 'inline' : 'none';

                                console.log('Video live status:', isLive);
                            } catch (e) {
                                console.log('Could not get video data:', e);
                            }
                        }, 1000);

                        setTimeout(() => {
                            const overlay = document.getElementById('video-overlay');
                            if (overlay) overlay.style.opacity = '0';
                        }, 5000);
                    },
                    onStateChange: function(event) {
                        if (event.data === YT.PlayerState.ENDED) {
                            console.log('Video ended, showing BRB placeholder');
                            if (currentSession && currentSession.id) {
                                endedSessionIds.add(currentSession.id);
                            }
                            if (youtubePlayer) {
                                youtubePlayer.destroy();
                                youtubePlayer = null;
                            }
                            const container = document.getElementById('video-container');
                            container.innerHTML = '<img src="assets/BRB.jpg" alt="We\'ll be right back">';
                            hideLiveChatButton();
                            setTimeout(() => updateVideoPlayer(), 5000);
                        }
                    },
                    onError: function(event) {
                        container.innerHTML = `
                            <div class="video-error">
                                <img src="assets/BRB.jpg" alt="Video unavailable" class="error-bg">
                                <div class="error-overlay">
                                    <p class="error-title">Now Playing: ${escapeHtml(currentSession.title)}</p>
                                    <p class="error-message">This video cannot be embedded.</p>
                                    <a href="${currentSession.url}" target="_blank" class="btn-watch-large">▶ Watch on YouTube</a>
                                </div>
                            </div>`;
                    }
                }
            });
            youtubePlayer.__videoId = videoId;
        } else {
            container.innerHTML = '<img src="assets/BRB.jpg" alt="Be right back">';
            hideLiveChatButton();
            if (youtubePlayer) { youtubePlayer.destroy(); youtubePlayer = null; }
        }
    } else if (hasUpcomingToday) {
        container.innerHTML = '<img src="assets/BRB.jpg" alt="Be right back">';
        hideLiveChatButton();
        if (youtubePlayer) { youtubePlayer.destroy(); youtubePlayer = null; }
    } else if (hasUpcomingLater) {
        container.innerHTML = '<img src="assets/See-you-tomorrow.png" alt="See you tomorrow">';
        hideLiveChatButton();
        if (youtubePlayer) { youtubePlayer.destroy(); youtubePlayer = null; }
    } else {
        container.innerHTML = '<img src="assets/OnDemand.png" alt="Watch on demand">';
        hideLiveChatButton();
        if (youtubePlayer) { youtubePlayer.destroy(); youtubePlayer = null; }
    }
}

function hideLiveChatButton() {
    const chatButton = document.getElementById('live-chat-button');
    if (chatButton) chatButton.style.display = 'none';
    window.currentVideoId = null;
}

function openLiveChat() {
    if (window.currentVideoId) {
        const chatUrl = `https://www.youtube.com/live_chat?v=${window.currentVideoId}&embed_domain=${window.location.hostname}`;
        window.open(chatUrl, 'YouTubeChat', 'width=400,height=600,scrollbars=yes,resizable=yes');
    }
}

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match ? match[1] : null;
}

// ==================== SCHEDULE ====================

async function loadSchedule() {
    const container = document.getElementById('schedule-container');
    const hasVideo = !!document.getElementById('video-container');
    // The speaker modal links to sessions, so we also need scheduleData
    // populated on pages that render the speakers grid (e.g. /speakers.html).
    const hasSpeakers = !!document.getElementById('speakers-grid');

    // No schedule UI, no video to drive, no speaker grid — nothing to do.
    if (!container && !hasVideo && !hasSpeakers) return;

    try {
        const response = await fetch('/api/schedule');
        const data = await response.json();
        scheduleData = data.schedule || [];

        // Update video player based on schedule (no-ops if no video on page)
        updateVideoPlayer();

        if (!container) return;

        if (scheduleData.length === 0) {
            container.innerHTML = `
                <div class="no-schedule-message" style="text-align: center; max-width: 600px; margin: 0 auto;">
                    <p>The full event schedule isn't available just yet, but we're working on it. Check back soon for updates as sessions and speakers are finalized. In the meantime, be sure to save the date using the <strong>Add to Calendar (ICS)</strong> button below so it's locked into your calendar and you don't miss a thing.</p>
                    <button class="btn btn-primary" onclick="downloadEventICS()" style="margin-top: 16px;">📅 Add to Calendar (ICS)</button>
                </div>`;
            return;
        }

        const sessionsByDay = {};
        scheduleData.forEach(session => {
            const date = new Date(session.startTime);
            const dayKey = date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });

            if (!sessionsByDay[dayKey]) {
                sessionsByDay[dayKey] = [];
            }
            sessionsByDay[dayKey].push(session);
        });

        const sortedDays = Object.keys(sessionsByDay).sort((a, b) => {
            const dateA = new Date(sessionsByDay[a][0].startTime);
            const dateB = new Date(sessionsByDay[b][0].startTime);
            return dateA - dateB;
        });

        let html = '';
        sortedDays.forEach((day, index) => {
            const sessions = sessionsByDay[day];
            html += `<div class="schedule-day">`;
            html += `<h3>Day ${index + 1} - ${day}</h3>`;
            html += `<div class="day-sessions">`;

            sessions.forEach(session => {
                const time = new Date(session.startTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                });

                const truncatedDesc = session.description
                    ? session.description.substring(0, 120) + '...'
                    : '';

                html += `
                    <div class="session-card" role="button" tabindex="0" onclick="openSession('${session.id}')" onkeydown="handleCardKeydown(event, () => openSession('${session.id}'))">
                        <div class="session-time">${time}</div>
                        <h4>${escapeHtml(session.title)}</h4>
                        <p>${escapeHtml(truncatedDesc)}</p>
                    </div>
                `;
            });

            html += `</div></div>`;
        });

        container.innerHTML = html;

    } catch (error) {
        console.error('Error loading schedule:', error);
        if (container) {
            container.innerHTML = '<p>Unable to load schedule. Please try again later.</p>';
        }
    }
}

function openSession(sessionId) {
    const modal = document.getElementById('session-modal');
    if (!modal) return;
    const session = scheduleData.find(s => s.id === sessionId);
    if (!session) return;

    const time = new Date(session.startTime).toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    document.getElementById('modal-time').textContent = time;
    document.getElementById('modal-title').textContent = session.title;
    document.getElementById('modal-description').textContent = session.description || 'No description available.';

    const sessionStart = new Date(session.startTime);
    const durationMs = (session.duration || 3600) * 1000;
    const sessionEnd = new Date(sessionStart.getTime() + durationMs);
    const now = new Date();
    const actionsEl = document.getElementById('modal-actions');

    if (now > sessionEnd) {
        if (session.url) {
            actionsEl.innerHTML = `
                <a href="${escapeHtml(session.url)}" target="_blank" rel="noopener" class="btn-watch">
                    ▶ Watch Recording
                </a>
            `;
        } else {
            actionsEl.innerHTML = `<span class="text-muted">Recording not yet available</span>`;
        }
    } else {
        actionsEl.innerHTML = `
            <button class="btn-calendar" onclick="downloadICS('${session.id}')">
                📅 Add to Calendar
            </button>
        `;
        if (session.url) {
            actionsEl.innerHTML += `
                <a href="${escapeHtml(session.url)}" target="_blank" rel="noopener" class="btn-watch">
                    ▶ Watch Live
                </a>
            `;
        }
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    lastFocusedElement = document.activeElement;
    trapFocus(modal);
}

function closeModal() {
    const modal = document.getElementById('session-modal');
    if (!modal) return;
    releaseFocus(modal);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function downloadICS(sessionId) {
    const session = scheduleData.find(s => s.id === sessionId);
    if (!session) return;

    const start = new Date(session.startTime);
    let durationMs;

    // Heuristic: if duration ≤ 120, assume minutes (old data); otherwise seconds.
    if (session.duration && session.duration <= 120) {
        durationMs = session.duration * 60 * 1000;
    } else {
        durationMs = (session.duration || 3600) * 1000;
    }

    const end = new Date(start.getTime() + durationMs);

    function toICSDate(d) {
        return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }

    const eventName = document.title || 'Community Event';
    const description = (session.description || '').replace(/\n/g, '\\n');
    const url = session.url || '';
    const uid = `${session.id}@${window.location.hostname}`;

    const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Community Event//Session//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART:${toICSDate(start)}`,
        `DTEND:${toICSDate(end)}`,
        `SUMMARY:${session.title}`,
        `DESCRIPTION:${description}${url ? '\\n\\nLink: ' + url : ''}`,
        url ? `URL:${url}` : '',
        `ORGANIZER;CN=${eventName}:MAILTO:noreply@${window.location.hostname}`,
        'STATUS:CONFIRMED',
        `DTSTAMP:${toICSDate(new Date())}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${session.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// ==================== CODE OF CONDUCT ====================

function openCodeOfConduct() {
    const modal = document.getElementById('coc-modal');
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    lastFocusedElement = document.activeElement;
    trapFocus(modal);
}

function closeCodeOfConduct() {
    const modal = document.getElementById('coc-modal');
    if (!modal) return;
    releaseFocus(modal);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ==================== REGISTRATION ====================

let registrationConfig = null;

async function loadRegistration() {
    try {
        const response = await fetch('/api/registration');
        if (!response.ok) throw new Error('Failed to load registration config');
        registrationConfig = await response.json();

        const enabled = !!(registrationConfig.enabled && registrationConfig.registrationUrl);

        // Legacy top-nav button (still present on pages that haven't migrated to the rail)
        const btn = document.getElementById('nav-register');
        if (btn) {
            if (enabled) {
                btn.style.display = '';
                btn.textContent = registrationConfig.buttonText || 'Register';
            } else {
                btn.style.display = 'none';
            }
        }

        // New rail register button (provided by rail.js)
        if (typeof window.setRegistrationEnabled === 'function') {
            window.setRegistrationEnabled(enabled);
        }

        // Populate modal (only if it exists on this page)
        const modalTitle = document.getElementById('registration-modal-title');
        if (enabled && modalTitle) {
            modalTitle.textContent = registrationConfig.title || 'Register Now';
            const descMd = registrationConfig.description || '';
            document.getElementById('registration-modal-description').innerHTML = descMd.trim() ? parseMarkdown(descMd) : '';
            const link = document.getElementById('registration-modal-link');
            link.href = registrationConfig.registrationUrl;
            link.textContent = registrationConfig.buttonText || 'Register Now';
        }
    } catch (error) {
        console.log('Registration config unavailable:', error.message);
    }
}

function openRegistrationModal() {
    if (!registrationConfig || !registrationConfig.enabled) return;
    const modal = document.getElementById('registration-modal');
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    lastFocusedElement = document.activeElement;
    trapFocus(modal);
}

function closeRegistrationModal() {
    const modal = document.getElementById('registration-modal');
    if (!modal) return;
    releaseFocus(modal);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ==================== SPONSORS ====================

async function loadSponsors() {
    const grid = document.getElementById('sponsors-grid');
    if (!grid) return;
    try {
        const response = await fetch('/api/sponsors');
        if (!response.ok) throw new Error('Failed to load sponsors');
        const data = await response.json();
        sponsorsData = (data.sponsors || []).filter(s => s.enabled);
        sponsorStorageBaseUrl = data.storageBaseUrl || '';
        renderSponsorsSection();
    } catch (error) {
        console.error('Error loading sponsors:', error);
        grid.innerHTML = '<p>Sponsors information unavailable.</p>';
    }
}

function renderSponsorsSection() {
    const grid = document.getElementById('sponsors-grid');
    const section = document.getElementById('sponsors');
    if (!grid || !section) return;

    if (!sponsorsData || sponsorsData.length === 0) {
        section.style.display = 'none';
        const navLink = document.getElementById('nav-sponsors');
        if (navLink) navLink.style.display = 'none';
        return;
    }

    section.style.display = '';
    const navLink = document.getElementById('nav-sponsors');
    if (navLink) navLink.style.display = '';

    const tierOrder = ['platinum', 'gold', 'silver', 'bronze', 'community'];
    const tierLabels = {
        platinum: '\ud83c\udfc6 Platinum Sponsors',
        gold: '\ud83e\udd47 Gold Sponsors',
        silver: '\ud83e\udd48 Silver Sponsors',
        bronze: '\ud83e\udd49 Bronze Sponsors',
        community: '\ud83c\udf10 Community Partners'
    };

    const grouped = {};
    sponsorsData.forEach(s => {
        const t = s.tier || 'silver';
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(s);
    });

    let html = '';
    tierOrder.forEach(tier => {
        if (!grouped[tier] || grouped[tier].length === 0) return;
        html += `<div class="sponsors-tier-group">`;
        if (Object.keys(grouped).length > 1) {
            html += `<h3 class="sponsors-tier-title">${tierLabels[tier]}</h3>`;
        }
        html += `<div class="sponsors-tier-logos tier-${tier}">`;
        grouped[tier].forEach(sponsor => {
            const logoUrl = sponsor.logoFile && sponsorStorageBaseUrl
                ? `${sponsorStorageBaseUrl}/${sponsor.logoFile}`
                : '';
            html += `
                <div class="sponsor-logo" role="button" tabindex="0" onclick="openSponsorDetailModal('${sponsor.id}')" onkeydown="handleCardKeydown(event, () => openSponsorDetailModal('${sponsor.id}'))" title="${escapeHtml(sponsor.name)}">
                    ${logoUrl
                        ? `<img src="${logoUrl}" alt="${escapeHtml(sponsor.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><span style="display:none;">${escapeHtml(sponsor.name)}</span>`
                        : `<span>${escapeHtml(sponsor.name)}</span>`
                    }
                </div>
            `;
        });
        html += `</div></div>`;
    });

    grid.innerHTML = html;
}

function openSponsorDetailModal(sponsorId) {
    const modal = document.getElementById('sponsor-modal');
    if (!modal) return;
    const sponsor = sponsorsData.find(s => s.id === sponsorId);
    if (!sponsor) return;

    const logoEl = document.getElementById('sponsor-modal-logo');
    const logoUrl = sponsor.logoFile && sponsorStorageBaseUrl
        ? `${sponsorStorageBaseUrl}/${sponsor.logoFile}`
        : '';
    if (logoUrl) {
        logoEl.innerHTML = `<img src="${logoUrl}" alt="${escapeHtml(sponsor.name)}">`;
    } else {
        logoEl.innerHTML = `<span style="font-size:3rem;">🤝</span>`;
    }

    document.getElementById('sponsor-modal-name').textContent = sponsor.name;
    const tierEl = document.getElementById('sponsor-modal-tier');
    const tierLabels = { platinum: '🏆 Platinum', gold: '🥇 Gold', silver: '🥈 Silver', bronze: '🥉 Bronze', community: '🌐 Community' };
    tierEl.textContent = tierLabels[sponsor.tier] || sponsor.tier;
    tierEl.className = `sponsor-tier-badge tier-${sponsor.tier}`;

    const websiteEl = document.getElementById('sponsor-modal-website');
    if (sponsor.website) {
        websiteEl.href = sponsor.website;
        websiteEl.style.display = 'inline-block';
    } else {
        websiteEl.style.display = 'none';
    }

    const descEl = document.getElementById('sponsor-modal-description');
    if (sponsor.description) {
        descEl.innerHTML = formatDescription(sponsor.description);
    } else {
        descEl.innerHTML = '';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    lastFocusedElement = document.activeElement;
    trapFocus(modal);
}

function closeSponsorDetailModal() {
    const modal = document.getElementById('sponsor-modal');
    if (!modal) return;
    releaseFocus(modal);
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ==================== EVENT-LEVEL ICS ====================

function downloadEventICS() {
    const stored = localStorage.getItem('event-branding');
    const branding = stored ? JSON.parse(stored) : {};
    const titleEl = document.getElementById('site-title');
    const taglineEl = document.getElementById('site-tagline');
    const eventName = branding.eventName || (titleEl && titleEl.textContent) || 'Community Online Event';
    const tagLine = branding.tagLine || (taglineEl && taglineEl.textContent) || '';

    let startDate, endDate;
    if (branding.eventStartDate) {
        startDate = new Date(branding.eventStartDate + 'T09:00:00');
    } else {
        startDate = new Date();
        startDate.setDate(startDate.getDate() + ((8 - startDate.getDay()) % 7 || 7));
        startDate.setHours(9, 0, 0, 0);
    }
    if (branding.eventEndDate) {
        endDate = new Date(branding.eventEndDate + 'T17:00:00');
    } else {
        endDate = new Date(startDate);
        endDate.setHours(17, 0, 0, 0);
    }

    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uid = 'event-' + Date.now() + '@community-event';

    const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Community Event//EN',
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + fmt(new Date()),
        'DTSTART:' + fmt(startDate),
        'DTEND:' + fmt(endDate),
        'SUMMARY:' + eventName,
        'DESCRIPTION:' + tagLine.replace(/\n/g, '\\n'),
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = eventName.replace(/[^a-zA-Z0-9]/g, '_') + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== MARKDOWN ====================

function parseMarkdown(content) {
    if (typeof marked === 'undefined') {
        console.error('marked library not loaded!');
        return (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize('<p>Markdown library not loaded</p>') : '');
    }

    try {
        let html;
        if (typeof marked.parse === 'function') {
            html = marked.parse(content);
        } else if (typeof marked === 'function') {
            html = marked(content);
        } else {
            console.error('marked is loaded but has no parse function');
            return DOMPurify.sanitize(content);
        }
        return DOMPurify.sanitize(html);
    } catch (e) {
        console.error('Markdown parse error:', e);
        return DOMPurify.sanitize(content);
    }
}

async function loadMarkdownContent() {
    const aboutEl = document.getElementById('about-content');
    const cocEl = document.getElementById('coc-content');

    if (aboutEl) {
        try {
            const aboutResponse = await fetch('/api/content/about');
            if (aboutResponse.ok) {
                const aboutData = await aboutResponse.json();
                aboutEl.innerHTML = parseMarkdown(aboutData.content);
            } else {
                throw new Error('API returned ' + aboutResponse.status);
            }
        } catch (error) {
            console.log('API error for about, trying static file:', error.message);
            try {
                const staticAbout = await fetch('/content/about.md');
                if (staticAbout.ok) {
                    const content = await staticAbout.text();
                    aboutEl.innerHTML = parseMarkdown(content);
                } else {
                    aboutEl.innerHTML = '<p>About content unavailable.</p>';
                }
            } catch (e) {
                console.error('Static about file error:', e);
                aboutEl.innerHTML = '<p>About content unavailable.</p>';
            }
        }
    }

    if (cocEl) {
        try {
            const cocResponse = await fetch('/api/content/code-of-conduct');
            if (cocResponse.ok) {
                const cocData = await cocResponse.json();
                cocEl.innerHTML = parseMarkdown(cocData.content);
            } else {
                throw new Error('API returned ' + cocResponse.status);
            }
        } catch (error) {
            console.log('API error for CoC, trying static file:', error.message);
            try {
                const staticCoc = await fetch('/content/code-of-conduct.md');
                if (staticCoc.ok) {
                    const content = await staticCoc.text();
                    cocEl.innerHTML = parseMarkdown(content);
                } else {
                    cocEl.innerHTML = '<p>Code of Conduct unavailable.</p>';
                }
            } catch (e) {
                console.error('Static CoC file error:', e);
                cocEl.innerHTML = '<p>Code of Conduct unavailable.</p>';
            }
        }
    }
}

// ==================== BRANDING ====================

function applyBranding() {
    fetch('/api/branding')
        .then(r => r.json())
        .then(branding => {
            localStorage.setItem('event-branding', JSON.stringify(branding));
            applyBrandingData(branding);
        })
        .catch(err => {
            console.log('Branding API unavailable, using localStorage:', err);
            const stored = localStorage.getItem('event-branding');
            if (stored) {
                applyBrandingData(JSON.parse(stored));
            }
        });
}

function applyBrandingData(branding) {
    try {
        if (branding.eventName) {
            const titleEl = document.getElementById('site-title');
            if (titleEl) {
                // Watch/landing page: brand owns the tab title.
                document.title = branding.eventName;
                titleEl.textContent = branding.eventName;
            } else {
                // Subpage: preserve per-page title; append event name as suffix once.
                if (!document.title.includes(branding.eventName)) {
                    document.title = `${document.title} | ${branding.eventName}`;
                }
            }
        }

        const taglineEl = document.getElementById('site-tagline');
        if (branding.tagLine && taglineEl) {
            taglineEl.textContent = branding.tagLine;
        } else if (branding.eventName && taglineEl) {
            const baseName = branding.eventName.replace(/\s*\d{4}$/, '');
            taglineEl.textContent = baseName + ' - a community event focused on compute, network, and storage in Azure.';
        }

        const logoEl = document.getElementById('site-logo');
        if (branding.logo && branding.logo !== '/assets/event-logo.png' && logoEl) {
            logoEl.src = branding.logo;
        }

        if (branding.primaryColor) {
            document.documentElement.style.setProperty('--primary', branding.primaryColor);
        }
        if (branding.secondaryColor) {
            document.documentElement.style.setProperty('--primary-2', branding.secondaryColor);
        }

        if (branding.hideSponsors) {
            // Legacy in-page sponsors section (if still present on a page)
            const sponsorsSection = document.getElementById('sponsors');
            if (sponsorsSection) sponsorsSection.style.display = 'none';

            // Legacy top-nav anchor (pre-rail layouts)
            const sponsorsNav = document.getElementById('nav-sponsors');
            if (sponsorsNav) sponsorsNav.style.display = 'none';

            // Side-rail item (rail.js renders <li><a data-rail-id="sponsors"></a></li>)
            const railSponsor = document.querySelector('.side-rail .rail-item[data-rail-id="sponsors"]');
            if (railSponsor) {
                const li = railSponsor.closest('li');
                (li || railSponsor).style.display = 'none';
            }
        }

        // Re-evaluate video placeholder now that branding dates are available
        if (scheduleData.length === 0) {
            updateVideoPlayer();
        }
    } catch (e) {
        console.error('Error applying branding:', e);
    }
}

// ==================== SCHEDULE VERSION POLLING ====================

let _scheduleVersion = null;
let _versionPollTimer = null;

async function startScheduleVersionPolling() {
    // Only poll on pages that show schedule data
    if (!document.getElementById('schedule-container') && !document.getElementById('video-container')) {
        return;
    }
    try {
        const res = await fetch('/api/schedule/version');
        if (res.ok) {
            const data = await res.json();
            _scheduleVersion = data.version;
        }
    } catch (_) { /* ignore */ }

    _versionPollTimer = setInterval(checkScheduleVersion, 10_000);
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(_versionPollTimer);
            _versionPollTimer = null;
        } else {
            checkScheduleVersion();
            _versionPollTimer = setInterval(checkScheduleVersion, 10_000);
        }
    });
}

async function checkScheduleVersion() {
    try {
        const res = await fetch('/api/schedule/version');
        if (!res.ok) return;
        const data = await res.json();
        if (_scheduleVersion && data.version !== _scheduleVersion) {
            console.log('Schedule updated remotely — refreshing...');
            _scheduleVersion = data.version;
            await loadSchedule();
        }
        _scheduleVersion = data.version;
    } catch (_) { /* network hiccup — retry next interval */ }
}

// ==================== HASH SCROLL ====================

// Re-scroll to the URL hash target after async content has loaded.
function scrollToHashTarget(behavior = 'auto') {
    const hash = window.location.hash;
    if (!hash || hash === '#') return;
    try {
        const target = document.querySelector(hash);
        if (target) {
            target.scrollIntoView({ behavior, block: 'start' });
        }
    } catch (_) { /* invalid selector — ignore */ }
}

// ==================== INIT ====================

function _attachOverlayClose(id, closer) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('click', function(e) {
            if (e.target === this) closer();
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    applyBranding();

    Promise.allSettled([
        loadSchedule(),
        loadSpeakers(),
        loadSponsors(),
        loadMarkdownContent(),
        loadRegistration()
    ]).then(() => scrollToHashTarget('auto'));

    startScheduleVersionPolling();

    // Modal overlay click-to-close (guards inside)
    _attachOverlayClose('session-modal', closeModal);
    _attachOverlayClose('speaker-modal', closeSpeakerModal);
    _attachOverlayClose('coc-modal', closeCodeOfConduct);
    _attachOverlayClose('sponsor-modal', closeSponsorDetailModal);
    _attachOverlayClose('registration-modal', closeRegistrationModal);
});

window.addEventListener('hashchange', () => scrollToHashTarget('smooth'));

// Single Escape handler closes any open modal
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
        closeSpeakerModal();
        closeCodeOfConduct();
        closeSponsorDetailModal();
        closeRegistrationModal();
    }
});
