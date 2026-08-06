/* FREEREEL — app logic.
 *
 * No build step, no framework, no network calls. Everything renders from
 * data.js and persists to localStorage, so the whole thing works offline and
 * identically in a browser, an Electron window and an Android WebView. */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- state */

  var STORE_KEY = 'freereel.v1';

  var state = {
    tab: 'tonight',
    profile: 'adult',
    mood: null,
    time: 999,
    genreFilter: null,
    platformOffer: null,
    deviceFilter: null,
    query: '',
    saved: {},
    seen: {},
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.saved) state.saved = d.saved;
      if (d.seen) state.seen = d.seen;
      if (d.profile) state.profile = d.profile;
    } catch (e) {
      /* corrupted or storage disabled — carry on with defaults */
    }
  }

  function save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ saved: state.saved, seen: state.seen, profile: state.profile })
      );
    } catch (e) {
      /* private mode / storage full — the app still works, it just forgets */
    }
  }

  /* ---------------------------------------------------------------- utils */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function $(sel) { return document.querySelector(sel); }

  /* Free catalogues rotate, so every title gets a live lookup rather than a
     hardcoded deep link that will rot. JustWatch can filter to free sources. */
  function whereNowUrl(title) {
    return 'https://www.justwatch.com/us/search?q=' + encodeURIComponent(title);
  }

  function platformById(id) {
    for (var i = 0; i < PLATFORMS.length; i++) {
      if (PLATFORMS[i].id === id) return PLATFORMS[i];
    }
    return null;
  }

  function maxAge() {
    for (var i = 0; i < PROFILES.length; i++) {
      if (PROFILES[i].id === state.profile) return PROFILES[i].maxAge;
    }
    return 99;
  }

  function allowed(t) { return t.age <= maxAge(); }

  function matchesQuery(t) {
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    if (t.title.toLowerCase().indexOf(q) !== -1) return true;
    if ((t.why || '').toLowerCase().indexOf(q) !== -1) return true;
    for (var i = 0; i < (t.genres || []).length; i++) {
      if (t.genres[i].indexOf(q) !== -1) return true;
    }
    for (var j = 0; j < (t.where || []).length; j++) {
      var p = platformById(t.where[j]);
      if (p && p.name.toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- pieces */

  function confidenceTag(c) {
    if (c === 'pd') return '<span class="tag pd" title="Public domain — free forever">free forever</span>';
    if (c === 'solid') return '<span class="tag solid" title="Stable placement, rarely moves">stable</span>';
    return '<span class="tag check" title="Rotates often — verify before you plan on it">verify</span>';
  }

  function runtimeLabel(t) {
    if (t.kind === 'live') return 'always on';
    if (t.kind === 'collection') return 'collection';
    if (!t.mins) return '';
    if (t.kind === 'series' || t.kind === 'shorts') return t.mins + ' min/ep';
    return t.mins + ' min';
  }

  function whereRow(t) {
    var out = '';
    for (var i = 0; i < (t.where || []).length; i++) {
      var p = platformById(t.where[i]);
      if (!p) continue;
      out +=
        '<a class="where-pill" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
        esc(p.name) + '</a>';
    }
    return out;
  }

  function titleCard(t) {
    var isSaved = !!state.saved[t.id];
    var isSeen = !!state.seen[t.id];
    return (
      '<article class="card">' +
        '<div class="card-top">' +
          '<h4 class="card-title">' + esc(t.title) + '</h4>' +
          '<span class="card-meta">' + (t.year && t.year < 2026 ? esc(t.year) : '') + '</span>' +
        '</div>' +
        '<div class="tags">' +
          confidenceTag(t.confidence) +
          '<span class="tag age">' + esc(t.age) + '+</span>' +
          (runtimeLabel(t) ? '<span class="tag">' + esc(runtimeLabel(t)) + '</span>' : '') +
          (t.genres || []).map(function (g) { return '<span class="tag">' + esc(g) + '</span>'; }).join('') +
        '</div>' +
        '<p class="why">' + esc(t.why) + '</p>' +
        '<div>' +
          '<span class="label">Where to watch free</span>' +
          '<div class="where">' + whereRow(t) + '</div>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="btn' + (isSaved ? ' saved' : '') + '" data-save="' + esc(t.id) + '">' +
            (isSaved ? 'On your list' : 'Add to list') + '</button>' +
          '<button class="btn" data-seen="' + esc(t.id) + '">' +
            (isSeen ? 'Watched ✓' : 'Mark watched') + '</button>' +
          '<a class="btn" href="' + esc(whereNowUrl(t.title)) + '" target="_blank" rel="noopener">' +
            'Free right now?</a>' +
        '</div>' +
      '</article>'
    );
  }

  function platformCard(p) {
    var offers = (p.offers || []).map(function (o) {
      return '<span class="tag">' + esc(o) + '</span>';
    }).join('');
    return (
      '<article class="card">' +
        '<div class="card-top">' +
          '<h4 class="card-title">' + esc(p.name) + '</h4>' +
          '<span class="card-meta">' + esc(p.owner) + '</span>' +
        '</div>' +
        '<div class="tags">' + offers + '</div>' +
        '<p>' + esc(p.blurb) + '</p>' +
        '<div><span class="label">Best at</span><p class="best">' + esc(p.best) + '</p></div>' +
        '<div><span class="label">Why it matters for you</span><p class="why">' + esc(p.forYou) + '</p></div>' +
        '<div><span class="label">Signup</span><p>' + esc(p.signup) + '</p></div>' +
        '<div><span class="label">Catch</span><p>' + esc(p.caveat) + '</p></div>' +
        '<div class="card-actions">' +
          '<a class="btn primary" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open ' + esc(p.name) + '</a>' +
        '</div>' +
      '</article>'
    );
  }

  /* ---------------------------------------------------------------- tabs */

  function renderTonight() {
    var moodChips = MOODS.map(function (m) {
      return (
        '<button class="chip mood" data-mood="' + esc(m.id) + '" aria-pressed="' +
        (state.mood === m.id) + '">' + esc(m.label) +
        '<span class="mood-hint">' + esc(m.hint) + '</span></button>'
      );
    }).join('');

    var timeChips = TIMES.map(function (t) {
      return (
        '<button class="chip" data-time="' + t.id + '" aria-pressed="' +
        (state.time === t.id) + '">' + esc(t.label) + '</button>'
      );
    }).join('');

    var picks = TITLES.filter(function (t) {
      if (!allowed(t)) return false;
      if (state.mood && (t.mood || []).indexOf(state.mood) === -1) return false;
      if (state.time !== 999) {
        var len = t.mins || 0;
        if (t.kind === 'live' || t.kind === 'collection') len = 0;
        if (len > state.time) return false;
      }
      return true;
    });

    var body;
    if (!state.mood) {
      body = '<p class="empty">Pick a mood above and I will narrow it down.</p>';
    } else if (!picks.length) {
      body = '<p class="empty">Nothing matches that mood at that length for this profile. Try a longer window.</p>';
    } else {
      body =
        '<p class="pick-count">' + picks.length + ' option' + (picks.length === 1 ? '' : 's') +
        ' for a ' + esc(state.profile === 'adult' ? 'grown-up' : state.profile) + ' audience.</p>' +
        '<div class="grid">' + picks.map(titleCard).join('') + '</div>';
    }

    return (
      '<h2 class="panel-head">What are you watching tonight?</h2>' +
      '<p class="panel-lede">Two questions, then a shortlist. Everything here is free and legal in the ' +
      esc(REGION) + ' — no trials, no cards, nothing to cancel later.</p>' +
      '<div class="curator">' +
        '<p class="q">Where is your head at?</p>' +
        '<div class="chips">' + moodChips + '</div>' +
        '<p class="q">How long have you got?</p>' +
        '<div class="chips">' + timeChips + '</div>' +
      '</div>' +
      body
    );
  }

  function renderWatch() {
    var savedIds = Object.keys(state.saved).filter(function (k) { return state.saved[k]; });
    var savedTitles = TITLES.filter(function (t) { return state.saved[t.id] && allowed(t); });

    var genres = {};
    TITLES.forEach(function (t) {
      if (!allowed(t)) return;
      (t.genres || []).forEach(function (g) { genres[g] = true; });
    });
    var genreChips =
      '<button class="chip" data-genre="" aria-pressed="' + (!state.genreFilter) + '">Everything</button>' +
      Object.keys(genres).sort().map(function (g) {
        return '<button class="chip" data-genre="' + esc(g) + '" aria-pressed="' +
          (state.genreFilter === g) + '">' + esc(g) + '</button>';
      }).join('');

    var list = TITLES.filter(function (t) {
      if (!allowed(t)) return false;
      if (state.genreFilter && (t.genres || []).indexOf(state.genreFilter) === -1) return false;
      if (!matchesQuery(t)) return false;
      return true;
    });

    var savedBlock = '';
    if (savedTitles.length) {
      savedBlock =
        '<h3 class="sec">Your list — ' + savedTitles.length + ' saved</h3>' +
        '<div class="grid">' + savedTitles.map(titleCard).join('') + '</div>';
    } else if (savedIds.length) {
      savedBlock = '<h3 class="sec">Your list</h3><p class="empty">Your saved titles are all above this profile\'s age limit.</p>';
    }

    return (
      '<h2 class="panel-head">Your watchlist</h2>' +
      '<p class="panel-lede">Built around what you said you like — genre, cult and horror; comedy and unscripted; anime. ' +
      'Every entry says where it is free and why it is here.</p>' +
      '<div class="note info"><strong>On the tags:</strong> ' +
      '<em>free forever</em> means public domain — it cannot be taken away. ' +
      '<em>stable</em> means it rarely moves. ' +
      '<em>verify</em> means the free window rotates, so hit “Free right now?” before you commit an evening to it.</div>' +
      savedBlock +
      '<h3 class="sec">Picked for you</h3>' +
      '<div class="chips">' + genreChips + '</div>' +
      (list.length
        ? '<div class="grid">' + list.map(titleCard).join('') + '</div>'
        : '<p class="empty">Nothing matches. Clear the search or the genre filter.</p>')
    );
  }

  function renderPlatforms() {
    var offers = ['movies', 'tv', 'docs', 'live', 'kids', 'anime'];
    var offerChips =
      '<button class="chip" data-offer="" aria-pressed="' + (!state.platformOffer) + '">All</button>' +
      offers.map(function (o) {
        return '<button class="chip" data-offer="' + esc(o) + '" aria-pressed="' +
          (state.platformOffer === o) + '">' + esc(o) + '</button>';
      }).join('');

    var devices = [
      { id: 'roku', label: 'On Roku' },
      { id: 'web', label: 'In a browser' },
      { id: 'mobile', label: 'On mobile' },
    ];
    var deviceChips =
      '<button class="chip" data-device="" aria-pressed="' + (!state.deviceFilter) + '">Any device</button>' +
      devices.map(function (d) {
        return '<button class="chip" data-device="' + esc(d.id) + '" aria-pressed="' +
          (state.deviceFilter === d.id) + '">' + esc(d.label) + '</button>';
      }).join('');

    function pass(p) {
      if (state.platformOffer && p.offers.indexOf(state.platformOffer) === -1) return false;
      if (state.deviceFilter && p.devices.indexOf(state.deviceFilter) === -1) return false;
      if (state.query) {
        var q = state.query.toLowerCase();
        if (
          p.name.toLowerCase().indexOf(q) === -1 &&
          p.blurb.toLowerCase().indexOf(q) === -1 &&
          p.best.toLowerCase().indexOf(q) === -1
        ) return false;
      }
      return true;
    }

    var major = PLATFORMS.filter(function (p) { return p.tier === 'major' && pass(p); });
    var library = PLATFORMS.filter(function (p) { return p.tier === 'library' && pass(p); });
    var pub = PLATFORMS.filter(function (p) { return p.tier === 'public' && pass(p); });
    var niche = PLATFORMS.filter(function (p) { return p.tier === 'niche' && pass(p); });

    function section(label, arr) {
      if (!arr.length) return '';
      return '<h3 class="sec">' + esc(label) + '</h3><div class="grid">' + arr.map(platformCard).join('') + '</div>';
    }

    var retired = RETIRED.map(function (r) {
      return (
        '<div class="row"><p class="row-title">' + esc(r.name) + '</p>' +
        '<p>' + esc(r.what) + '</p></div>'
      );
    }).join('');

    return (
      '<h2 class="panel-head">Every free platform, ' + esc(REGION) + '</h2>' +
      '<p class="panel-lede">Legal, no-subscription services and what each one is actually for. ' +
      'The library-card tier is the one most people never use and it is the highest quality of the lot.</p>' +
      '<div class="chips">' + offerChips + '</div>' +
      '<div class="chips">' + deviceChips + '</div>' +
      section('The big free services', major) +
      section('Library card — free, ad-free, and better than the rest', library) +
      section('Public and nonprofit', pub) +
      section('Niche and specialist', niche) +
      (major.length + library.length + pub.length + niche.length === 0
        ? '<p class="empty">No platform matches those filters.</p>' : '') +
      '<h3 class="sec">Gone — stop looking for these</h3>' +
      '<div class="rows">' + retired + '</div>'
    );
  }

  function renderHidden() {
    var hidden = PLATFORMS.filter(function (p) { return p.hidden; });
    var deepCuts = TITLES.filter(function (t) {
      if (!allowed(t)) return false;
      for (var i = 0; i < (t.where || []).length; i++) {
        var p = platformById(t.where[i]);
        if (p && p.hidden) return true;
      }
      return false;
    });

    return (
      '<h2 class="panel-head">Hidden libraries</h2>' +
      '<p class="panel-lede">The services that do not advertise. Smaller catalogues, better curation, ' +
      'and in two cases better picture quality than anything else free.</p>' +
      '<div class="note"><strong>Start here:</strong> get a public library card. ' +
      'Kanopy and Hoopla together are the best free streaming in America — Criterion, A24, ' +
      'world cinema and documentaries, with no advertising at all. Most US libraries let you register ' +
      'online in a few minutes, and both services take the card immediately.</div>' +
      '<h3 class="sec">Platforms worth knowing about</h3>' +
      '<div class="grid">' + hidden.map(platformCard).join('') + '</div>' +
      '<h3 class="sec">What is actually on them</h3>' +
      (deepCuts.length
        ? '<div class="grid">' + deepCuts.map(titleCard).join('') + '</div>'
        : '<p class="empty">Switch to the Adults profile to see the deep cuts.</p>')
    );
  }

  function renderLive() {
    var blocks = LIVE.map(function (g) {
      var items = g.items.map(function (it) {
        var wheres = (it.where || []).map(function (id) {
          var p = platformById(id);
          return p ? '<a class="where-pill" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' : '';
        }).join('');
        return (
          '<div class="row' + (it.star ? ' star' : '') + '">' +
            '<p class="row-title">' + esc(it.name) + '</p>' +
            '<p>' + esc(it.note) + '</p>' +
            (wheres ? '<div class="where" style="margin-top:8px">' + wheres + '</div>' : '') +
          '</div>'
        );
      }).join('');
      return '<h3 class="sec">' + esc(g.group) + '</h3><div class="rows">' + items + '</div>';
    }).join('');

    return (
      '<h2 class="panel-head">Live TV, news and sport</h2>' +
      '<p class="panel-lede">Free live channels, legally. Read the antenna entry before you sign up for anything — ' +
      'for major live sport it beats every streaming option and costs nothing after the hardware.</p>' +
      blocks
    );
  }

  function renderFamily() {
    var kidTitles = TITLES.filter(function (t) { return t.age <= 10; });
    var teenTitles = TITLES.filter(function (t) { return t.age > 10 && t.age <= 15; });

    var controls = CONTROLS.map(function (c) {
      return (
        '<div class="row' + (c.star ? ' star' : '') + '">' +
          '<p class="row-title">' + esc(c.name) + ' <span class="card-meta">— ' + esc(c.tier) + '</span></p>' +
          '<p>' + esc(c.why) + '</p>' +
          '<ol class="steps">' + c.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
        '</div>'
      );
    }).join('');

    return (
      '<h2 class="panel-head">Family</h2>' +
      '<p class="panel-lede">Safe lists for a 6–12 year old and a teenager, plus the parental-control setup ' +
      'that actually holds up on shared hardware.</p>' +
      '<div class="note"><strong>The thing that matters most:</strong> your Roku has no user profiles, ' +
      'so per-app filters are the only in-app control and they do not cover the device as a whole. ' +
      'Set family DNS on the router — it is the one change that covers every screen in the house at once. ' +
      'Steps are below.</div>' +
      '<h3 class="sec">Safe for the 6–12 year old</h3>' +
      '<div class="grid">' + kidTitles.map(titleCard).join('') + '</div>' +
      '<h3 class="sec">Works for the teenager</h3>' +
      '<div class="grid">' + teenTitles.map(titleCard).join('') + '</div>' +
      '<h3 class="sec">Parental controls, in the order worth doing them</h3>' +
      '<div class="rows">' + controls + '</div>'
    );
  }

  /* ---------------------------------------------------------------- render */

  var RENDER = {
    tonight: renderTonight,
    watch: renderWatch,
    platforms: renderPlatforms,
    hidden: renderHidden,
    live: renderLive,
    family: renderFamily,
  };

  function render() {
    var host = $('#panels');
    host.innerHTML = '<section class="panel on">' + RENDER[state.tab]() + '</section>';

    var tabs = document.querySelectorAll('nav.tabs button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-pressed', String(tabs[i].dataset.tab === state.tab));
    }
    var profs = document.querySelectorAll('.profile-pick button');
    for (var j = 0; j < profs.length; j++) {
      profs[j].setAttribute('aria-pressed', String(profs[j].dataset.profile === state.profile));
    }
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- events */

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('button, a') : null;
    if (!el) return;
    var d = el.dataset || {};

    if (d.tab) { state.tab = d.tab; render(); return; }
    if (d.profile) { state.profile = d.profile; save(); render(); return; }

    if (d.mood !== undefined && el.classList.contains('mood')) {
      state.mood = state.mood === d.mood ? null : d.mood;
      render();
      return;
    }
    if (d.time !== undefined && d.time !== '') { state.time = Number(d.time); render(); return; }

    if (d.genre !== undefined && el.hasAttribute('data-genre')) {
      state.genreFilter = d.genre || null;
      render();
      return;
    }
    if (d.offer !== undefined && el.hasAttribute('data-offer')) {
      state.platformOffer = d.offer || null;
      render();
      return;
    }
    if (d.device !== undefined && el.hasAttribute('data-device')) {
      state.deviceFilter = d.device || null;
      render();
      return;
    }

    if (d.save) {
      state.saved[d.save] = !state.saved[d.save];
      save();
      render();
      return;
    }
    if (d.seen) {
      state.seen[d.seen] = !state.seen[d.seen];
      save();
      render();
      return;
    }
  }

  var searchTimer = null;
  function onSearch(e) {
    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = v.trim();
      if (state.tab !== 'watch' && state.tab !== 'platforms' && state.query) state.tab = 'watch';
      render();
      var box = $('#search');
      if (box && document.activeElement !== box) return;
    }, 180);
  }

  /* ---------------------------------------------------------------- boot */

  function boot() {
    load();
    $('#updated').textContent = CATALOG_UPDATED;
    document.addEventListener('click', onClick);
    $('#search').addEventListener('input', onSearch);
    render();

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* offline caching is a bonus, not a requirement */
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
