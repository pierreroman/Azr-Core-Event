/*
 * Side-rail navigation + theme system.
 *
 * Usage on every page that should show the rail:
 *
 *   <body data-rail="public" data-rail-active="schedule">
 *     ...
 *     <script src="rail.js" defer></script>
 *
 * `data-rail` selects the variant: "public" or "admin".
 * `data-rail-active` matches the `id` of one of the items below
 * and marks it as the current page.
 *
 * The theme system runs unconditionally so any page that includes
 * this script gets dark/light toggle support, even if it doesn't
 * mount the rail.
 *
 * No build step. Vanilla, IIFE-scoped, ES2017.
 */
(function () {
  'use strict';

  // ---------- Theme ----------------------------------------------------
  var THEME_KEY = 'site.theme'; // 'dark' | 'light'

  function getStoredTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (_) {
      return null;
    }
  }

  function preferredTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    var btns = document.querySelectorAll('.rail-theme-toggle');
    btns.forEach(function (b) {
      b.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      b.setAttribute(
        'aria-label',
        theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
      );
    });
  }

  function initTheme() {
    var theme = getStoredTheme() || preferredTheme();
    applyTheme(theme);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    var next = current === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {
      /* ignore */
    }
    applyTheme(next);
  }

  // ---------- Icons (Fluent UI System Icons, 24px line) ----------------
  // Keep these as small inline strings so we don't add a build step.
  // Each icon is a 24x24 viewBox; the rail CSS sizes them.
  var ICONS = {
    play:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4.5v15l13-7.5z"/></svg>',
    info:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg>',
    calendar:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>',
    mic:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>',
    handshake:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12.5l4-4 3 3 4-4 4 4 4-4"/><path d="M9.5 14.5l2 2a1.5 1.5 0 0 0 2.1 0l4.4-4.4"/><path d="M15.5 17.5l1.5 1.5a1.5 1.5 0 0 0 2.1-2.1L17.6 15"/></svg>',
    ticket:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h13a1.5 1.5 0 0 1 1.5 1.5v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 15.5v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="icon-moon" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="icon-sun" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/></svg>',
    home:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M5.5 10.5V20a.5.5 0 0 0 .5.5h4V15h4v5.5h4a.5.5 0 0 0 .5-.5v-9.5"/></svg>',
    palette:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2-1 1.5-2-.5-1 .5-2 1.5-2H17a4 4 0 0 0 4-4 8.5 8.5 0 0 0-9-9z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/><circle cx="17.5" cy="11" r="1"/></svg>',
    arrowLeft:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    logout:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 8l-4 4 4 4M5 12h11"/></svg>',
    signIn:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M14 8l4 4-4 4M3 12h14"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    menu:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    book:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h10.5A2.5 2.5 0 0 1 17 7v13H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M7.5 8.5h6M7.5 12h6"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H17"/></svg>'
  };

  // ---------- Nav definitions ------------------------------------------
  var PUBLIC_NAV = [
    { id: 'home', label: 'Home', href: '/', icon: 'home' },
    { id: 'watch', label: 'Watch', href: '/watch.html', icon: 'play' },
    { id: 'about', label: 'About', href: '/about.html', icon: 'info' },
    { id: 'schedule', label: 'Schedule', href: '/schedule.html', icon: 'calendar' },
    { id: 'speakers', label: 'Speakers', href: '/speakers.html', icon: 'mic' },
    { id: 'code-of-conduct', label: 'Code of Conduct', icon: 'book', action: 'openCodeOfConduct' },
    { id: 'sponsors', label: 'Sponsors', href: '/sponsors.html', icon: 'handshake' }
  ];

  var ADMIN_NAV = [
    { id: 'dashboard', label: 'Dashboard', href: '/admin.html', icon: 'home' },
    { id: 'schedule', label: 'Schedule', href: '/schedule-admin.html', icon: 'calendar' },
    { id: 'speakers', label: 'Speakers', href: '/speakers-admin.html', icon: 'mic' },
    { id: 'sponsors', label: 'Sponsors', href: '/sponsors-admin.html', icon: 'handshake' },
    { id: 'branding', label: 'Branding', href: '/admin.html#section-branding', icon: 'palette' },
    { id: 'registration', label: 'Registration', href: '/admin.html#section-registration', icon: 'ticket' }
  ];

  // ---------- Markup helpers -------------------------------------------
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildItem(item, activeId) {
    var isActive = item.id === activeId;
    // Action items (no href) render as <button> and invoke a window function.
    if (item.action) {
      var b = el('button', {
        type: 'button',
        class: 'rail-item' + (isActive ? ' is-active' : ''),
        'data-rail-id': item.id,
        'data-tooltip': item.label
      });
      b.innerHTML =
        ICONS[item.icon] +
        '<span class="rail-item-label">' + item.label + '</span>' +
        (item.badge ? '<span class="rail-badge">' + item.badge + '</span>' : '');
      b.addEventListener('click', function () {
        var fn = window[item.action];
        if (typeof fn === 'function') fn();
      });
      return b;
    }
    var a = el('a', {
      class: 'rail-item' + (isActive ? ' is-active' : ''),
      href: item.href,
      'data-rail-id': item.id,
      'data-tooltip': item.label
    });
    if (isActive) a.setAttribute('aria-current', 'page');
    a.innerHTML =
      ICONS[item.icon] +
      '<span class="rail-item-label">' + item.label + '</span>' +
      (item.badge ? '<span class="rail-badge">' + item.badge + '</span>' : '');
    return a;
  }

  function buildGroup(items, activeId) {
    var ul = el('ul', { class: 'rail-group' });
    items.forEach(function (item) {
      var li = el('li');
      li.appendChild(buildItem(item, activeId));
      ul.appendChild(li);
    });
    return ul;
  }

  function buildThemeButton() {
    var b = el('button', {
      type: 'button',
      class: 'rail-item rail-theme-toggle',
      'data-tooltip': 'Toggle theme'
    });
    b.innerHTML =
      ICONS.moon + ICONS.sun + '<span class="rail-item-label">Theme</span>';
    b.addEventListener('click', toggleTheme);
    return b;
  }

  function buildBrand(variant) {
    var label = variant === 'admin' ? 'Admin' : 'Home';
    var href = variant === 'admin' ? '/admin.html' : '/';
    var titleEl = document.getElementById('site-title');
    var text = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || 'Community Event';
    var a = el('a', { class: 'rail-brand', href: href, 'aria-label': label });
    a.innerHTML =
      '<img src="/assets/Azure-A-16px.png" alt="" aria-hidden="true">' +
      '<span class="rail-brand-text">' + escapeHtml(text) + '</span>';
    return a;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ---------- Rail assembly --------------------------------------------
  var COLLAPSE_KEY = 'rail.collapsed';

  function mountRail() {
    var variant = document.body.getAttribute('data-rail');
    if (!variant) return;
    var activeId = document.body.getAttribute('data-rail-active') || '';
    var nav = variant === 'admin' ? ADMIN_NAV : PUBLIC_NAV;

    // Mobile toggle button (lives outside the rail so it's clickable when
    // the rail is hidden off-canvas).
    var hamburger = el('button', {
      type: 'button',
      class: 'rail-toggle-mobile',
      'aria-label': 'Open navigation',
      'aria-expanded': 'false',
      'aria-controls': 'side-rail'
    });
    hamburger.innerHTML = ICONS.menu;
    hamburger.addEventListener('click', function () {
      document.body.classList.toggle('rail-open');
      hamburger.setAttribute(
        'aria-expanded',
        document.body.classList.contains('rail-open') ? 'true' : 'false'
      );
    });

    var scrim = el('div', { class: 'rail-scrim', 'aria-hidden': 'true' });
    scrim.addEventListener('click', closeMobile);

    var aside = el('aside', {
      class: 'side-rail',
      id: 'side-rail',
      'aria-label': variant === 'admin' ? 'Admin navigation' : 'Primary navigation'
    });

    // Header
    var header = el('div', { class: 'rail-header' });
    header.appendChild(buildBrand(variant));
    var collapseBtn = el('button', {
      type: 'button',
      class: 'rail-collapse',
      'aria-label': 'Collapse navigation',
      'aria-expanded': 'true',
      'aria-controls': 'rail-body'
    });
    collapseBtn.innerHTML = ICONS.chevron;
    collapseBtn.addEventListener('click', function () {
      var collapsed = document.body.classList.toggle('rail-collapsed');
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
      } catch (_) {
        /* ignore */
      }
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    });
    header.appendChild(collapseBtn);
    aside.appendChild(header);

    // Body
    var body = el('nav', {
      class: 'rail-body',
      id: 'rail-body',
      'aria-label': 'Main'
    });
    body.appendChild(buildGroup(nav, activeId));
    aside.appendChild(body);

    // Footer
    var footer = el('div', { class: 'rail-footer' });

    if (variant === 'public') {
      // Register button — only shown when registration is enabled.
      // The page (or branding API) toggles a CSS class on the body
      // or sets `window.registrationEnabled` after branding loads.
      var registerBtn = el('button', {
        type: 'button',
        class: 'rail-item rail-register',
        'data-tooltip': 'Register',
        style: 'display:none;'
      });
      registerBtn.innerHTML =
        ICONS.ticket + '<span class="rail-item-label">Register</span>';
      registerBtn.addEventListener('click', function () {
        if (typeof window.openRegistrationModal === 'function') {
          window.openRegistrationModal();
        }
      });
      footer.appendChild(registerBtn);
      // Expose so other scripts (branding loader) can show it.
      window.__railRegisterButton = registerBtn;

      // Auth slot — populated by site.js once /.auth/me resolves.
      // Defaults to a Sign in link so anon visitors see it immediately.
      var authSlot = el('div', { class: 'rail-auth-slot' });
      var signInLink = el('a', {
        class: 'rail-item rail-signin',
        href: '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname + window.location.search),
        'data-tooltip': 'Sign in'
      });
      signInLink.innerHTML =
        ICONS.signIn + '<span class="rail-item-label">Sign in</span>';
      authSlot.appendChild(signInLink);
      footer.appendChild(authSlot);
      window.__railAuthSlot = authSlot;
    } else if (variant === 'admin') {
      var back = el('a', {
        class: 'rail-item',
        href: '/',
        'data-tooltip': 'Back to site'
      });
      back.innerHTML =
        ICONS.arrowLeft + '<span class="rail-item-label">Back to site</span>';
      footer.appendChild(back);

      var logout = el('a', {
        class: 'rail-item',
        href: '/.auth/logout',
        'data-tooltip': 'Logout'
      });
      logout.innerHTML =
        ICONS.logout + '<span class="rail-item-label">Logout</span>';
      footer.appendChild(logout);
    }

    footer.appendChild(buildThemeButton());
    aside.appendChild(footer);

    // Mount
    document.body.insertBefore(hamburger, document.body.firstChild);
    document.body.insertBefore(scrim, document.body.firstChild);
    document.body.insertBefore(aside, document.body.firstChild);

    // Restore collapsed state
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') {
        document.body.classList.add('rail-collapsed');
        collapseBtn.setAttribute('aria-expanded', 'false');
        collapseBtn.setAttribute('aria-label', 'Expand navigation');
      }
    } catch (_) {
      /* ignore */
    }

    // Sync theme button state after rail is mounted
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

    // Esc closes mobile drawer
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('rail-open')) {
        closeMobile();
        hamburger.focus();
      }
    });

    function closeMobile() {
      document.body.classList.remove('rail-open');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  }

  // ---------- Public helper: refresh register-button visibility --------
  // Called by branding loader once it knows whether registration is enabled.
  window.setRegistrationEnabled = function (enabled) {
    var btn = window.__railRegisterButton;
    if (!btn) return;
    btn.style.display = enabled ? '' : 'none';
  };

  // ---------- Public helper: update auth slot --------------------------
  // Called by site.js after /.auth/me resolves.
  //   user: null  -> show "Sign in" link
  //   user: { name } -> show name + Sign out link
  window.setSignedInUser = function (user) {
    var slot = window.__railAuthSlot;
    if (!slot) return;
    slot.innerHTML = '';
    if (!user) {
      var signInLink = el('a', {
        class: 'rail-item rail-signin',
        href: '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname + window.location.search),
        'data-tooltip': 'Sign in'
      });
      signInLink.innerHTML = ICONS.signIn + '<span class="rail-item-label">Sign in</span>';
      slot.appendChild(signInLink);
      return;
    }
    var userBtn = el('div', {
      class: 'rail-item rail-user',
      'data-tooltip': user.name || 'Signed in',
      title: user.name || 'Signed in'
    });
    userBtn.innerHTML =
      ICONS.user + '<span class="rail-item-label">' + escapeHtml(user.name || 'You') + '</span>';
    slot.appendChild(userBtn);

    var signOutLink = el('a', {
      class: 'rail-item rail-signout',
      href: '/.auth/logout?post_logout_redirect_uri=' + encodeURIComponent(window.location.pathname),
      'data-tooltip': 'Sign out'
    });
    signOutLink.innerHTML =
      ICONS.logout + '<span class="rail-item-label">Sign out</span>';
    slot.appendChild(signOutLink);
  };

  // ---------- Boot -----------------------------------------------------
  initTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountRail);
  } else {
    mountRail();
  }
})();
