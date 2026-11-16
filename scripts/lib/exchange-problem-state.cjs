'use strict';
// Detached draft0.3.1 state/problem subset. Never content readiness or arming.
const {canonicalExchangeJSON} = require('./exchange-fingerprints.cjs');
const {createExchangeSelectionIntegrityGate} = require('./exchange-selection-integrity.cjs');
const CAPS = Object.freeze({occurrences: 500, assets: 500, total_bytes: 536870912});
const RULES = Object.freeze(['V5', 'V20-selection-null-problem-scope', '5.2-board-unresolved', '5.2-selection-limit']);
const PENDING = Object.freeze(['calendar-window', 'asset-bytes', 'durable-ledger', 'eligibility-admission', 'descriptor-context']);
const CODES = new Set(['PROBLEM_INPUT_INVALID', 'PROBLEM_PREREQUISITE_INVALID',
  'PROBLEM_STATE_INVALID', 'PROBLEM_SCOPE_INVALID', 'PROBLEM_BOARD_INVALID', 'PROBLEM_LIMIT_INVALID']);
function fail(code) { throw Error(code); }
function result(code) {
  return Object.freeze({ok: code === 'PROBLEM_STATE_VALID', code, scope: 'selection-problem-state',
    ready: false, semanticValidation: 'pending',
    verifiedRules: code === 'PROBLEM_STATE_VALID' ? RULES : Object.freeze([]), pending: PENDING});
}
function selectionLimit(problem) {
  return problem.code === 'LIMIT_EXCEEDED' && Object.hasOwn(CAPS, problem.detail);
}
function verify(manifest) {
  for (const problem of manifest.problems) {
    // V20 concerns selection-level entries; schema already validates code/detail pairs.
    if (problem.occurrenceKey === null && problem.code !== 'BOARD_UNRESOLVED' && !selectionLimit(problem)) fail('PROBLEM_SCOPE_INVALID');
  }
  for (const row of manifest.occurrences) {
    if (row.problem !== null && selectionLimit(row.problem)) fail('PROBLEM_SCOPE_INVALID');
  }
  const limit = manifest.problems.find(selectionLimit);
  if (limit) {
    // Existing schema enforces incomplete + empty rows/assets + exactly this one
    // null-key diagnostic. Verify declared policy, not discarded source data.
    if (limit.limit !== CAPS[limit.detail] || limit.observed <= limit.limit) fail('PROBLEM_LIMIT_INVALID');
    return;
  }
  const hasBoardProblem = manifest.problems.some(problem => problem.code === 'BOARD_UNRESOLVED') ||
    manifest.occurrences.some(row => row.problem?.code === 'BOARD_UNRESOLVED');
  const activeBlankEventBoard = manifest.button.origin === 'event' && manifest.board.boardKey === null &&
    ['complete', 'incomplete'].includes(manifest.manifestState);
  if (hasBoardProblem || activeBlankEventBoard) {
    if (manifest.button.origin !== 'event' || manifest.manifestState !== 'incomplete' || manifest.assets.length !== 0 ||
        manifest.problems.length !== 1 || manifest.problems[0].code !== 'BOARD_UNRESOLVED' ||
        manifest.problems[0].occurrenceKey !== null ||
        manifest.occurrences.some(row => row.assetKey !== null || row.problem?.code !== 'BOARD_UNRESOLVED')) fail('PROBLEM_BOARD_INVALID');
    return;
  }
  if (manifest.manifestState === 'incomplete') {
    const listed = new Set(manifest.problems.filter(problem => problem.occurrenceKey !== null).map(problem => problem.occurrenceKey));
    if (!manifest.occurrences.some(row => row.assetKey === null && (row.problem !== null || listed.has(row.occurrenceKey)))) fail('PROBLEM_STATE_INVALID');
  }
}
function createExchangeProblemStateGate() {
  let integrity;
  try { integrity = createExchangeSelectionIntegrityGate(); }
  catch { throw Error('PROBLEM_BACKEND_UNAVAILABLE'); }
  return Object.freeze({validate(value) {
    try {
      let manifest;
      try { manifest = JSON.parse(canonicalExchangeJSON(value)); }
      catch { fail('PROBLEM_INPUT_INVALID'); }
      if (!integrity.validate(manifest).ok) fail('PROBLEM_PREREQUISITE_INVALID');
      verify(manifest);
      return result('PROBLEM_STATE_VALID');
    } catch (error) {
      return result(CODES.has(error?.message) ? error.message : 'PROBLEM_INPUT_INVALID');
    }
  }});
}
module.exports = {createExchangeProblemStateGate};
