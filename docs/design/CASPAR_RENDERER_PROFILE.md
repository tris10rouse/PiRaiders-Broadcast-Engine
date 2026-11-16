# Fixed Caspar reference renderer profile

## Contract

The optional machine field `caspar.rendererProfile` accepts only `mesa-llvmpipe-compat`; omission preserves the established environment. The strict machine and prepared-event schemas reject unknown strings, objects and arbitrary environment maps. Local catalog rows cannot select executable, renderer or environment policy. The normalized profile is copied and frozen before preparation.

This fixed profile sets precisely three renderer variables for the private owned Caspar process: GALLIUM_DRIVER=llvmpipe, LIBGL_ALWAYS_SOFTWARE=1 and MESA_GL_VERSION_OVERRIDE=4.5COMPAT. Case-insensitive filtering removes inherited Windows spelling collisions before adding canonical names; unrelated variables are preserved and the parent environment is never mutated. Persistent SPX and legacy launches receive no renderer override.

## Preflight and evidence limits

The preparation path checks a nonempty, regular, non-symbolic opengl32.dll beside the resolved Caspar executable, not its possibly different cwd. Failure returns MESA_RUNTIME_MISSING without paths or raw filesystem errors and occurs before native-clock sampling, media staging, private listeners or service creation. Omission adds no library requirement. This is an early presence check only: it is not a provenance/hash, loader, complete dependency, runtime version or GPU capability check. Pinned component preparation and actual received output remain separate evidence.

The existing immutable native event deadline is retained. Sampling still occurs once before staging at the real default Windows boundary; renderer policy never supplies clock/process hooks or bypasses containment. Caspar/Mesa/NDI remain external licensed components, and this increment introduces no dependency or binary redistribution.

## Validation and rollback

Portable tests cover strict schema and catalog authority, immutable selection, exact environment values/case collisions, omitted behavior, canonical executable versus cwd, malformed library types, safe errors and preparation side-effect ordering. Their injected child processes and synthetic DLL bytes are explicitly OS/file-boundary tests, not native output evidence. Final Windows application/output/package tests are required after integration. Windows10, loaded-driver identity, LAN/Daktronics/DMP and stadium compatibility are not claimed.

Rollback removes the optional profile handling and helper; configurations using the field must omit it again under the earlier strict schema. No system or global environment variable is changed by this implementation.
