'use strict';
const path = require('node:path');
const { normalizeRendererProfile } = require('./caspar-renderer.cjs');
const { normalizeWindow } = require('./production-window.cjs');
const { SlideshowController } = require('./slideshow-controller.cjs');
const { normalizeRossTalkConfig } = require('./rosstalk-protocol.cjs');

function invalid() { return Object.assign(Error('PROFILE_INVALID'), { code: 'PROFILE_INVALID' }); }
function plain(value) {
  return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function record(value, allowed, required = []) {
  if (!plain(value)) throw invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw invalid();
  // A profile is JSON data. Accessors/non-enumerable hidden values are not a
  // mechanism for passing trusted hooks through this configuration boundary.
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw invalid();
  }
  return value;
}
function stringArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string' ||
      (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) throw invalid();
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
        typeof descriptor.value !== 'string' || /[\x00-\x1f\x7f]/.test(descriptor.value)) throw invalid();
    result.push(descriptor.value);
  }
  return result;
}
function absolute(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value) || !path.isAbsolute(value)) throw invalid();
  return path.resolve(value);
}
function contains(root, candidate) {
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const relative = path.relative(canonical(root), canonical(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function disjoint(values) {
  for (let first = 0; first < values.length; first++) for (let second = first + 1; second < values.length; second++) {
    if (contains(values[first], values[second]) || contains(values[second], values[first])) throw invalid();
  }
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function normalizePreparedEventProfile(raw) {
  try {
    record(raw, ['schemaVersion', 'provider', 'eventId', 'productionWindow', 'spx', 'caspar', 'media',
      'playback', 'presentation', 'rossTalk', 'output'],
    ['schemaVersion', 'provider', 'eventId', 'productionWindow', 'spx', 'caspar', 'media', 'rossTalk']);
    if (raw.schemaVersion !== 1 || raw.provider !== 'local-manual' || typeof raw.eventId !== 'string' ||
        raw.eventId.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.eventId)) throw invalid();

    record(raw.productionWindow, ['start', 'end', 'prewarmMinutes'], ['start', 'end']);
    const window = normalizeWindow(raw.productionWindow);
    const productionWindow = { start: new Date(window.startMs).toISOString(), end: new Date(window.endMs).toISOString(),
      prewarmMinutes: window.prewarmMs / 60000 };

    record(raw.spx, ['executable', 'args', 'cwd'], ['executable', 'args', 'cwd']);
    const args = stringArray(raw.spx.args);
    const spx = { executable: absolute(raw.spx.executable), args, cwd: absolute(raw.spx.cwd) };
    record(raw.caspar, ['executable', 'cwd', 'runtimeDir', 'rendererProfile'], ['executable', 'cwd', 'runtimeDir']);
    const caspar = { executable: absolute(raw.caspar.executable), cwd: absolute(raw.caspar.cwd), runtimeDir: absolute(raw.caspar.runtimeDir) };
    const rendererProfile=normalizeRendererProfile(raw.caspar.rendererProfile);if(rendererProfile!==undefined)caspar.rendererProfile=rendererProfile;

    record(raw.media, ['provider', 'sourceDir', 'cacheDir', 'startup'], ['provider', 'sourceDir', 'cacheDir', 'startup']);
    if (raw.media.provider !== 'local-lexical-v1') throw invalid();
    const sourceDir = absolute(raw.media.sourceDir), cacheDir = absolute(raw.media.cacheDir);
    disjoint([sourceDir, cacheDir, caspar.runtimeDir]);
    record(raw.media.startup, ['mode', 'snapshotDir'], ['mode']);
    let startup;
    if (raw.media.startup.mode === 'source') {
      if (Object.hasOwn(raw.media.startup, 'snapshotDir')) throw invalid();
      startup = { mode: 'source' };
    } else if (raw.media.startup.mode === 'cached') {
      if (!Object.hasOwn(raw.media.startup, 'snapshotDir')) throw invalid();
      const snapshotDir = absolute(raw.media.startup.snapshotDir);
      // Filesystem aliases (including Windows 8.3 paths) are resolved by the
      // async factory, which enforces strict canonical cache membership before load.
      startup = { mode: 'cached', snapshotDir };
    } else throw invalid();
    const media = { provider: 'local-lexical-v1', sourceDir, cacheDir, startup };

    const playbackRaw = raw.playback === undefined ? {} : record(raw.playback, ['mode', 'intervalMs', 'transition']);
    if (playbackRaw.transition !== undefined) record(playbackRaw.transition, ['type', 'durationMs']);
    // PresentationHost's default command timeout is12000 and supplies a12500ms
    // controller handler timeout. Reuse that validator so its valid fades up to
    // 10000ms remain valid instead of imposing the standalone2000ms default.
    const controller = new SlideshowController({ ...playbackRaw, handlerTimeoutMs: 12500,
      deck: { id: 'profile-validation', slides: [{ id: 'profile-validation', src: 'profile-validation' }] },
      renderer: { show() {}, black() {} } });
    const playback = { mode: controller.mode, intervalMs: controller.intervalMs, transition: { ...controller.transition } };
    void controller.close();

    const presentationRaw = raw.presentation === undefined ? {} : record(raw.presentation, ['port']);
    const port = presentationRaw.port === undefined ? 0 : presentationRaw.port;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw invalid();

    record(raw.rossTalk, ['host', 'port', 'allowedSenders', 'commandMap', 'acknowledgements'], ['allowedSenders', 'commandMap']);
    stringArray(raw.rossTalk.allowedSenders);
    if (!plain(raw.rossTalk.commandMap)) throw invalid();
    record(raw.rossTalk.commandMap, Reflect.ownKeys(raw.rossTalk.commandMap));
    const transport = normalizeRossTalkConfig(raw.rossTalk, { allowEphemeral: false });
    // Do not pass legacy handlerTimeoutMs2000 to RossTalkSession. The owned
    // facade derives its larger resolver/prepare/render end-to-end budget.
    const rossTalk = { host: transport.host, port: transport.port, allowedSenders: [...transport.allowedSenders],
      commandMap: { ...transport.commandMap }, acknowledgements: transport.acknowledgements };

    const outputRaw = raw.output === undefined ? { type: 'none' } : raw.output;
    record(outputRaw, ['type', 'name', 'runtimeDirectory'], ['type']);
    let output;
    if (outputRaw.type === 'none') {
      if (Object.hasOwn(outputRaw, 'name') || Object.hasOwn(outputRaw, 'runtimeDirectory')) throw invalid();
      output = { type: 'none' };
    } else if (outputRaw.type === 'ndi') {
      if (typeof outputRaw.name !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(outputRaw.name) ||
          outputRaw.name.trim() !== outputRaw.name || !outputRaw.name.trim()) throw invalid();
      output = { type: 'ndi', name: outputRaw.name, runtimeDirectory: absolute(outputRaw.runtimeDirectory) };
    } else throw invalid();

    return freeze({ schemaVersion: 1, provider: 'local-manual', eventId: raw.eventId, productionWindow,
      spx, caspar, media, playback, presentation: { port }, rossTalk, output });
  } catch { throw invalid(); }
}
module.exports = { normalizePreparedEventProfile };
