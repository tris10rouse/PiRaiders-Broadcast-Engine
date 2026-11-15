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
  function render() {
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
  $('event-select').addEventListener('change', event => { selected = event.target.value; render(); });
  $('prepare').addEventListener('click', () => { void mutate('prepare', { eventId: selected }); });
  $('activate').addEventListener('click', () => { void mutate('activate'); });
  $('discard').addEventListener('click', () => { void mutate('discard'); });
  for (const button of actions) button.addEventListener('click', () => { void mutate('command', { action: button.dataset.action }); });
  $('stop').addEventListener('click', () => { void mutate('command', { action: 'stop' }, true); });
  $('refresh-events').addEventListener('click', () => { void refreshCatalog(); });
  $('reload-page').addEventListener('click', () => location.reload());
  $('retry').addEventListener('click', () => { setConnection('loading'); void refreshState(); void refreshCatalog(); });
  if (!csrf) { setConnection('auth'); notice('Reload this page to restore authorized controls.', 'error'); }
  else { void refreshState(); void refreshCatalog(); }
})();
