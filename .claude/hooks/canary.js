#!/usr/bin/env node
/* SessionStart hook: adds the context line "HOOKS ON", so a run can tell whether this project's hooks loaded
 * (AGENTS.md › A run, step 1). Generic: nothing in it is specific to one project. */
'use strict';
const LINE = 'HOOKS ON';
function output() {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: LINE } };
}
module.exports = { output, LINE };
if (require.main === module) process.stdout.write(JSON.stringify(output()) + '\n');
