# ADR 0002: Contain Windows services in kill-on-close Job Objects

Status: Implemented for Windows CI verification; selected CasparCG and Windows 10 deployment validation remain release gates.

## Problem

The Node supervisor could lose service descendants when their root process crashed. `taskkill /T` against a tracked live root cannot reliably recover a tree whose original root is already gone. Abrupt launcher termination also bypasses JavaScript signal handlers.

## Decision

Each Windows service runs under a small native Win32 Job Object host. Create the service suspended, set JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, assign before execution, then resume. Children remain in the job with no breakaway flag. Root exit terminates the job and waits for zero active processes before the host exits and the supervisor can restart. Forced host termination closes its noninheritable job handle, giving the kernel ownership of descendant termination. A private stdin pipe from Node detects launcher loss; the service receives NUL stdin and only duplicated stdout/stderr through an explicit inherited-handle list.

The C# host uses P/Invoke against Windows kernel APIs and the installed .NET Framework v4 runtime/compiler. This introduces no downloaded third-party library or installer dependency. `npm run setup` builds it on Windows, tests it, and CI retains a component artifact. Source remains under the repository MIT license. No compiled binary is committed. Windows startup fails closed if the helper is missing or containment cannot be established; no automatic uncontained fallback is permitted. Non-Windows direct spawning is preserved for development.

## Semantics and verification

The supervisor tracks the host PID; a host spawn event does not prove service or NDI readiness. Target command/arguments are forwarded without a shell, with explicit application path and Windows command-line quoting. Normal root exit is propagated after confirmed cleanup; lifetime-pipe loss uses diagnostic exit 252. Errors before assignment terminate the still-suspended root. Normal cleanup has a bounded wait and surfaces failures; handle close remains a kernel fallback.

Real Windows tests must independently prove root-crash, host-only kill, launcher-only kill and pipe EOF cleanup, exact argv/cwd forwarding, missing helper/target failure and native CreateProcess failure. Mocked adapter tests run everywhere; Linux explicitly skips kernel tests. A deliberately denied assignment inside a restrictive outer job is not yet exercised. CasparCG may create nested jobs, so its selected binary needs separate off-air validation. Timer/OS scheduling and process ownership do not establish packet-level NDI deadlines or receiver compatibility.

## Rollback

Revert the containment increment for development only. The prior launcher has an orphan-process safety gap and must not become a production fallback. Do not disable the host to bypass an assignment or startup error; diagnose the compiler, helper path and outer Windows job policy.
