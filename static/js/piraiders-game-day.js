'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const csrf = document.querySelector('meta[name="piraiders-csrf"]')?.content || '';
  const actions = [...document.querySelectorAll('[data-action]')];
  const messages = {
    BUSY: 'Preparation or cleanup is still running. Keep the current content and try again when it finishes.',
    WINDOW_ACTIVE: 'The current production window protects event changes. Playback controls remain available.',
    STALE_SELECTION: 'The active event changed. Status is being refreshed; review it before trying again.',
    STALE_CANDIDATE: 'The prepared event changed. Review the current preparation before activating it.',
    CATALOG_INVALID: 'The local event configuration could not be read. Correct it, then refresh the event list.',
    PREPARE_FAILED: 'Media preparation failed. The last accepted content is retained. Check the local media, then prepare again.',
    RESOLVER_FAILED: 'Updated media could not be prepared. The last accepted content is retained.',
    RESOLVER_TIMEOUT: 'Media preparation did not finish in time. Check status before retrying.',
    CLOSE_FAILED: 'Service cleanup is not confirmed. Event replacement is blocked; check application diagnostics.',
    START_FAILED: 'The event could not start. Check its configuration and application diagnostics before preparing again.',
    CONTROL_INHIBITED: 'Playback is unavailable outside the production window or before the renderer is ready.',
    NOT_READY: 'The event controls are not ready. Wait for the renderer and check the production window.',
    CLOSED: 'The application is closing or has closed. Reopen it with the Windows launcher.',
    AUTH_REQUIRED: 'Access is no longer authorized. Sign in to SPX, then reload Game Day.',
    CSRF_DENIED: 'Page authorization expired. Reload Game Day before sending another command.',
    AUTH_POLICY_REQUIRED: 'SPX requires an authentication policy. Complete its configuration, then reload Game Day.',
    REQUEST_DENIED: 'This request was refused. Open Game Day directly on this computer using the Windows launcher.',
    NO_RESPONSE: 'No response was confirmed. Check the current status before retrying.',
    CONNECTION_LOST: 'Connection lost. The last received status is retained; reconnect before using playback controls.'
  };
  let state = null, events = [], selected = '', connection = 'loading', normal = null, stopping = null;
  let stateFlight = null, stateAgain = false, catalogFlight = null, timer = null, epoch = 0, intent = 0;
  let catalogError = false, catalogLoaded = false, focusAfter = null, accessIssue = null;
  const accessCodes = new Set(['AUTH_REQUIRED', 'CSRF_DENIED', 'AUTH_POLICY_REQUIRED', 'ORIGIN_DENIED', 'LOCAL_ONLY', 'FETCH_DENIED', 'REQUEST_DENIED']);
  const accessState = code => code === 'AUTH_REQUIRED' ? 'auth' : code === 'CSRF_DENIED' ? 'csrf' : code === 'AUTH_POLICY_REQUIRED' ? 'policy' : accessCodes.has(code) ? 'denied' : 'offline';
  function setText(id, value) { const element = $(id); if (element.textContent !== value) element.textContent = value; }
  function notice(text, tone = '') { setText('notice', text); $('notice').dataset.tone = tone; }
  const explain = code => messages[code] || 'The action could not be completed. Refresh status and check application diagnostics before retrying.';
  function setConnection(value) {
    if (['auth', 'csrf', 'policy', 'denied'].includes(value)) accessIssue = value;
    if (accessIssue) value = accessIssue;
    connection = value; $('connection').dataset.state = value;
    setText('connection', ({ loading: 'Connecting to application…', online: 'Connected to application', offline: 'Application connection lost', auth: 'Sign-in required', csrf: 'Page authorization expired', policy: 'SPX configuration required', denied: 'Request access refused' })[value]);
    $('connection-warning').hidden = value === 'online' || value === 'loading';
    $('retry').hidden = value !== 'offline';
    $('sign-in').hidden = value !== 'auth';
    $('configure-spx').hidden = value !== 'policy';
    $('reload-page').hidden = !accessIssue;
    const recovery = { auth: 'AUTH_REQUIRED', csrf: 'CSRF_DENIED', policy: 'AUTH_POLICY_REQUIRED', denied: 'REQUEST_DENIED', offline: 'CONNECTION_LOST' };
    if (recovery[value]) setText('connection-detail', explain(recovery[value]));
    render();
  }
  async function api(route, body, isCommand = false) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), body ? 120000 : 5000);
    try {
      const response = await fetch('/game-day/api/' + route, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', 'X-PiRaiders-CSRF': csrf } : { Accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      if (response.redirected) throw Object.assign(Error(), { code: 'AUTH_REQUIRED' });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Object.assign(Error(), { code: 'AUTH_REQUIRED' });
      const reader = response.body.getReader(), chunks = []; let length = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 131072) { await reader.cancel(); throw Error(); } chunks.push(value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (!value || typeof value.ok !== 'boolean') throw Error();
      if (!response.ok) {
        if (accessCodes.has(value.code)) throw Object.assign(Error(), { code: value.code });
        if (response.status === 401 || response.status === 403) throw Object.assign(Error(), { code: response.status === 401 ? 'AUTH_REQUIRED' : 'REQUEST_DENIED' });
        if (value.ok) throw Error();
      }
      return value;
    } catch (error) { throw Object.assign(Error(), { code: accessCodes.has(error.code) ? error.code : isCommand ? 'NO_RESPONSE' : 'CONNECTION_LOST' }); }
    finally { clearTimeout(timeout); }
  }
  function tuple() { return { expectedEventId: state.expectedEventId, expectedSelection: state.expectedSelection }; }
  function validState(value) { return value && typeof value === 'object' && Number.isSafeInteger(value.expectedSelection) && value.expectedSelection >= 0 && (value.expectedEventId === null || typeof value.expectedEventId === 'string'); }
  function schedule() { clearTimeout(timer); if (!accessIssue) timer = setTimeout(refreshState, connection === 'offline' ? 2500 : 1500); }
  function refreshState() {
    clearTimeout(timer);
    if (stateFlight) { stateAgain = true; return stateFlight; }
    const captured = epoch;
    stateFlight = api('state').then(value => {
      if (captured !== epoch) { stateAgain = true; return; }
      if (!value.ok || !validState(value.state)) throw Error();
      state = value.state; setConnection('online');
      if (!normal && !stopping && $('notice').textContent === 'Loading event status…') notice(state.active ? 'Active event controls are available.' : 'Select an event to prepare.');
    }).catch(error => { if (captured === epoch) setConnection(accessState(error.code)); })
      .finally(() => { stateFlight = null; if (stateAgain) { stateAgain = false; void refreshState(); } else schedule(); });
    return stateFlight;
  }
  function refreshCatalog() {
    if (catalogFlight) return catalogFlight;
    catalogError = false; $('refresh-events').disabled = true; $('refresh-events').setAttribute('aria-busy', 'true');
    catalogFlight = api('events').then(value => {
      if (!value.ok || !Array.isArray(value.events) || value.events.length > 128) throw Error();
      events = value.events.filter(row => row && typeof row.displayName === 'string' && (row.status === 'available' || row.status === 'invalid'));
      catalogLoaded = true; rebuildEvents();
    }).catch(error => { catalogError = true; if (accessCodes.has(error.code)) setConnection(accessState(error.code)); })
      .finally(() => { catalogFlight = null; $('refresh-events').disabled = false; $('refresh-events').removeAttribute('aria-busy'); render(); });
    return catalogFlight;
  }
  function rebuildEvents() {
    const available = events.filter(row => row.status === 'available' && typeof row.eventId === 'string');
    if (!selected && available.length) selected = available[0].eventId;
    const options = [];
    if (!available.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No events available'; option.disabled = true; options.push(option); }
    else if (selected && !available.some(row => row.eventId === selected)) { const option = document.createElement('option'); option.value = selected; option.textContent = 'Previously selected event unavailable'; option.disabled = true; options.push(option); }
    for (const row of events) { const option = document.createElement('option'); option.value = row.eventId || ''; option.disabled = row.status !== 'available'; option.textContent = row.status === 'available' ? row.displayName : 'Unavailable event' + (row.eventId ? ' · ' + row.eventId : ''); options.push(option); }
    $('event-select').replaceChildren(...options); $('event-select').value = selected;
  }
  function formatWindow(window) {
    if (!window) return 'Not configured';
    try { const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); return formatter.format(new Date(window.start)) + ' – ' + formatter.format(new Date(window.end)); }
    catch { return 'Not configured'; }
  }
  let render = function () {
    const active = state?.active, candidate = state?.candidate, runtime = active?.runtime;
    const online = connection === 'online' && !!state && !state.closed && !!csrf;
    const window = active?.productionWindow, now = Date.now();
    const policyWindow = window && now >= Date.parse(window.start) - (window.prewarmMinutes || 0) * 60000 && now < Date.parse(window.end);
    const protectedWindow = !!runtime?.windowAllowed || !!policyWindow;
    document.body.dataset.active = String(!!active || (state?.operation === 'activating' && !!candidate));
    const busy = !!normal || !!stopping || !!state?.operation || !!state?.preparing || !!state?.physicalBarrier;
    const selectedAvailable = events.some(row => row.eventId === selected && row.status === 'available');
    $('event-select').disabled = !catalogLoaded || !events.some(row => row.status === 'available');
    $('prepare').disabled = !online || busy || protectedWindow || !selectedAvailable || catalogError;
    $('prepare').textContent = normal === 'prepare' || state?.operation === 'preparing' ? 'Preparing media…' : 'Prepare selected event';
    $('prepare').setAttribute('aria-busy', String(normal === 'prepare' || state?.operation === 'preparing'));
    $('protection').hidden = !protectedWindow;
    const invalid = events.filter(row => row.status === 'invalid').length;
    setText('catalog-note', catalogError ? 'The event list could not be read. Check local configuration, then refresh the list.' : !catalogLoaded ? 'Reading the local event list.' : !events.some(row => row.status === 'available') ? 'Add a valid local event profile, then refresh this list.' : invalid ? invalid + ' event' + (invalid === 1 ? ' needs' : 's need') + ' attention. Check local configuration, then refresh.' : 'Selection prepares local media; it does not change active output.');
    $('candidate').hidden = !candidate;
    if (candidate) {
      setText('candidate-name', candidate.displayName); setText('candidate-version', typeof candidate.revision === 'string' ? candidate.revision.slice(0, 12) : 'Unavailable');
      setText('candidate-status', candidate.cleanup === 'open' ? 'Media prepared locally. Not activated.' : 'Preparation cleanup requires attention.');
    }
    $('activate').disabled = !online || !candidate || candidate.cleanup !== 'open' || busy || protectedWindow;
    $('discard').disabled = !online || !candidate || busy;
    $('activate').textContent = normal === 'activate' || state?.operation === 'activating' ? 'Activating…' : 'Activate event';
    setText('active-name', active ? active.displayName : 'Activate a prepared event');
    setText('active-detail', active ? active.cleanup === 'failed' ? 'Service cleanup is not confirmed. Event replacement is blocked.' : active.cleanup === 'closing' ? 'Closing this event’s services. Replacement waits for confirmed cleanup.' : runtime?.state === 'closed' ? 'This event is closed. Prepare another event when cleanup is complete.' : runtime?.ready ? 'Renderer acknowledged. Launch starts at slide 1.' : protectedWindow ? 'Waiting for the renderer. Playback begins only after Launch.' : 'Waiting outside the production window. SPX Graphics remains available.' : 'Prepare an event to begin.');
    const labels = { prepared: 'Prepared locally', waiting: 'Waiting', starting: 'Starting', ready: 'Renderer ready', closing: 'Closing', closed: 'Closed' };
    setText('runtime-state', active ? labels[runtime?.state] || 'Status unavailable' : 'No active event'); $('runtime-state').dataset.ready = String(runtime?.ready === true);
    setText('renderer-status', active ? active.cleanup !== 'open' || runtime?.state === 'closed' ? 'Not active' : runtime?.ready ? 'Acknowledged and ready' : protectedWindow ? 'Waiting for acknowledgment' : 'Waiting for production window' : 'Not started');
    setText('output-status', active ? runtime?.output === 'ndi' ? 'NDI configured' + (typeof runtime.sourceName === 'string' ? ' · ' + runtime.sourceName : '') : 'Output disabled' : 'No active event');
    const count = Number.isSafeInteger(runtime?.slideCount) && runtime.slideCount >= 1 && runtime.slideCount <= 500 ? runtime.slideCount : null;
    setText('slide-position', Number.isSafeInteger(runtime?.index) && runtime.index >= 0 ? 'Slide ' + (runtime.index + 1) + (count ? ' of ' + count : '') : count ? count + ' slides prepared · not playing' : 'No slide selected');
    setText('mode', runtime?.mode === 'auto' ? 'Automatic mode' : runtime?.mode === 'manual' ? 'Manual mode' : 'Mode unavailable');
    for (const button of actions) button.disabled = !online || busy || active?.cleanup !== 'open' || !runtime?.ready || (['previous', 'next'].includes(button.dataset.action) && runtime.index === null);
    $('auto').setAttribute('aria-pressed', String(runtime?.mode === 'auto')); $('manual').setAttribute('aria-pressed', String(runtime?.mode === 'manual'));
    // Stop has a separate request slot; normal/lifecycle work never disables it.
    $('stop').disabled = !csrf || !!accessIssue || !state || state.closed || !(active || (state.operation === 'activating' && candidate));
    $('stop').setAttribute('aria-busy', String(!!stopping));
    setText('window-range', active ? formatWindow(active.productionWindow) : 'No active event');
    setText('window-prewarm', active && Number.isFinite(active.productionWindow?.prewarmMinutes) ? active.productionWindow.prewarmMinutes + ' minutes' : 'Not configured');
    const failure = runtime?.lastError || state?.lastError;
    $('runtime-error').hidden = !failure; if (failure) setText('runtime-error', explain(failure));
    if (focusAfter && focusAfter.intent === intent && !normal) {
      const target = $(focusAfter.id); if (target && (focusAfter.id !== 'candidate-heading' || candidate)) { target.focus({ preventScroll: true }); focusAfter = null; }
    }
  }
  function mutate(route, extra = {}, stop = false) {
    if (!csrf || !state) { notice('Reload this page to restore authorized controls.', 'error'); return Promise.resolve(); }
    if (stop && stopping) return stopping;
    if (!stop && (normal || stopping || connection !== 'online')) return Promise.resolve();
    if (accessIssue) return Promise.resolve();
    const myIntent = ++intent; epoch++; const payload = { ...extra, ...tuple() };
    if (!stop && (route === 'activate' || route === 'discard')) payload.candidateId = state.candidate?.candidateId;
    if (!stop) normal = route === 'command' ? extra.action : route;
    notice(stop ? 'Requesting black output…' : route === 'prepare' ? 'Preparing local media. Current content is retained.' : route === 'activate' ? 'Activating the prepared event…' : route === 'discard' ? 'Discarding the prepared event…' : 'Sending playback command…');
    const pending = api(route, payload, true).then(value => {
      if (myIntent !== intent) return;
      if (!value.ok) { notice(explain(value.code), 'error'); return; }
      const success = { prepare: 'Media prepared. Review the event, then activate it.', activate: 'Event activated. Launch starts at slide 1.', discard: 'Prepared event discarded.', launch: 'Launch acknowledged.', next: 'Next slide acknowledged.', previous: 'Previous slide acknowledged.', auto: 'Automatic mode acknowledged.', manual: 'Manual mode acknowledged.', reload: 'Media reload acknowledged.', stop: 'Black output acknowledged. The sender remains governed by its production window.' };
      notice(success[route === 'command' ? extra.action : route], 'success');
      if (route === 'prepare' || route === 'activate') focusAfter = { id: route === 'prepare' ? 'candidate-heading' : 'playback-heading', intent: myIntent };
    }).catch(error => { if (myIntent === intent) { setConnection(accessState(error.code)); notice(explain(error.code), 'error'); } })
      .finally(() => { epoch++; if (stop) stopping = null; else normal = null; render(); void refreshState(); });
    if (stop) stopping = pending; render(); return pending;
  }
  // Source machine (BE-006 item 4b): browse the exchange catalog through the
  // source routes. Read-only: nothing here approves, prepares or plays, and
  // Stop keeps its own path. Pages are dropped when a newer refresh started.
  const sourceMode = document.body.dataset.mode === 'source';
  const PAGE = 25, HEX = /^[a-f0-9]{64}$/;
  const sourceMessages = {
    SOURCE_UNAVAILABLE: 'The exchange folder could not be reached. Check that the synced folder is on this PC, then refresh.',
    SOURCE_ROOT_MISMATCH: 'The exchange folder is not the one this PC was set up with. Nothing was read. Check this PC’s setup before refreshing.',
    CATALOG_REVISION_STALE: 'The exchange catalog changed since this list was read. Refresh to see the current events.',
    CATALOG_UNAVAILABLE: 'The exchange catalog is not available right now. Refresh to read it again.',
    CATALOG_EVENT_MISSING: 'That event is no longer in the exchange catalog. Refresh to see the current events.',
    BUSY: 'The exchange folder is being read. Try again in a moment.',
    SOURCE_SERVICE_CLOSED: 'The application is closing or has closed. Reopen it with the Windows launcher.',
    CONNECTION_LOST: 'No answer from the application. The list was not changed; refresh when the connection returns.'
  };
  const sourceText = code => sourceMessages[code] || 'The exchange catalog could not be read. Check the exchange folder, then refresh.';
  const src = { gen: 0, flight: null, pages: 0, seq: { events: 0, selections: 0 }, summary: null, events: [], eventsNext: null, eventKey: null, selections: [], selectionsNext: null, selectionId: null, problem: null, statusTimer: null };
  const str = (value, max = 200) => typeof value === 'string' && value.length <= max ? value : null;
  function validSummary(v) { return !!v && HEX.test(v.revision) && !!str(v.schoolYear, 32) && Number.isSafeInteger(v.eventCount) && v.eventCount >= 0 && Number.isSafeInteger(v.catalogSequence) && v.catalogSequence >= 0; }
  function validPage(v, revision, rows) { return !!v && v.ok === true && v.revision === revision && Array.isArray(v[rows]) && v[rows].length <= 64 && (v.nextOffset === null || Number.isSafeInteger(v.nextOffset)); }
  function eventRow(v) { return !!v && !!str(v.eventKey, 128) && !!str(v.displayName) && Number.isSafeInteger(v.selectionCount); }
  function selectionRow(v) { return !!v && !!str(v.selectionId, 128) && typeof v.displayLabel === 'string' && v.displayLabel.length <= 200 && !!str(v.targetBoardKey, 64) && Number.isSafeInteger(v.occurrenceCount) && v.occurrenceCount >= 0; }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const manifestLabels = { complete: 'Complete', incomplete: 'Incomplete', empty: 'No pictures', removed: 'Removed' };
  const currentEvent = () => src.events.find(row => row.eventKey === src.eventKey) || null;
  function boardName(event, selection) { const board = event?.eventBoard; return board && board.boardKey === selection.targetBoardKey && str(board.displayName) ? board.displayName : selection.targetBoardKey; }
  function eventMeta(row) { return [str(row.eventDate, 32), str(row.eventType), str(row.venue)].filter(Boolean).concat(plural(row.selectionCount, 'board button', 'board buttons')).join(' · '); }
  function choice(name, meta, key, kind) {
    const item = document.createElement('li'), button = document.createElement('button'), title = document.createElement('span'), detail = document.createElement('span');
    button.type = 'button'; button.dataset[kind] = key; button.setAttribute('aria-pressed', 'false');
    title.className = 'choice-name'; title.textContent = name || 'Unnamed button'; detail.className = 'choice-meta'; detail.textContent = meta;
    button.append(title, detail); item.append(button); return item;
  }
  function empty(text) { const item = document.createElement('li'); item.className = 'support'; item.textContent = text; return item; }
  function rebuildSourceEvents() { $('source-events').replaceChildren(...(src.events.length ? src.events.map(row => choice(row.displayName, eventMeta(row), row.eventKey, 'eventKey')) : [empty('This catalog has no events.')])); }
  function rebuildSelections() { const event = currentEvent(); $('source-selections').replaceChildren(...(src.selections.length ? src.selections.map(row => choice(row.displayLabel, 'Board ' + boardName(event, row) + ' · ' + plural(row.occurrenceCount, 'picture', 'pictures'), row.selectionId, 'selectionId')) : [empty('This event has no board buttons.')])); }
  function clearCatalog(problem) { src.gen++; src.summary = null; src.events = []; src.eventsNext = null; src.eventKey = null; src.selections = []; src.selectionsNext = null; src.selectionId = null; src.problem = problem; rebuildSourceEvents(); rebuildSelections(); }
  function renderSource() {
    setText('active-detail', 'Playback on this PC needs an approved exchange selection. Approval is not built yet.');
    const reading = !!src.flight, blocked = !csrf || !!accessIssue;
    $('source-refresh').disabled = reading || blocked; $('source-refresh').setAttribute('aria-busy', String(reading));
    $('source-refresh').textContent = reading ? 'Reading exchange…' : 'Refresh from exchange';
    setText('source-summary', reading ? 'Reading the scheduler’s exchange folder…' : src.summary ? 'School year ' + src.summary.schoolYear + ' · ' + plural(src.summary.eventCount, 'event', 'events') + ' · catalog ' + src.summary.catalogSequence : src.problem ? 'No exchange catalog is shown.' : 'Not read yet.');
    $('source-problem').hidden = !src.problem; if (src.problem) setText('source-problem-text', sourceText(src.problem));
    $('source-problem-refresh').hidden = !src.problem || reading || blocked || src.problem === 'SOURCE_SERVICE_CLOSED';
    $('source-events-block').hidden = !src.summary;
    $('source-more-events').hidden = src.eventsNext === null; $('source-more-events').disabled = src.pages > 0 || reading;
    const event = currentEvent(); $('source-event').hidden = !src.summary || !event;
    if (event) setText('source-event-detail', event.displayName + ' · ' + eventMeta(event));
    $('source-more-selections').hidden = src.selectionsNext === null; $('source-more-selections').disabled = src.pages > 0 || reading;
    for (const button of $('source-events').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.eventKey === src.eventKey));
    for (const button of $('source-selections').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.selectionId === src.selectionId));
    const chosen = event && src.selections.find(row => row.selectionId === src.selectionId);
    $('source-choice').hidden = !chosen;
    if (chosen) {
      setText('source-choice-event', event.displayName); setText('source-choice-board', boardName(event, chosen)); setText('source-choice-button', chosen.displayLabel || 'Unnamed button');
      setText('source-choice-pictures', plural(chosen.occurrenceCount, 'picture', 'pictures') + (manifestLabels[chosen.manifestState] ? ' · ' + manifestLabels[chosen.manifestState] : ''));
      setText('source-choice-generation', str(chosen.generation, 128) || 'Unavailable');
    }
  }
  // A page problem: a changed or withdrawn catalog empties the lists, so
  // nothing old stays selectable; a busy source keeps them.
  function pageProblem(code) {
    if (code === 'BUSY') src.problem = code;
    else if (code === 'CATALOG_EVENT_MISSING') { src.eventKey = null; src.selections = []; src.selectionsNext = null; src.selectionId = null; src.problem = code; rebuildSelections(); }
    else clearCatalog(code);
  }
  // Each list keeps only its newest request: an answer for an older request,
  // another event or an older refresh is dropped. "Show more" waits for idle.
  function sourcePage(kind, offset) {
    if (!src.summary || (offset > 0 && src.pages > 0)) return Promise.resolve();
    const gen = src.gen, revision = src.summary.revision, eventKey = src.eventKey, selections = kind === 'selections', seq = ++src.seq[kind];
    const body = selections ? { revision, eventKey, offset, limit: PAGE } : { revision, offset, limit: PAGE };
    src.pages++;
    const flight = api('source/' + kind, body).then(value => {
      if (gen !== src.gen || seq !== src.seq[kind] || (selections && eventKey !== src.eventKey)) return;
      if (!value.ok) { pageProblem(value.code); return; }
      if (!validPage(value, revision, kind) || (selections && value.eventKey !== eventKey)) { pageProblem('CATALOG_UNAVAILABLE'); return; }
      const rows = value[kind].filter(selections ? selectionRow : eventRow);
      if (src.problem === 'BUSY') src.problem = null;
      if (selections) { src.selections = offset ? src.selections.concat(rows) : rows; src.selectionsNext = value.nextOffset; rebuildSelections(); }
      else { src.events = offset ? src.events.concat(rows) : rows; src.eventsNext = value.nextOffset; rebuildSourceEvents(); }
    }).catch(error => { if (accessCodes.has(error.code)) setConnection(accessState(error.code)); else if (gen === src.gen && seq === src.seq[kind]) src.problem = 'CONNECTION_LOST'; })
      .finally(() => { src.pages--; render(); });
    render(); return flight;
  }
  function adopt(summary) {
    if (src.summary && src.summary.revision === summary.revision) { src.summary = summary; src.problem = null; return Promise.resolve(); }
    clearCatalog(null); src.summary = summary; return sourcePage('events', 0);
  }
  function refreshSource() {
    if (src.flight || !csrf || accessIssue) return src.flight || Promise.resolve();
    src.gen++; const gen = src.gen;
    src.flight = api('source/refresh', {}).then(value => {
      if (gen !== src.gen) return null;
      if (value.ok && validSummary(value.catalog)) return value.catalog;
      if (value.code === 'CATALOG_REFRESH_SUPERSEDED') return 'status';
      clearCatalog(value.ok ? 'CATALOG_UNAVAILABLE' : value.code); return null;
    }).catch(error => { if (accessCodes.has(error.code)) setConnection(accessState(error.code)); else clearCatalog('CONNECTION_LOST'); return null; })
      .finally(() => { src.flight = null; render(); });
    render();
    return src.flight.then(next => next === 'status' ? sourceStatus(true) : next ? adopt(next) : undefined);
  }
  // Status is the connection check on a source machine. A catalog read in
  // another tab with a different revision makes this list stale.
  function sourceStatus(adoptAvailable = false) {
    clearTimeout(src.statusTimer);
    return api('source/status').then(value => {
      if (!value.ok || !value.status || !value.catalog) throw Error();
      setConnection('online');
      const live = value.catalog.available === true && validSummary(value.catalog.catalog) ? value.catalog.catalog : null;
      if (src.flight || src.pages > 0) return;
      if (live && (adoptAvailable || !src.summary && !src.problem)) return adopt(live);
      if (src.summary && live && live.revision !== src.summary.revision) { clearCatalog('CATALOG_REVISION_STALE'); render(); }
      if (adoptAvailable && !live && !src.problem) { clearCatalog(value.status.catalog?.code === 'CATALOG_NOT_READ' ? null : 'CATALOG_UNAVAILABLE'); render(); }
    }).catch(error => setConnection(accessState(error.code)))
      .finally(() => { if (!accessIssue) src.statusTimer = setTimeout(() => void sourceStatus(), connection === 'offline' ? 2500 : 3000); });
  }
  if (sourceMode) {
    const renderLocal = render;
    render = () => { renderLocal(); renderSource(); };
    $('source-refresh').addEventListener('click', () => { void refreshSource(); });
    $('source-problem-refresh').addEventListener('click', () => { void refreshSource(); });
    $('source-more-events').addEventListener('click', () => { void sourcePage('events', src.eventsNext); });
    $('source-more-selections').addEventListener('click', () => { void sourcePage('selections', src.selectionsNext); });
    $('source-events').addEventListener('click', event => {
      const button = event.target.closest('button[data-event-key]'); if (!button || button.dataset.eventKey === src.eventKey) return;
      src.eventKey = button.dataset.eventKey; src.selections = []; src.selectionsNext = null; src.selectionId = null; if (src.problem === 'CATALOG_EVENT_MISSING') src.problem = null; rebuildSelections();
      void sourcePage('selections', 0).then(() => { if (src.eventKey === button.dataset.eventKey && !$('source-event').hidden) $('source-selections-heading').focus({ preventScroll: true }); });
    });
    $('source-selections').addEventListener('click', event => {
      const button = event.target.closest('button[data-selection-id]'); if (!button) return;
      src.selectionId = button.dataset.selectionId; render(); $('source-choice-heading').focus({ preventScroll: true });
    });
  }
  $('event-select').addEventListener('change', event => { selected = event.target.value; render(); });
  $('prepare').addEventListener('click', () => { void mutate('prepare', { eventId: selected }); });
  $('activate').addEventListener('click', () => { void mutate('activate'); });
  $('discard').addEventListener('click', () => { void mutate('discard'); });
  for (const button of actions) button.addEventListener('click', () => { void mutate('command', { action: button.dataset.action }); });
  $('stop').addEventListener('click', () => { void mutate('command', { action: 'stop' }, true); });
  $('refresh-events').addEventListener('click', () => { void refreshCatalog(); });
  $('reload-page').addEventListener('click', () => location.reload());
  $('retry').addEventListener('click', () => { setConnection('loading'); if (sourceMode) void sourceStatus(); else { void refreshState(); void refreshCatalog(); } });
  if (!csrf) { setConnection('auth'); notice('Reload this page to restore authorized controls.', 'error'); }
  else if (sourceMode) { notice('Browsing the exchange catalog. Playback on this PC is not available yet.'); void sourceStatus().then(() => { if (!src.summary && !src.problem && !src.flight && connection === 'online') return refreshSource(); }); }
  else { void refreshState(); void refreshCatalog(); }
})();
