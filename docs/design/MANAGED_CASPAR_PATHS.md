# Managed Caspar configuration path boundary

## Observed dependency limit

The pinned CasparCG v2.5.1 binary passed a private Console VERSION request with an ASCII config argv path but failed with a Unicode config argv path. The two diagnostic cases used byte-identical ASCII XML, the same ASCII component cwd, the same renderer environment and native containment. Both closed containment. Evidence: PR36 diagnostic source30c2154, Windows job133025014712. This establishes a config-argument-path differential; it does not prove every possible Unicode component failure has the same cause.

Upstream src/shell/main.cpp takes narrow argv and converts argv[1] as UTF8. src/common/env.cpp obtains its initial directory as a wide filesystem path and reads config through wide filesystem/stream operations. Passing Unicode application/event paths through narrow argv and locale-decoded XML is therefore an avoidable boundary. The source and extracted application keep their original Unicode paths; the dependency binary is not patched or rebuilt.

## Managed event-only launch

The prepared-event runtime creates media/log/data/template directories and a fixed caspar.config inside its new private event directory. Its trusted config-generator call selects relative paths, making the XML independent of the absolute event directory and entirely ASCII (output names already require printable ASCII). Caspar receives only the ASCII caspar.config basename and the established logging arguments. Native CreateProcessW sets its actual cwd to the new private directory, so the basename and relative XML paths resolve there without putting the Unicode root into argv or XML.

The actual component executable is unchanged. Mesa presence checks remain beside that executable, not its cwd. The absolute NDI_RUNTIME_DIR_V6 environment remains intact. Upstream NDI first tries its initial folder and then its runtime environment fallback; this fallback is required with the private cwd. CEF does not set custom subprocess/resource/locales paths in Caspar's HTML initialization and uses its module defaults; the final real output regression must verify that those resources still load.

The native immutable production-window policy, private stdin forwarding, expiry retirement and closing/closed fences are unchanged. SPX and the legacy component launcher keep their prior cwd/argv behavior. Existing component cwd values remain validated; they cannot select or overwrite managed event configuration. No config is written beside the third-party executable.

## Generator compatibility

preparedCasparConfig(profile, absoluteDirectory) and an empty options object retain the original absolute-path XML. Only the trusted managed call supplies `{relativePaths:true}` with the real absolute directory. The option is boolean-only; unknown options are rejected; the original absolute CONFIG_DIRECTORY requirement remains. The relative paths are fixed internal names, not profile-supplied XML or command arguments.

## Acceptance and limits

Portable tests verify directory-independent ASCII managed XML under a Unicode event root; unchanged absolute default generation; option/relative-directory rejection; exact actual executable, ASCII argv, owned cwd and private forwarding; preserved SPX/NDI/Mesa behavior; foreign component config retention; and terminal native expiry without rearming. These tests use explicitly simulated process/Console boundaries and are not native output evidence.

Before merge, actual final-source Windows tests must pass both the checkout and unchanged Unicode-extracted eleven-frame scenarios, plus the native window/containment, SPX/OGraf, package, Caspar/Console and NDI regressions. Do not relax the extraction path, readiness deadline, frame checks or strict ownership capture to obtain green. The earlier source IMAGE_MISSING capture failure remains separately unproven even though a later unchanged-query run passed.

This boundary addresses Unicode application/private-event paths. It does not establish arbitrary Unicode external component/NDI runtime paths, target Windows10/sleep/LAN/Daktronics/DMP compatibility or evaluation-release readiness. No system clock, network, live hardware, signing or production installation changes occur.
