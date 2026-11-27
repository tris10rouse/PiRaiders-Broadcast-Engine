'use strict';
// BE-006 item 5a part 1: the synthetic exchange folder of the Windows proofs.
// Since Q-031 the generator lives in scripts/lib/demo-exchange.cjs, so the
// ZIP carries it for the bench test; this name stays for the proofs and tests.
module.exports=require('./lib/demo-exchange.cjs');
