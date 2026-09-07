# CUR-35 — Teardown: how Trigger.dev builds its CLI

Research for [CUR-34, "Map: Radius CLI, rebuilt on proven foundations"](https://linear.app/curve-ai/issue/CUR-34).

**Subject.** `triggerdotdev/trigger.dev`, `packages/cli-v3`, published to npm as `trigger.dev`, binary `trigger`.
**Commit read.** `0a23814a0896205da227520bd417bd490a017379` (2026-09-05), package version **4.5.16**.
**Method.** Sparse clone of the real tree, read directly. No marketing docs were used as evidence. Every claim below cites a file under `packages/cli-v3/`.

**Scale, for calibration.** 140 non-test source files, **~32,970 LOC**; 18 test files, 3,633 LOC. Radius `packages/cli` is 31 files, ~6,750 LOC total including tests. Trigger.dev's CLI is roughly 5x the size — but a large fraction of that (`src/mcp/`, `src/entryPoints/`, `src/build/`) is not "CLI" at all, and the parts Radius would actually copy are surprisingly small: **`src/cli/common.ts` is 95 lines**.

---

## 1. Framework and command structure

**Arg parser: `commander` ^9.4.1.** Not oclif, not yargs, not clipanion. This is worth registering — Trigger.dev is a mature, heavily-used CLI and it deliberately uses the plainest possible parser rather than a "CLI framework" with plugin loading and command auto-discovery.

**Registration is a hand-written, explicit list.** `src/cli/index.ts` (52 lines) is the whole thing:

```ts
export const program = new Command();
program
  .name(COMMAND_NAME)
  .description("Create, run locally and deploy Trigger.dev background tasks.")
  .version(VERSION, "-v, --version", "Display the version number");

configureLoginCommand(program);
configureInitCommand(program);
configureDevCommand(program);
configureEnvCommand(program);
configureDeployCommand(program);
configurePromoteCommand(program);
configureWhoamiCommand(program);
configureMintTokenCommand(program);
configureLogoutCommand(program);
configureListProfilesCommand(program);
configureSwitchProfilesCommand(program);
configureUpdateCommand(program);
configurePreviewCommand(program);
configureProjectsCommand(program);
configureAnalyzeCommand(program);
configureMcpCommand(program);
configureReportCommand(program);
configureInstallMcpCommand(program);
configureSkillsCommand(program);

installExitHandler();
```

There is **no dynamic discovery, no glob, no plugin registry**. Each command file exports exactly one `configureXCommand(program: Command)` function that owns its own flags, its own zod options schema, and its own action. Nineteen commands, nineteen imports, one call each. Adding a command is two lines in one file.

The entry point `src/index.ts` is 18 lines: shebang, `await program.parseAsync()`, and a `.catch` that logs and `process.exit(1)`.

**Shared options are factored out by function, not inheritance.** `src/cli/common.ts`:

```ts
export const CommonCommandOptions = z.object({
  apiUrl: z.string().optional(),
  logLevel: z.enum(["debug","info","log","warn","error","none"]).default("log"),
  skipTelemetry: z.boolean().default(false),
  profile: z.string().default(readAuthConfigCurrentProfileName()),
});

export function commonOptions(command: Command) {
  return command
    .option("--profile <profile>", "The login profile to use", readAuthConfigCurrentProfileName())
    .option("-a, --api-url <value>", "Override the API URL", CLOUD_API_URL)
    .option("-l, --log-level <level>", "The CLI log level to use (debug, info, log, warn, error, none). ...", "log")
    .option("--skip-telemetry", "Opt-out of sending telemetry");
}
```

The **pairing is the point**: `commonOptions(cmd)` adds the commander flags, `CommonCommandOptions` is the zod schema those flags parse into, and every command does `CommonCommandOptions.extend({ ...its own })`. Commands opt in by wrapping: `commonOptions(program.command("init")...)`. Commands that don't want them (`update`, `switch`, `list-profiles`, `analyze`) `.pick()` a subset and re-declare flags by hand.

**Help is entirely commander's**, with per-command `.summary()` (short, for the top-level list) and `.description()` (long, shown on `--help` for that command). The good practice worth stealing: `init` embeds a **worked example block** in its description, including the non-interactive and headless variants (`src/commands/init.ts:66-84`):

```
Examples:
  # Interactive setup
  $ trigger.dev init
  # Non-interactive (CI / scripts)
  $ trigger.dev init --yes --project-ref proj_abc123
  # Headless / agent (no browser)
  $ trigger.dev init --yes --project-ref proj_abc123 --no-browser
  # Use a named profile
  $ trigger.dev init --profile staging
```

Internal flags are hidden rather than removed: `new CommandOption("--git-ref <git ref>", ...).hideHelp()`, and whole commands can be hidden — `.command("analyze [dir]", { hidden: true })`.

**Against Radius today.** `packages/cli/src/main.ts` is a 492-line `if (command === "...")` chain with a `parseArgs({ options: {...} })` literal repeated per command and a hand-maintained `helpText()` template string that is already drifting (it documents `radius login --api-url` while `--config`/`--profile` appear inconsistently across commands). Every shared flag — `--config`, `--profile`, `--organization`, `--environment`, `--json` — is re-declared at each of thirteen call sites with no single definition. There is no `-h` per command; `radius dev --help` is parsed as an unknown option and throws.

---

## 2. Config resolution

**Loader: `c12`** (`unjs`), with `defu` for merging and `magicast` for AST-level rewriting. `src/config.ts` (428 lines).

- **Discovery**: `c12.loadConfig<TriggerConfig>({ name: "trigger", cwd, configFile, jitiOptions })`. `name: "trigger"` gives `trigger.config.{ts,mts,cts,js,mjs,cjs,json}` in `cwd`. It does **not** search upward to parent directories. `--config <path>` pins a specific file.
- **TS evaluation**: c12 delegates to **jiti**, which transpiles and executes the TS config in-process. There is no separate esbuild pass for *loading*. (`esbuild` appears in `config.ts` only for `configPlugin()`, a different job — see below.)
- **Validation is NOT zod.** The config is typed as `TriggerConfig` from `@trigger.dev/core/v3` — a compile-time type only. Runtime checking is a hand-rolled `validateConfig()` that emits deprecation warnings for renamed fields (`triggerDirectories`→`dirs`, `tsconfigPath`→`tsconfig`, `additionalFiles`, `additionalPackages`, `dependenciesToBundle`, `resolveEnvVars`) and enforces exactly one hard requirement:
  ```ts
  if (!config.maxDuration) throw new Error(`The "maxDuration" trigger.config option is now required, and must be at least 5 seconds.`);
  ```
- **No schema version, no migration** on `trigger.config.ts`. Evolution is handled by silently rewriting old field names with a `prettyWarning`. Notably, the **auth** config file *does* have `version: z.literal(2)` and a real migration from a flat v1 map (`src/utilities/configFiles.ts`) — so the team knows how to version a file format and chose not to for the user-facing config.
- **Missing config is a hard, actionable error**, not a silent default (`src/config.ts`):
  ```ts
  const missingConfigFile = !result.configFile || result.configFile === "trigger.config";
  if (missingConfigFile) throw new OutroCommandError([
    "Couldn't find your trigger.config.ts file.", ...,
    "Alternatively, you can initialize a new project using `npx trigger.dev@latest init`.",
  ].join("\n"));
  ```
- **Precedence via `defu`** (leftmost defined value wins):
  ```ts
  defu(
    { workingDir, runtime, configFile, packageJsonPath, tsconfigPath, lockfilePath, workspaceDir }, // computed facts
    overrides,   // caller-supplied, this is where CLI flags land
    config,      // trigger.config.ts
    { dirs, runtime: legacyDefaultRuntime, tsconfig, build: {...}, compatibilityFlags: [], features } // defaults
  )
  ```
  Crucially, **`loadConfig` does not itself know about CLI flags**. The *caller* collapses flag-vs-env before handing in `overrides`, e.g. `whoami.ts`: `loadConfig({ overrides: { project: options?.projectRef ?? envVars.TRIGGER_PROJECT_REF } })`. So flag > env > config file > default, but the flag/env half is decided per-command. That's a seam Radius should make explicit rather than inherit.
- **`configPlugin()` / `magicast`** is a genuinely clever trick: when the user's config file gets bundled into the deployed worker, an esbuild plugin rewrites the module AST to strip the `build` key and `resolveEnvVars` export, so build-time-only dependencies (build extensions) never end up in the runtime bundle. Radius has the same latent problem the moment `radius.config.ts` imports anything.
- **`.env` loading** (`src/utilities/dotEnv.ts`): fixed list `[".env", ".env.development", ".env.local", ".env.development.local", "dev.vars"]`, all passed to `dotenv.config({ path: [...] })`. `--env-file` replaces the list. Then `resolveDotEnvVars()` deliberately **deletes** `TRIGGER_API_URL`, `TRIGGER_SECRET_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT` from the result ("those should be coming from the worker") and renames `OTEL_RESOURCE_ATTRIBUTES`→`CUSTOM_OTEL_RESOURCE_ATTRIBUTES`. In `resolveLocalEnvVars`, **`.env` file values win over real `process.env`** — a defensible but surprising choice, and one Radius should decide consciously.
- **`dirs` auto-detection**: if unset, recursively walk `workingDir` collecting directories literally named `trigger`, skipping `node_modules`, `.git`, `dist`, `out`, `build`, dotfolders, and `app/api/trigger`.

**Against Radius today.** `packages/cli/src/config.ts` is 83 lines and, for its size, in better shape than Trigger.dev's in one respect: it **does** validate at runtime with `AgentConfigSchema.parse()` and it **does** carry `schemaVersion: 1`. Its weaknesses are different: it accepts six filenames including `pyproject.toml` with first-match-wins and no diagnostic when two exist; it uses `tsx/esm/api`'s `tsImport` directly (with a visible hack unwrapping a doubly-nested `default`) where c12/jiti is the maintained solution; and it has no override/merge layer at all — CLI flags are threaded as separate function arguments (`options.endpoint ?? config.development?.endpoint`) scattered across `dev.ts`, `build.ts`, `deploy.ts`, so precedence is re-implemented per call site and is untestable as a unit.

---

## 3. `dev` mechanics — the most valuable section

This is where the two products diverge most, and where the analogy needs care. **Trigger.dev's `dev` runs the user's code as child processes of the CLI and pulls work from the platform. Radius's `dev` does not run the user's agent at all** — it writes a JSON registration file and launches a desktop app that connects to a process the developer started separately. The mechanisms below are therefore not all transferable, but the *supervision discipline* is.

### 3.1 Process topology

Four tiers, all rooted at the single `trigger dev` process:

1. **CLI main** — runs `DevSupervisor` (`src/dev/devSupervisor.ts`, **952 lines**, the largest single file in the dev subsystem), the esbuild watch context, and the socket.
2. **Watchdog** (`src/dev/devWatchdog.ts`, 204 lines) — `spawn(process.execPath, [watchdogScript], { detached: true, stdio: "ignore" })` then `.unref()`. Discussed in 3.5.
3. **Indexer** — one-shot `fork()` per build, entry `src/entryPoints/dev-index-worker.ts`. Imports the freshly built bundle so task definitions self-register, then sends `INDEX_COMPLETE` over IPC and exits. Not pooled.
4. **Task-run workers** — pooled, long-lived `fork()`s, entry `src/entryPoints/dev-run-worker.ts`, spawned by `TaskRunProcess.initialize()` (`src/executions/taskRunProcess.ts:159`) with `{ stdio: [ignore, pipe, pipe, "ipc"], serialization: "json" }`.

**All parent↔child messaging is `ZodIpcConnection`** over Node's `fork` IPC channel, with named, Zod-validated message catalogs in both directions — `WorkerToExecutorMessageCatalog` (`EXECUTE_TASK_RUN`, `CANCEL`, `FLUSH`, `RESOLVE_WAITPOINT`) and `ExecutorToWorkerMessageCatalog` (`TASK_RUN_COMPLETED`, `TASK_HEARTBEAT`, `UNCAUGHT_EXCEPTION`, `SEND_DEBUG_LOG`, `SET_SUSPENDABLE`, `MAX_DURATION_EXCEEDED`). Child stdout/stderr are **piped separately**, not sent over IPC — so log lines can be prefixed and interleaved without competing with the control channel. **This split (typed control channel + raw piped output) is the single most copyable idea in the dev subsystem.**

**Warm starts.** `TaskRunProcessPool` (`src/dev/taskRunProcessPool.ts`, 359 lines) keys pools by worker *version*, with `maxPoolSize` 25 and `maxExecutionsPerProcess` 50, a 30s idle-kill timer, and a `forceKill` path when `isOOMRunError` is detected (mirroring production's fresh-container-on-OOM). Reused processes get `isWarmStart: true` and `TRIGGER_WARM_START` in env. Run concurrency is limited separately by a `pLimit(maxConcurrentRuns)` — **pool size and concurrency are deliberately different knobs**.

### 3.2 Transport to the platform — three channels, not one

This is the part most likely to be misread from the docs. There are **three** independent channels:

**(a) Socket.IO, for notifications only.** `DevSupervisor.#createSocket()`:
```ts
const wsUrl = new URL(this.options.client.apiURL);
wsUrl.pathname = "/dev-worker";
const socket = io(wsUrl.href, {
  transports: ["websocket"],
  extraHeaders: { Authorization: `Bearer ${accessToken}` },
});
```
Handshake auth is a **bearer token in `extraHeaders`**, which only works because `transports: ["websocket"]` disables the HTTP long-polling fallback. Server→client: `run:notify {version, run}`. Client→server: `run:subscribe {version:"1", runFriendlyIds}` / `run:unsubscribe`. On `connect`, **every active run controller is re-subscribed** — subscription state is treated as ephemeral and rebuilt from local truth, never assumed to survive. On `disconnect`, if `reason === "io server disconnect"` it calls `socket.connect()` manually, because socket.io does not auto-retry server-initiated disconnects.

**(b) SSE, for presence.** `CliApiClient.devPresenceConnection()` opens `${engineURL}/engine/v1/dev/presence` using the `eventsource` polyfill (needed for custom auth headers). This is the "this dev session is alive" signal that lights up the dashboard. Separate from run execution, separate from the socket.

**(c) HTTP polling, for the actual work.** `#dequeueRuns()` (`devSupervisor.ts:426-595`) is a **self-rescheduling `setTimeout` loop** calling `client.dev.dequeue({ currentWorker, oldWorkers: [] })`, rescheduling at `dequeueIntervalWithRun` or `dequeueIntervalWithoutRun` — **both intervals supplied by the server** via `/engine/v1/dev/config`. The socket does *not* deliver work. Per-run state is likewise polled: `DevRunController` runs a 5s `IntervalService` calling `getRunExecutionData(runId)`, and the socket's `run:notify` merely calls `resetCurrentInterval()` to short-circuit the next poll.

**The design principle: polling is the mechanism, push is the optimisation.** Correctness never depends on the socket. If the WebSocket dies permanently, `dev` still works, just with 5s latency. Server-supplied poll intervals mean the platform can back the whole fleet off without a CLI release. For Radius — whose `dev` currently has *no* liveness channel at all, only a file on disk — this is the important lesson, not the socket itself.

### 3.3 Session identity

There is no long-lived "dev session" record. Identity is the **BackgroundWorker version**, a server-assigned string. `initializeWorker()` POSTs `createBackgroundWorker(project, { localOnly: true, engine: "V2", supportsLazyAttempts: true, metadata: { tasks, prompts, queues, contentHash, sourceFiles, runtime } })` and the server returns `serverWorker.id` / `serverWorker.version`. `localOnly: true` is what keeps a dev worker from ever becoming a deployment. That version keys the process pool and tags every log line.

Rebuild with an identical `contentHash` short-circuits entirely (`workerSkipped` event) — **content-addressed no-op on rebuild**.

Heartbeats are **per run, not per session**: the child sends `TASK_HEARTBEAT` over IPC, the controller forwards `heartbeatRun(runId, snapshotId, {cpu: 0, memory: 0})` — cpu/memory hardcoded to zero in dev.

### 3.4 Reload

- **Config file change → full session restart.** `watchConfig()`'s `onUpdate` stops the `DevSessionInstance` and calls `bootDevSession()` again (`src/commands/dev.ts:288-296`). No attempt at partial config reload.
- **Source change → esbuild incremental watch**, not chokidar. `bundleWorker({ watch: true })`; the `onEnd` plugin is the rebuild trigger. esbuild provides the debouncing natively.
- **A failed rebuild changes nothing.** `onEnd` checks `errors.length` and **returns without touching runtime state** — the previously working worker keeps serving. This is the correct behaviour and it is one line of discipline.
- **In-flight runs are never killed on reload.** The new build registers a new version; the old version is marked deprecated and deleted 5s after its last active run drains. Up to `MAX_DEPRECATED_WORKERS = 2` old versions are retained concurrently, because the server may still dispatch a run against a version that was superseded microseconds ago. New dequeues immediately use `latestWorkerId`. **Versioned workers with a drain window is how you get zero-downtime reload**, and it only works because the artifact is content-addressed and versioned.

### 3.5 Crash recovery — `devWatchdog.ts` and `lock.ts`

Two small files that carry most of the robustness, and both are directly applicable to Radius.

**`lock.ts` (104 lines) — single instance per branch.** Lockfile at `.trigger/dev[.branch].lock` containing the PID. On startup, if a lockfile exists with a *different live* PID, the new process **kills the old one** and polls up to 5s for the lockfile to vanish before proceeding. Same PID is a no-op. Removal is guaranteed on every exit path via `signal-exit`'s `onExit`. Note the policy choice: **the newcomer wins**, rather than refusing to start. For a dev command that's the right call — a developer re-running `dev` means they want the new one.

**`devWatchdog.ts` (204 lines) — the orphan reaper.** A detached, unref'd, PID-file-guarded process that polls `WATCHDOG_PARENT_PID` every second via `process.kill(pid, 0)`. When the parent disappears — `pnpm` SIGKILLing the process tree, a terminal window closed, an OOM kill — the watchdog reads `active-runs<branch>.json` (kept current by the supervisor on every controller add/remove) and `POST`s `/engine/v1/dev/disconnect` with those run IDs, retried 5x with exponential backoff from 500ms. So the platform marks those runs disconnected immediately rather than waiting for a heartbeat timeout. It also cleans the branch's tmp build dir if no live session owns it, and has a **24h max lifetime** so PID reuse can't create an immortal zombie. On a *clean* shutdown, the supervisor explicitly SIGTERMs the watchdog, since the disconnect call is unnecessary.

This is the answer to "what happens when the CLI dies in a way it can't handle." It is ~200 lines and it is the difference between a platform that knows its state and one that guesses.

Other failure paths:
- **User code throws**: both worker entry points install `process.on("uncaughtException")` that sends an `UNCAUGHT_EXCEPTION` IPC message *instead of* dying — the comment explains that otherwise `run()` hangs until `maxDuration`. Parent rejects pending attempts and does SIGTERM→SIGKILL escalation.
- **Process exits unexpectedly**: `#handleExit()` discriminates deliberate kills from real crashes, producing `MaxDurationExceededError`, `CancelledProcessError`, `GracefulExitTimeoutError`, `SuspendedProcessError`, `CleanupProcessError`, or `UnexpectedExitError(code, signal, stderrTail)` — **with the last 100 buffered stderr lines attached to the error**.
- **Platform unreachable**: `#dequeueRuns()` catches everything, logs at `debug`, and reschedules. Infinite soft-retry, no crash — and, arguably a flaw, **no user-visible message by default**; a developer whose network is down sees a silent CLI.

### 3.6 Terminal UI

**There is no TUI framework.** No ink, no blessed, no alternate screen buffer. Output is a plain sequential log stream via `logger.log()` with `chalk` helpers from `src/utilities/cliOutput.ts` (`chalkGrey`, `chalkError`, `chalkTask`, `chalkWorker`, `chalkRun`), plus OSC-8 clickable hyperlinks gated on `supportsHyperlinks`. `@clack/prompts` is used only for the interactive setup prompts and spinners, never for the running session.

The architecture worth copying is the **`eventBus`** (`src/utilities/eventBus.ts`, a typed `node:events` EventEmitter). `startDevOutput()` (`src/dev/devOutput.ts`, 291 lines) is a **pure subscriber** — the build system, supervisor, and socket layer emit `rebuildStarted`, `buildFailed`, `backgroundWorkerIndexingError`, `backgroundWorkerInitialized`, `runStarted`, `runCompleted`, `socketConnectionDisconnected`, `socketConnectionReconnected`, and know nothing about rendering. Presentation is completely decoupled from mechanism, which is why `devOutput.ts` can afford per-error-variant formatting (`formatErrorLog` renders `TaskRunError` differently for INTERNAL_ERROR / STRING / CUSTOM / BUILT_IN_ERROR) without polluting the supervisor.

A detail worth stealing: on build and indexing failures the output includes an **`aiHelpLink`** — a clickable dashboard URL pre-filled with the error text.

User-code output does *not* go through the eventBus: `TaskRunProcess.#handleLog`/`#handleStdErr` prefix each piped line with a bullet, a timestamp, and (if a run is executing) `runId.attemptNumber`.

### 3.7 Shutdown

`DevSupervisor.init()` installs `process.on("SIGTERM"|"SIGINT")`, which **overrides Node's default termination** — hence `#handleSigterm` must call `process.exit(0)` explicitly after `shutdown()`. Teardown order is deliberate:

1. `devInstance.stop()` → `watcher.stop()` → `removeLockFile()` (outer, `dev.ts`)
2. session: remove tmp dir → stop esbuild watch → `runtime.shutdown()` → `stopOutput()` (unsubscribe eventBus)
3. `DevSupervisor.shutdown()`: unregister signal handlers → **`Promise.allSettled(runControllers.map(c => c.stop()))`** (drain) → kill watchdog → close SSE → close socket → `taskRunProcessPool.shutdown()` (SIGTERM→SIGKILL every pooled process)
4. lockfile removed via `signal-exit`

The drain is **best-effort, not a true drain** — `c.stop()` returns the process to the pool and stops the poller; it does not block on the task finishing. The watchdog exists precisely because that guarantee is weak. Note the ordering logic: `active-runs.json` is accurate *before* the watchdog is killed, so the watchdog never races the CLI's own cleanup.

There is also a **contradiction in the codebase** worth noting: `installExitHandler()` in `src/cli/common.ts` registers `process.on("SIGINT", () => process.exit(0))` globally at import time, which would bypass all of the above — the dev supervisor's later handler works only because `process.on` appends and `devSupervisor`'s handler calls `process.exit` itself. Relying on handler ordering for correct shutdown is fragile.

### 3.8 Against `radius dev` today

`packages/cli/src/dev.ts` (223 lines) does the following: load config → build a `DevelopmentAgentConnection` → atomically write it to `~/Library/Application Support/Radius/development/agents/<agentId>.json` (tmp file + `rename`, mode `0600`, dir `0700` — this part is well done) → `open -a Radius` → `fs.watch` the config file's *directory* with a 75ms debounce → `await` SIGINT/SIGTERM → `rm` the registration file.

Measured against the above, the gaps are:

- **No liveness channel whatsoever.** The registration file carries `ownerPid`, which is the right primitive, but nothing polls it. If `radius dev` is SIGKILLed the file is orphaned and the desktop app has no way to learn the agent is gone. Trigger.dev's answer to exactly this problem is `devWatchdog.ts`. Radius's could be far simpler — the consumer is a local app, not a remote platform, so a PID liveness check on the desktop side plus a heartbeat `mtime` would do — but *something* is required.
- **No single-instance lock.** Two `radius dev` runs in the same repo write the same registration path and the second's cleanup deletes the first's file. `lock.ts` is 104 lines.
- **`fs.watch` on a directory is the wrong tool.** It's unreliable on Linux for renames, doesn't handle editors that write-then-rename (which most do — the file is replaced, and the watch on the *directory* happens to save it here, but a watch on the file would silently die), and there's no `chokidar`. Trigger.dev restarts the whole session on config change; Radius attempts an in-place reload and then has to defend against identity drift with `"Agent identity cannot change while radius dev is running"`. Full restart is simpler and has fewer states.
- **The reload error path is right and worth keeping**: on a bad config, `radius dev` keeps the last valid registration and prints `Radius kept the last valid development configuration: ...`. That is exactly Trigger.dev's "failed rebuild changes nothing" discipline, already implemented.
- **`launchRadiusDesktop` throws if the app is missing.** `open -a Radius` exits non-zero and `runLauncher` rejects, so `radius dev` dies with "Could not launch Radius (open exited 1)". No detection of app-absent vs app-stale vs already-running-this-agent — precisely the open question CUR-34 flags.
- **No output beyond four `io.out` lines.** Nothing reports whether the desktop app ever picked up the registration. The developer gets no confirmation that the thing they ran actually connected.

---

## 4. The build/deploy split

**The headline finding: there is no `build` command.** Nineteen commands, and `build` is not among them. `deploy` (`src/commands/deploy.ts`, **2,480 lines** — the largest file in the package) is the only thing that bundles. Everything that looks like a build/deploy split is flags inside one invocation.

**Two build stages:**

| Stage | Where | Tool |
|---|---|---|
| A. Bundle | Always local to the CLI process | esbuild (`platform: node`, `format: esm`, `bundle`, `splitting`) |
| B. Container image | One of three paths | `docker buildx` / Depot / platform build server |

`resolveBuildPath()` (`src/deploy/buildPath.ts`, 73 lines) picks stage B:
```ts
if (options.nativeBuildServer) return { buildPath: "native", from: "flag", flag: "--native-build" };
if (options.localBuild)        return { buildPath: "depot", from: "flag", flag: "--local-build" };
if (options.depotBuild)        return { buildPath: "depot", from: "flag", flag: "--depot-build" };
// otherwise ask the server via getDeploySettings(); 404 → fallback to "depot"
```
**The server decides the default build path**, and the CLI falls back gracefully if the server is too old to answer (404 → depot). Flags override. `--native-build` uploads a tar of the project (`archiveContext.ts`) or just the esbuild output (`bundleArchive.ts`) and the platform does everything, streaming logs back over an S2 event stream (`buildLogs.ts`).

Local Docker is selected by `const isLocalBuild = options.localBuild || !deployment.externalBuildData` — i.e. **self-hosted instances get local builds implicitly** by not issuing Depot tokens. Note there is **no actual `--self-hosted` flag** despite an error message in `buildImage.ts` telling users to pass one; the flag is stale documentation inside the source.

### 4.1 Artifact identity

- **Version is assigned by the platform, not the CLI.** `initializeDeployment()` returns `deployment.version`; the CLI just reads it. There is no local version computation anywhere.
- **Content hash is computed locally**, from esbuild's per-file hashes (`src/build/bundle.ts`):
  ```ts
  const hasher = createHash("md5");
  for (const outputFile of result.outputFiles) hasher.update(outputFile.hash);
  ```
  It goes into `BuildManifest.contentHash`, up to the server at `initializeDeployment`, and back down as a `--build-arg TRIGGER_CONTENT_HASH`. Deploy builds deliberately omit `outputHashes` (`target === "dev" ? bundle.outputHashes : {}`) "to ensure deterministic builds," and `buildManifestToJSON` sorts externals for the same reason.
- **Image digest closes the loop.** The CLI gets the real digest from the build (locally `buildResult.digest`; via Depot, `meta.data["containerimage.digest"]` out of BuildKit's `metadata.json`) and hands it to `finalizeDeployment(deployment.id, { imageDigest, ... })`. That handshake — *the CLI tells the server exactly what it produced* — is the nearest analogue to Radius's receipt.
- **`BuildManifest` is the build→deploy handoff**, written to disk as **`build.json`** in the output dir by `writeDeployFiles()`. Shape: `contentHash, runtime, environment, branch, packageVersion, cliPackageVersion, target, files, sources, externals, config: {project, dirs}, outputPath, {index,run}{Controller,Worker}EntryPoint, loaderEntryPoint, initEntryPoint, configPath, customConditions, deploy: {env}, build: {}, otelImportHook, outputHashes`. `buildManifestToJSON()` **strips `deploy` and `build` before persisting** — secrets and env never touch disk. It is also `COPY`'d into the image and re-read there by the indexer, and `--from-bundle` re-parses it with `BuildManifest.safeParse` to resume a deploy with no config or source access.

### 4.2 How you avoid rebuilding

Three mechanisms, in order of how much they're meant to be used:

1. **`--external-id <id>`** — the real one. Re-deploying with the same external id returns the existing version instead of building again (`deployment.outcome === "existing"`). `--force` (requires `--external-id`) cancels the prior build and rebuilds.
2. **`--dry-run`** — bundles, writes `build.json` and the `Containerfile`, then returns before any server call. Useful for inspection, not for later deploy.
3. **`--from-bundle <dir>`** — reads a previous bundle dir's `build.json` and jumps straight to the image build. **Explicitly commented as internal/testing-only.**

So: **build-once-deploy-later is not a supported user workflow in Trigger.dev.** Deploy always rebuilds unless idempotency-keyed by external id. This is a real divergence from Radius, and it's a point in Radius's favour, not against it — see §8.

### 4.3 Indexing

"Indexing" means **running the bundled code to discover what it exports.** `indexWorkerManifest()` forks the index worker with `TRIGGER_INDEXING=1` and a 20s timeout, and collects a `WorkerManifest` (`tasks, queues, prompts, runtime, runtimeVersion, timings`) via Zod-typed IPC (`INDEX_COMPLETE`, `TASKS_FAILED_TO_PARSE`, `TASKS_FAILED_TO_INDEX`, `UNCAUGHT_EXCEPTION`).

For deploys it runs **inside the image, as a Docker build stage**: `generateContainerfile()` emits `RUN node ${indexScript}` in an `indexer` stage whose `index.json` is `COPY --from=indexer`'d into the final stage. That stage has network access back to the API (via build args) and reports the manifest with `createDeploymentBackgroundWorker`. On failure it calls `failDeployment(deploymentId, {error})` and `process.exit(1)`, failing the `RUN` and thus the image build; the CLI then re-queries the deployment and prints the server-side status and saved logs (`src/deploy/logs.ts`).

**Verifying the artifact by executing it inside the built image** is exactly what `radius build` does with its microVM smoke test — a strong independent confirmation that the instinct is right. The difference is only *where* the sandbox comes from.

### 4.4 Git metadata and CI

`createGitMeta()` (`src/utilities/gitMeta.ts`) attaches provenance to every `initializeDeployment`, with three strategies: GitHub App (Trigger's own build server, `dirty: false`), GitHub Actions (parses `$GITHUB_EVENT_PATH` for PR number/title/state/merged, fetches the commit message via `git fetch origin <sha>`), and a local fallback using `git-last-commit` + `git status -s` for a **`dirty` flag** + parsing `.git/config` for the origin remote.

`getTriggeredVia()` classifies the CI provider by env var — `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `JENKINS_URL`, `TF_BUILD`, `BITBUCKET_BUILD_NUMBER`, `TRAVIS`, `BUILDKITE`, else `cli:ci_other` or `cli:manual`.

`setGithubActionsOutputAndEnvVars()` appends to `$GITHUB_ENV`/`$GITHUB_OUTPUT` (`TRIGGER_DEPLOYMENT_VERSION`, `TRIGGER_DEPLOYMENT_SHORT_CODE`, `TRIGGER_DEPLOYMENT_URL`, `TRIGGER_TEST_URL`, `needsPromotion`) so later steps can consume the result. Cheap, and it makes the CLI a good citizen in a pipeline.

Nice touch: with `--env preview`, if `gitMeta.pullRequestState` is `merged` or `closed`, deploy **archives the preview branch instead of deploying it**.

### 4.5 Promote / rollback

`src/commands/promote.ts` is one API call — `projectClient.client.promoteDeployment(version)`. No rebuild, no image work. **There is no `rollback` command**; rollback is `promote <older-version>`. `deploy --skip-promotion` builds and finalizes without becoming current. Radius has both `promote` and `rollback` as separate commands, which is arguably redundant surface for the same server-side pointer move — though Radius's `--expected-revision` optimistic-concurrency guard is a genuine addition Trigger.dev lacks.

### 4.6 Against `radius build` / `radius deploy` today

Radius's split is **stronger than Trigger.dev's in concept and weaker in reach**.

Stronger: `radius build` writes a real, schema-versioned, canonically-serialized receipt to `.radius/builds/<digest>/receipt.json` with a `latest.json` pointer, and `radius deploy` refuses to ship if the config drifted from the receipt:
```ts
if (canonicalJson(build.manifest) !== canonicalJson(manifest))
  throw new Error("Radius config changed after the selected build; run radius build again");
```
Trigger.dev has no equivalent guard because it always rebuilds. Radius also records *how* the artifact was verified (`verification: { kind: "microvm-acp", platform: "linux/arm64" }`), which is a provenance claim Trigger.dev's `finalizeDeployment` digest handshake does not make.

Weaker: **`radius build` cannot run in CI at all.** `packages/cli/src/sandbox.ts` opens with
```ts
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Radius sandbox development currently requires Apple Silicon macOS");
```
So the verification step — the thing that makes the receipt meaningful — is unreachable on Linux, on Intel Macs, and on every hosted CI runner. Trigger.dev solved the identical problem (needing a Linux container to verify a build) by making the *platform* build and index, with local Docker as the fallback for self-hosters. Radius has no such escape hatch today. `--runtime-host` / `--kernel` / `--runtime-root` flags exist to point at a custom runtime but do not lift the platform check.

Also missing on the Radius side: no git provenance on a deployment at all, no CI detection, no GitHub Actions outputs, and `deploy` has no `--dry-run`.

---

## 5. Auth

**Interactive login is a polling authorization-code flow** (`src/commands/login.ts`):

1. Check `TRIGGER_ACCESS_TOKEN` env — if present, use it and stop.
2. Read the stored profile; if a token exists and `whoAmI()` succeeds, report already-logged-in.
3. If `isCI` (from `std-env`) and no token from either source → **hard fail with an actionable message** (below).
4. `POST /api/v1/authorization-code` → `{ url, authorizationCode }`.
5. `open(url)` — unless `--no-browser`, or `isLinuxServer()` detects a headless box, in which case it prints the URL and suggests installing `xdg-utils`.
6. Poll `POST /api/v1/token` with the code:
   ```ts
   pRetry(() => getPersonalAccessToken(...), { factor: 1, retries: 300, minTimeout: 1000 })
   ```
   Fixed 1s interval, 300 attempts ≈ 5 minutes, against a server-side 10-minute code validity. `429` is retryable; a server-reported failure throws `AbortError` to stop polling immediately; "not yet" throws a plain `Error` to keep going.
7. Write the profile, `whoAmI()` to validate, set it as `currentProfile`.

**Token storage: a plaintext JSON file. No keyring.** `xdgAppPaths("trigger").config()` + `config.json` (`src/utilities/configFiles.ts`):
```ts
{ version: 2, currentProfile: string, profiles: Record<string, { accessToken?, apiUrl? }>, settings?: {...} }
```
written with `writeFileSync(path, JSON.stringify(config, undefined, 2), { encoding: "utf-8" })` — **no `mode` argument, no `chmod`**, so permissions are whatever umask gives (typically `0644`). A v1→v2 migration exists (detects the old flat map by the absence of `currentProfile`, rewrites, leaves the legacy `default.json` alone).

**Profiles**: `--profile <name>` on every command via `commonOptions`, defaulting to `readAuthConfigCurrentProfileName()`. `login` always makes the new profile current. `switch [name]` sets it (interactive `select` if no arg). `logout --profile` deletes one entry and resets `currentProfile` to `"default"` if it was current. `list-profiles` dumps names + api URLs.

**The CI path**, which is the part CUR-34 specifically asks about:
- Env var **`TRIGGER_ACCESS_TOKEN`**, checked **before** any stored profile — env always wins.
- It must be a Personal Access Token (`tr_pat_` prefix) or it throws `NotAccessTokenError` naming the prefix and linking to the token page. **Validating the token's shape locally and telling the user the expected prefix** is a small thing that saves a lot of confused CI debugging.
- If `isCI` and nothing is set:
  > `Authentication required in CI environment. Please set the TRIGGER_ACCESS_TOKEN environment variable with a Personal Access Token.` — plus a generated `{dashboardUrl}/account/tokens` link and a GitHub Actions docs link.
  Detecting CI and giving a *different, non-interactive* error is the single most valuable auth behaviour here.
- `TRIGGER_API_URL` env overrides even `--api-url` on this path.
- `deploy` additionally accepts a project-scoped API key (generic `tr_` prefix, neither `tr_pat_` nor `tr_oat_`), handled by `authenticateForDeploy()` (`src/deploy/auth.ts`) as `tokenType: "apiKey"` and used **without any login or `whoAmI` round-trip**.

**Token types**: `tr_pat_` personal, `tr_oat_` organization (validated but deliberately never surfaced in CLI UX — there's a comment saying so), generic `tr_` project API key, and `tr_uat_` short-lived user actor tokens minted by `mint-token` (`--ttl` default 3600, `--cap` scopes default `read:all`, `--client` label). `mint-token` **prints the token alone on stdout and all human text on stderr**, so `UAT=$(trigger.dev mint-token)` works. That stdout/stderr discipline is worth copying wholesale.

**API URL precedence**: `TRIGGER_API_URL` env → `--api-url` flag → stored profile `apiUrl` → `CLOUD_API_URL`. With a subtlety: once a profile is logged in, its stored `apiUrl` is used for its own API calls, so `--api-url` can't accidentally repoint an existing profile.

### Against Radius today

Radius made the **opposite** call on storage and it is defensible. `credential-store.ts` uses `@napi-rs/keyring` and, when the OS keychain is unavailable, **refuses to fall back**:
> `Operating-system credential storage is unavailable (...). Set RADIUS_ACCESS_TOKEN for this invocation; Radius will not fall back to a plaintext file.`

That is strictly better security than Trigger.dev's world-readable `config.json`. The cost is the native dependency, which the build already has to special-case (`--external @napi-rs/keyring` in three separate `bun build` invocations in `packages/cli/package.json`) and which will complicate any standalone-binary distribution — exactly the tension CUR-34 lists as unresolved. Note that Trigger.dev, with far more users and a far bigger security surface, took the plaintext option and nobody appears to have forced them off it.

What Radius is missing: `resolvePlatformAccessToken` checks `RADIUS_ACCESS_TOKEN` then the keyring then throws — but **there is no CI detection**, so a CI run with no token gets the same "Run radius login" message a human gets, suggesting an interactive flow that cannot work. There is also no token-prefix validation and no equivalent of the `tr_pat_` shape check.

---

## 6. Cross-cutting furniture

### Error taxonomy

Three classes, all in `src/cli/common.ts`, all empty subclasses of `Error`:
```ts
export class SkipLoggingError extends Error {}
export class SkipCommandError extends Error {}
export class OutroCommandError extends SkipCommandError {}
```
Their whole meaning is "how much has already been shown to the user":
- `SkipLoggingError` — the error was already printed in a prettier form; say nothing more.
- `SkipCommandError` — the user cancelled (a `@clack` prompt returned `isCancel`); say nothing.
- `OutroCommandError` — print `outro(message)` and exit 1.
- Everything else — `logger.log(\`${chalkError("X Error:")} ${message}\`)`.

`BundleError` (from `src/build/bundle.ts`) gets its own branch: `process.exit(1)` with no message, because esbuild already printed a formatted diagnostic.

**This is a good taxonomy and it is nearly free.** It is not a hierarchy of *what went wrong* — it's a hierarchy of *what the handler should print*, which is the axis that actually matters at the top level. Radius currently throws bare `Error` everywhere and `cli.ts`/`index.ts` prints whatever `message` says; there's no way for a command that already rendered a nice failure to suppress the generic one.

### `wrapCommandAction` — the most copyable 40 lines

```ts
export async function wrapCommandAction<T extends z.AnyZodObject, TResult>(
  name: string, schema: T, options: unknown, action: (opts: z.output<T>) => Promise<TResult>
): Promise<TResult | undefined> {
  try {
    const parsedOptions = schema.safeParse(options);
    if (!parsedOptions.success) throw new Error(fromZodError(parsedOptions.error).toString());
    logger.loggerLevel = parsedOptions.data.logLevel;
    logger.debug(`Running "${name}" with the following options`, { options });
    return await action(parsedOptions.data);
  } catch (e) {
    if (e instanceof SkipLoggingError) { /* nothing */ }
    else if (e instanceof OutroCommandError) { outro(e.message ?? "Operation cancelled"); process.exit(1); }
    else if (e instanceof SkipCommandError) { /* nothing */ }
    else if (e instanceof BundleError) { process.exit(1); }
    else logger.log(`${chalkError("X Error:")} ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}
```

Four jobs in one wrapper: **validate commander's untyped `options` bag against a zod schema** (turning `unknown` into a typed object at exactly one place per command), set the log level as a side effect of that parse, debug-log the invocation, and centralise error rendering. `fromZodError` (`zod-validation-error`) turns a zod issue tree into a readable one-liner. The `throw e` at the end matters — it re-raises so the outer wrapper can set the exit code.

The companion wrapper is deliberately dumb:
```ts
export async function handleTelemetry(action: () => Promise<void>) {
  try { await action(); } catch (_e) { process.exitCode = 1; }
}
```
It is **misnamed** — it sends no telemetry. It catches whatever `wrapCommandAction` re-threw and converts it to `process.exitCode = 1` (not `process.exit`, so the event loop drains and pending output flushes). Using `exitCode` rather than `exit` is the right call and worth noting.

The two are meant to nest — `wrapCommandAction` validating and rendering on the outside, `handleTelemetry` catching on the inside — but **the nesting order is not consistent across commands**: `update.ts` puts `wrapCommandAction` outermost, while `init.ts` puts `handleTelemetry` outermost. Since only the outermost one can influence the process exit code, this inconsistency is a latent bug surface. If Radius adopts the pattern, compose it **once** into a single helper rather than leaving two wrappers for each command author to order by hand.

**Two real bugs in this pattern, in shipped code**, both instructive about its weaknesses:
- `src/commands/update.ts:42` calls `wrapCommandAction("dev", UpdateCommandOptions, ...)` — the name is a free-form string with no connection to the command, so a copy-paste mislabels every debug line.
- The same line does **not `await`** the `wrapCommandAction` call inside the commander action, so `trigger update` has a floating promise and its errors can't set the exit code.

### Exit codes

Binary only: **0 or 1**. `process.exitCode = 1` from `handleTelemetry`; `process.exit(1)` from the `OutroCommandError`/`BundleError` branches and from `src/index.ts`'s top-level catch. No distinct codes for auth failure vs build failure vs network failure — a scripting weakness, and something Radius could improve on cheaply.

`installExitHandler()` registers `SIGINT`/`SIGTERM` → **`process.exit(0)`**. So Ctrl-C is reported as success. Defensible for a dev server, wrong for a long deploy.

### Logging

`src/utilities/logger.ts` opens with a comment: *"This is a copy of the logger utility from the wrangler repo."* Levels `none(-1) < error(0) < warn(1) < info(2) < log(3) < debug(4)`, default `log`, settable by `--log-level` **and** by env `TRIGGER_LOG_LEVEL` (with a warning naming the valid values if it's unparseable). Uses esbuild's `formatMessagesSync` to render errors and warnings in esbuild's own style, and `cli-table3` for `logger.table()`. There is **no log file** — `--log-file` exists only on the `mcp` subcommand.

A telling detail: `warn` and `error` carry `@deprecated **ONLY USE THIS IN THE CLI** - It will hang the process when used in deployed code (!)` — using the deprecation marker as an in-IDE guardrail against cross-context reuse.

### Telemetry

**There isn't any.** This surprised me and I verified it directly:
- `--skip-telemetry` is declared in `CommonCommandOptions` and as a flag on every command.
- `tracer = trace.getTracer("trigger.dev/cli")` is used extensively — `tracer.startActiveSpan` wraps most meaningful operations, with `recordSpanException` on failure.
- But `grep -rn "TracerProvider|OTLPTrace|setGlobalTracerProvider" src` returns **nothing** — no provider is registered anywhere in `cli-v3`. (I sparse-checked only this package, so another monorepo package could in principle register a global provider; nothing in `cli-v3`'s own entry path does.)
- And **nothing ever reads `skipTelemetry`**. It is declared in the schema, exposed as a flag on nearly every command, parsed — and no call site branches on it.

There is also no Sentry, no PostHog, and no analytics SDK in the dependency list. With no registered provider the OpenTelemetry API hands back no-op spans, so the tracing apparatus is inert in the published CLI, `--skip-telemetry` controls nothing, and `handleTelemetry` handles no telemetry. The `skipTelemetry: !span.isRecording()` lines in `login.ts` are the tell — written for a world where a provider *might* be installed by an embedding context. This is dead scaffolding that has survived into 4.5.16, and it costs every command four extra lines plus a misleading flag in `--help`.

The one genuine outbound call of this shape goes the other way: `fetchPlatformNotification` **pulls** a notice from the API (7s timeout) to display to the user. Nothing pushes usage data anywhere.

### Update notification

`updateCheck()` in `src/utilities/initialBanner.ts` uses **`fast-npm-meta`**'s `getLatestVersion` (a lightweight registry metadata service, not a full `npm view`), compared with `semver.lt(VERSION, meta.version, true)` — loose mode, so prereleases like `4.5.0-rc.0` sort below `4.5.0`. A code comment records that this replaced a naive string comparison. The promise is **memoized in module scope** (`updateCheckPromise ??= doUpdateCheck()`) so the check fires once per process no matter how many call sites want it, and **any failure is swallowed** (`logger.debug(err); return;`) — an update check never breaks the CLI. It runs inside a spinner at banner time (`Checking for updates` → `Update available 4.6.0` / `On latest version`), escalating to a `logger.warn` with install instructions only on a **major** bump. `deploy` has `--skip-update-check`.

The separate `trigger update` command (`src/commands/update.ts`) is a different job: it reconciles all `@trigger.dev/*` packages **in the user's project** against the running **CLI's** version (not the registry's latest), using `nypm` to detect the package manager, `pkg-types` to resolve package.json, and `writeJSONFilePreserveOrder` so the diff stays clean. Details worth stealing:

- It compares against each dependency's **actually installed** version (`resolve.sync` + reading that package's own package.json), not the declared range — so it reflects what's on disk.
- It skips `workspace:` protocol and `0.0.0` prerelease pins, and bails entirely for a `0.0.0` CLI unless `ENABLE_PRERELEASE_UPDATE_CHECKS=1`.
- **In CI (`!hasTTY`) with a mismatch it prints and `process.exit(1)`** rather than prompting — no interactive path is even attempted.
- When called *embedded* from `deploy` and the installed SDK is **newer** than the CLI, it hard-fails ("CLI update required!") and names `--skip-update-check` as the escape hatch. A version skew between CLI and SDK is treated as a deploy-blocking error, not a warning.
- Before mutating, it **backs `package.json` up to `<path>.bak`** and registers `process.prependOnceListener("exit", ...)` to warn the user how to restore if the process dies mid-install; the listener is removed on both success and controlled failure, and `revertPackageJsonChanges()` restores on error.

**Keeping CLI and SDK versions locked is treated as a first-class command**, which speaks directly to CUR-34's "version pinning between CLI, SDK, desktop app, and platform" question.

### Other furniture worth naming

- **`platformNotifications.ts` + `discoveryCheck.ts`** — the server can push a notification to the CLI conditioned on a **filesystem discovery spec** (`{ filePatterns, contentPattern, matchBehavior: "show-if-found" | "show-if-not-found" }`) evaluated locally with `tinyglobby`. So the platform can say "show this tip only to projects that have a `next.config.js` but no `instrumentation.ts`" without shipping a CLI release. It **fails closed** — any error suppresses the notification. Clever, and slightly creepy.
- **`supportsHyperlinks.ts` / `terminalLink.ts`** — OSC-8 hyperlinks with per-terminal capability detection, degrading to plain URLs.
- **`windows.ts`** — exports a `spinner()` wrapper, because `@clack`'s default spinner misbehaves on Windows.
- **`runtimeCheck.ts`** — validates the Node version at startup against `engines: node >= 18.20.0`.
- **`colorMarkup.ts`** — a tiny markup language for colouring server-supplied strings, unit tested.

---

## 7. Testing

**Two layers, and a very large untested middle.**

Counted from the tree: **18 test files against 140 source files**, 3,633 test LOC against 32,970 source LOC.

**Unit tests (`vitest`, `vite.config.ts`)** cover pure, easily-isolated functions and cluster in exactly the places where the logic is fiddly and side-effect-free:
`src/config.test.ts`, `src/deploy/{auth,buildImage,buildLogs,buildPath,bundleArchive}.test.ts`, `src/build/{buildWorkerLogging,createRequireWarnings}.test.ts`, `src/utilities/{colorMarkup,discoveryCheck}.test.ts`, `src/rules/manifest.test.ts`, `src/entryPoints/managed/snapshot.test.ts`, `src/executions/taskRunProcess.test.ts`, `src/commands/skills.test.ts`, and four under `src/mcp/`.

Note what that list implies: **`buildPath.test.ts` (114 lines of test for 73 lines of source)** — the build-path decision function is tested more densely than anything else in the package, because it's a pure function over flags and server settings with many branches. That is the shape of code worth unit-testing in a CLI, and it's a deliberate design choice: `resolveBuildPath` was *extracted* into a pure function so it could be tested.

**E2E tests (`e2e/`, separate `e2e/vitest.config.ts`, `pnpm test:e2e`)** are the real coverage. Two fully separate vitest projects: the root `vite.config.ts` excludes `e2e/**/*`, and `e2e/vitest.config.ts` excludes `src/**/*`.

`e2e/fixtures/` holds five complete, self-contained example projects (`hello-world`, `esm-only-external`, `emit-decorator-metadata`, `monorepo-react-email`, `otel-telemetry-loader`), each shipping **`package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock`**. `installFixtureDeps()` (`e2e/utils.ts`) really shells out via `execa` to `npm ci --no-audit`, or `corepack use pnpm@X` / `corepack use yarn@X` (pnpm and yarn need corepack pinning, versions read from each fixture's `package.json.engines`), selectable with `PM=` or auto-detected from which lockfile is present. **Real `node_modules`, real package managers, no mocking.** This is testing the thing that actually breaks in a bundler-heavy CLI: module resolution across package managers, workspace layouts, ESM-only deps, decorator metadata, and monorepos. Each fixture is also type-checked — `runTsc()` execas the fixture's own `node_modules/.bin/tsc --noEmit`.

**An important qualification: the e2e suite never invokes the CLI binary or the commander program.** It calls the internal library functions in-process — `loadConfig()` → `buildWorker()` → `indexWorkerManifest()` → execute via `TaskRunProcess`. `e2e/README.md` says so explicitly: *"No docker image is created or built, instead, the bundled worker file is started with node directly inside the vitest process."* So it is an end-to-end test of the **build → index → execute pipeline**, not of any command, flag, prompt, or auth path.

The network is faked with **`@epic-web/test-server`**: `createTestHttpServer` stands up stub routes for `/usage`, `/v1/traces` (OTLP), `/v1/logs`, and `/v1/chat/completions` (a fake OpenAI response), and the executed task is pointed at it via `TRIGGER_API_URL` / `OTEL_EXPORTER_OTLP_ENDPOINT` / `OPENAI_BASE_URL` plus a fake JWT. The captured OTLP trace bodies are then parsed back into span events (`parseTraceBodyIntoEvents`) so tests can assert **which spans the run emitted**. `MOD=<fixture-id>` filters to one fixture, `LOG=<level>` sets the logger level.

Two more characteristics worth naming. First, most "unit" tests are really **narrow integration tests against the real filesystem** (`mkdtemp` + real `node:fs`) rather than mock-heavy units; `vi.mock`/`vi.fn`/`vi.spyOn` is concentrated in just four or five files. `createRequireWarnings.test.ts` is 714 lines that run **real esbuild builds** against temp files to verify a plugin's warning detection. Second, `src/mcp/smoke.test.ts` is not an automated test at all — it's a manual script that needs a live webapp on `localhost:3030` and a real auth profile.

**What is not tested at all:**
- **The `dev` command and its entire socket/supervisor/watchdog subsystem.** ~2,200 LOC across `src/dev/` with zero test files — verified by absence: no test file anywhere imports `devSession.ts`, `devSupervisor.ts`, `devOutput.ts`, `devWatchdog.ts`, `lock.ts`, `workerRuntime.ts`, or `eventBus.ts`. Nothing exercises the socket.io handshake, the dequeue loop, reconnection, the process pool, the lockfile, or the watchdog.
- **`src/commands/deploy.ts`** — 2,480 lines, no test file. Its extracted helpers under `src/deploy/` are tested; the orchestration is not.
- **`src/cli/common.ts`** — no `common.test.ts`. The error taxonomy, `wrapCommandAction`'s dispatch, and exit-code behaviour are unverified.
- **Command wiring, help output, and every interactive prompt.** Of 19 files under `src/commands/`, only `skills.test.ts` exists, and it covers a filesystem helper, not the command action. Anything behind a TTY prompt is untested.
- `initialBanner.ts` (the update check), `platformNotifications.ts`, `runtimeCheck.ts`, `windows.ts`/`linux.ts`/`supportsHyperlinks.ts`, and the whole `update` package-reconciliation flow.

The strategy, stated plainly: *unit-test the pure functions you deliberately extracted, e2e-test the build pipeline against real fixture projects with real package managers, and don't test the interactive/networked surface at all.* For the build half that's a reasonable trade. For `dev` it means the most stateful, most concurrent, hardest-to-reason-about code in the package has no automated coverage whatsoever.

### Against Radius today

Radius is, per line of code, **better tested than Trigger.dev** and structurally better set up for it. `packages/cli` has 10 test files for 21 source files (`tsx --test src/**/*.test.ts`, `node:test`), and — the important part — **the commands are written for dependency injection**:

- `runCli(argv, { cwd, io, readSecret })` — the whole CLI is a function, with I/O injected.
- `runDevelopmentAgent({ ..., userDataPath, launchDesktop, waitForExit })` — `dev.test.ts` runs the *real* dev command against a temp dir with a fake desktop launcher and a `waitForExit` that asserts the registration file's contents mid-flight, then verifies cleanup.
- `buildAgent({ ..., buildOci, verifyBuild })` and `deployAgent({ ..., platformClient, pushOci, profileStore, build })` — the expensive and platform-bound parts are seams.

Trigger.dev has no equivalent; its commands read `process.cwd()`, write to a module-global `logger`, and call `process.exit` directly, which is precisely why `dev` and `deploy` have no tests. **Radius should not adopt Trigger.dev's testing posture. It should keep its own and copy only the e2e fixture-matrix idea** — the multi-package-manager fixture grid is the one thing Radius genuinely lacks, and `radius init` (which shells out to a package manager and scaffolds files) is exactly the surface it would catch regressions on.

---

## 8. Copy this / avoid this / not applicable

### COPY — high confidence, small cost

1. **`commander` + `commonOptions(cmd)` + `CommonCommandOptions` zod schema.** (`src/cli/common.ts`, 95 lines; `src/cli/index.ts`, 52 lines.) This replaces Radius's 492-line `main.ts` switch and the thirteen duplicated `parseArgs` option literals. One `configureXCommand(program)` per command file, one explicit registration list, per-command `--help` for free. Radius's `--config`/`--profile`/`--organization`/`--environment`/`--json` are exactly the shared set that `commonOptions` exists for.
2. **`wrapCommandAction`: parse commander's untyped options bag through a zod schema at the command boundary.** Radius already has `AgentConfigSchema`; it has nothing equivalent for *flags*, which is why `main.ts` hand-rolls `parseExpectedRevision`, `parsePageLimit`, and the `--role`/`--language` validators inline. Fold those into per-command zod schemas and the validation errors get uniform, via `zod-validation-error`.
3. **The three-class error taxonomy** (`SkipLoggingError` / `SkipCommandError` / `OutroCommandError`) keyed on *what the top-level handler should print*, not on what went wrong. Nearly free, and it's what lets a command render a good failure without the generic handler printing a worse one on top.
4. **A watchdog for `radius dev`.** (`src/dev/devWatchdog.ts`, 204 lines.) Radius's registration file already carries `ownerPid`; nothing acts on it. If `radius dev` is SIGKILLed, the file is orphaned and the desktop app cannot tell. Radius's version can be much simpler than Trigger.dev's — no remote API call needed, just liveness — but the *problem* is identical and unaddressed. Include the 24h max-lifetime guard against PID reuse.
5. **A single-instance lockfile for `radius dev`.** (`src/dev/lock.ts`, 104 lines.) `.radius/dev.lock` with the PID, `signal-exit` for guaranteed removal, newcomer-kills-incumbent policy. Today two `radius dev` runs silently fight over one registration path.
6. **The `eventBus` split between mechanism and presentation.** (`src/utilities/eventBus.ts` + `src/dev/devOutput.ts`.) Radius's `dev`/`build`/`deploy` thread a `CliIo` object through every function signature, which works but couples every layer to output. A typed emitter would let `radius dev` grow a real status display (did the desktop app pick up the registration? is the ACP endpoint reachable?) without touching the registration logic.
7. **CI detection with a different error.** `isCI` from `std-env`; when true and unauthenticated, fail immediately with "set `RADIUS_ACCESS_TOKEN`" and a link — never suggest `radius login`. Radius's `resolvePlatformAccessToken` currently tells CI to run an interactive command.
8. **Validate the token prefix locally** and name the expected shape in the error, as `NotAccessTokenError` does for `tr_pat_`.
9. **stdout/stderr discipline for machine-readable output.** `mint-token` prints the token alone on stdout, everything human on stderr, so `$(...)` capture works. Radius's `--json` flags should follow the same rule.
10. **`--yes` and `--no-browser` on `init`,** plus a worked-examples block in the command description covering the interactive, CI, and headless-agent invocations. Radius's `init` has `--skip-install` and `--force` but no way to run fully unattended.
11. **`jsonc-parser` for editing user files.** `init` modifies the user's `tsconfig.json` with `parseTree`/`modify`/`applyEdits`, preserving comments and formatting; `update` uses `writeJSONFilePreserveOrder`. Radius's `init` does `appendFile` on `.gitignore` and writes configs from string templates — fine now, fragile the moment it has to modify an existing file.
12. **`nypm` for package-manager-agnostic install.** Radius's `init` calls `installToolchain` via `spawnSync`; `nypm` detects npm/pnpm/yarn/bun and does the right thing.
13. **A `radius update` command** that pins `@curve-ai/*` packages to the CLI's version, plus the **version-skew check embedded in `deploy`**: if the installed SDK is newer than the CLI, fail the deploy rather than warn (with a documented `--skip-update-check` escape). CUR-34 lists CLI/SDK/desktop/platform version pinning as unspecified; this is the mechanism, and it compares against the *installed* version on disk, not the declared range.
13b. **Back up before mutating a user's file, and register an exit listener while mutating.** `update.ts` copies `package.json` to `<path>.bak`, `process.prependOnceListener("exit", ...)` warns how to restore if the process dies mid-install, the listener is removed on both success and controlled failure, and `revertPackageJsonChanges()` restores on error. `radius init` already writes into repos it doesn't own and will only do more of this.
14. **Server-supplied intervals and server-chosen defaults.** Trigger.dev's dequeue intervals come from `/engine/v1/dev/config` and the build path default comes from `getDeploySettings()` with a **404 → sane fallback** so old CLIs keep working. Any timing or policy constant Radius bakes into the CLI is a constant it can never change without a release.
15. **`git` provenance on a deployment** — commit sha, branch, message, remote, and a **`dirty` flag** from `git status -s`. Radius's `finalizeAgentDeployment` sends `sbomDigest: null, provenanceDigest: null`; git metadata is the cheapest real provenance available and Radius sends none.
16. **The e2e fixture matrix.** Complete fixture projects committed with all three lockfiles, installed for real with npm/pnpm/yarn (via corepack pinning), then built and type-checked with the fixture's own `tsc --noEmit`. This is the one testing idea Radius should take — `radius init` shells out to a package manager and scaffolds files into a repo it doesn't own, which is exactly the surface a fixture grid catches regressions on.
16b. **Stub the platform with a real local HTTP server, not mocks.** `@epic-web/test-server`'s `createTestHttpServer` stands up the routes the code under test calls and the test points the subject at it via env vars. Radius's `deploy.test.ts` currently injects a fake `platformClient` object — fine, but it doesn't exercise serialization, headers, or the idempotency keys `deploy.ts` constructs (`prepare-${org}-${digest}-${env}`). A stub server does.

### COPY WITH MODIFICATION

17. **"A failed rebuild changes nothing."** Radius already does this in `reloadDevelopmentRegistration` (keeps the last valid registration, prints why). Keep it; make it the explicit rule everywhere.
18. **Full session restart on config change, rather than in-place reload.** Trigger.dev tears down and reboots the dev session when `trigger.config.ts` changes. Radius instead reloads in place and then needs a guard — `"Agent identity cannot change while radius dev is running"` — to defend against drift. A restart has fewer states and deletes that guard. The caveat: Radius's `dev` restart is cheap (rewrite a JSON file) whereas Trigger.dev's is expensive, so Radius has *less* reason to avoid it.
19. **Replace `fs.watch` with `chokidar`.** Radius watches the config file's *directory* with `node:fs.watch` and a 75ms debounce; that's unreliable across platforms and editor save strategies. Trigger.dev gets debouncing free from esbuild's watch; Radius has no bundler in `dev`, so `chokidar` (already a Trigger.dev dep for the same reason) is the answer.
20. **Extract the flag→config precedence into one pure, tested function.** Trigger.dev gets this *half* right — `defu` centralises the merge, but the flag-vs-env decision is left to each caller (`options?.projectRef ?? envVars.TRIGGER_PROJECT_REF`), so precedence is still re-implemented per command. Radius currently does it entirely per call site (`options.endpoint ?? config.development?.endpoint`). Copy `defu`, but push the *whole* precedence chain into `loadAgentConfig` and unit-test it — `buildPath.test.ts` is the model for how much a pure decision function deserves testing.
21. **`c12` instead of raw `tsx/esm/api`.** Radius's `importConfig` has a visible workaround unwrapping a doubly-nested `default` export. c12+jiti is the maintained solution for this exact problem and brings `watchConfig` along. Keep Radius's `AgentConfigSchema.parse()` — **do not** copy Trigger.dev's typed-but-unvalidated config, which is a genuine weakness. Also narrow the six accepted filenames and error clearly when more than one exists.
22. **The `magicast` config-stripping trick**, if `radius.config.ts` ever gets bundled into the agent image. Not needed yet; needed the moment a config imports a build-time helper.
23. **Exit codes.** Trigger.dev's binary 0/1 is a floor, not a target. Radius should define distinct codes (auth, config, build, network) — it's cheap now and impossible later.

### AVOID

24. **The OpenTelemetry tracing scaffolding.** `tracer.startActiveSpan` wraps operations throughout, `recordSpanException` on failure, `--skip-telemetry` on every command — and **no `TracerProvider` is ever registered** (verified by grep across `src/`). Every span is a no-op, the flag controls nothing, and `handleTelemetry` sends nothing despite its name. This is dead weight that has survived to 4.5.16 and it makes the code meaningfully harder to read. If Radius wants telemetry, wire an exporter and mean it; otherwise write none.
25. **`handleTelemetry` as a name for "swallow the error and set exitCode 1".** Name the wrapper for what it does.
26. **A free-form string as the command name in `wrapCommandAction`.** `update.ts` passes `"dev"`. Derive it from the commander command.
27. **`installExitHandler()` registering a global `SIGINT → process.exit(0)` at import time.** It makes Ctrl-C report success, and it means correct shutdown in `dev` depends on `process.on` handler *ordering* — the supervisor's later handler only works because it calls `process.exit` itself. Radius's `dev.ts` already handles signals locally and per-command; keep it that way.
28. **Plaintext token storage with default umask.** `writeFileSync(configPath, JSON.stringify(config), { encoding: "utf-8" })` with no `mode`, yielding a typically world-readable file containing a full-account PAT. Radius's keyring-or-nothing policy is better. **If** the native dependency has to go for distribution reasons, the fallback must at least be `mode: 0o600` in a `0o700` directory — which is exactly what Radius already does for the dev registration file, so the pattern is in-repo.
29. **A 2,480-line `deploy.ts`.** The extracted helpers under `src/deploy/` are tested; the orchestrator is not, and cannot easily be. Radius's `deploy.ts` is 165 lines with injected `platformClient`/`pushOci` seams. Don't grow into this.
30. **Leaving the `dev` subsystem untested.** ~2,200 LOC in `src/dev/` with zero tests, because the code isn't written for injection. Radius's `dev.test.ts` already proves the alternative works.
31. **Silently swallowing platform-unreachable errors.** `#dequeueRuns()` catches everything and logs at `debug`, so a developer with a dead network sees an idle CLI and no explanation. Surface repeated failures.
32. **Stale flags documented in error strings.** `buildImage.ts` tells users to pass `--self-hosted`, which does not exist.
33. **Separate `promote` and `rollback` commands** — arguably. Trigger.dev has only `promote`, and rollback is `promote <older-version>`; Radius has both for the same server-side pointer move. Keep both only if `rollback`'s `--expected-revision` requirement is a genuinely different safety contract (it may well be — Trigger.dev has no optimistic-concurrency guard at all, and that's a Radius advantage worth keeping).

### NOT APPLICABLE to Radius

34. **The whole run-execution subsystem.** `TaskRunProcessPool`, warm starts, `maxExecutionsPerProcess`, OOM-triggered force-kill, `EXECUTE_TASK_RUN`/`TASK_HEARTBEAT` IPC, the dequeue loop, per-run snapshot polling. Trigger.dev's `dev` *is* a work executor pulling a queue from a remote platform. **`radius dev` does not run the developer's agent at all** — the developer starts their own process, and `dev` registers its loopback ACP WebSocket endpoint with the desktop app. There is no queue, no run, no worker pool. The transferable residue is narrow: typed IPC/protocol messages, and the "polling is the mechanism, push is the optimisation" principle.
35. **Socket.IO to a remote platform for `dev`.** Radius's `dev` transport is a JSON file in the user-data dir, consumed by a local desktop app. A three-channel remote architecture (socket + SSE presence + HTTP dequeue) has no counterpart. What *does* transfer is the observation that Trigger.dev has **three** liveness/work channels and Radius has **zero** — the desktop app cannot tell a live registration from an orphaned one.
36. **Server-assigned build versions and "deploy always rebuilds."** Trigger.dev has no `build` command and no reusable local artifact, because the platform builds the image and stamps the version. Radius deliberately inverts this: `build` produces a locally-verified, content-addressed, schema-versioned receipt and `deploy` ships *exactly that receipt's* artifact, refusing if the config drifted. **That is a better contract and Radius should keep it.** The one thing to import is the digest handshake — Radius already does the equivalent by sending `imageDigest` and `sourceManifestDigest` to `finalizeAgentDeployment`.
37. **Depot / `docker buildx` / remote build servers.** Radius builds an OCI layout in-process via `@curve-ai/build`, with no Docker daemon dependency. Trigger.dev's three-way `resolveBuildPath` split exists because it needs a Linux container builder it can't assume the user has. Radius doesn't need the mechanism — **but it has the same underlying problem and no answer**, see the new questions below.
38. **Indexing-by-execution as Trigger.dev implements it** (fork the bundle, let tasks self-register, emit a `WorkerManifest`). Radius's manifest comes from the declarative config (`createAgentManifest(config)`), not from executing user code, and the ACP protocol means capability discovery could be a live handshake instead. The *principle* — verify the artifact by executing it inside the environment it will run in — is exactly what `radius build`'s microVM smoke test already does.
39. **`trigger.config.ts` having no schema version.** Radius already has `schemaVersion: 1` and runtime `AgentConfigSchema.parse()`. Radius is ahead here; don't regress to match.
40. **`--env preview` / preview branches / `mint-token` user-actor tokens / the `mcp` and `skills` commands.** Product surface with no Radius counterpart today.
41. **`xdg-app-paths` for credentials.** Radius uses the OS keyring for secrets and already has a correct `radiusUserDataPath()` (Application Support / APPDATA / XDG) for non-secret data. No change needed.

---

## 9. New questions this raised, not covered by CUR-34

1. **How does `radius build` work off Apple Silicon?** `sandbox.ts` hard-fails on anything but darwin/arm64, so the microVM verification — the thing that makes the receipt mean anything — is unreachable in CI, on Linux, and on Intel Macs. CUR-34 asks "whether `build` is reachable in CI at all"; the source says flatly *no*. Trigger.dev's answer to the same problem was to move the container build to the platform (with local Docker as the self-hosted fallback). Does Radius need a **remote/platform build path**, an **unverified-build mode with a receipt that records `verification: null`**, or a **Linux verification backend**? This looks like the largest unresolved architectural question in the effort, and it is upstream of the receipt schema.
2. **What tells the Radius desktop app that a `dev` registration is dead?** The file carries `ownerPid` but nothing consumes it, and there's no heartbeat. Is liveness the CLI's job (watchdog + heartbeat mtime), the desktop app's (poll `kill(pid,0)`), or does the registration need a TTL? This is a *contract* question spanning CLI and desktop, so it belongs in the map even though the desktop is out of scope.
3. **Should any Radius timing or policy constant be server-supplied?** Trigger.dev fetches dequeue intervals and the build-path default from the platform, with a 404 fallback for old CLIs. Radius bakes everything in. Given CUR-34's version-pinning question, deciding *which* knobs the platform owns is worth settling before the config schema locks.
4. **What does `radius dev` do when the desktop app is absent — and is launching it even right?** Today `launchRadiusDesktop` throws if `open -a Radius` fails, killing the command. CUR-34 raises app absent/stale/duplicate; the source adds a fourth: **should `dev` launch the app at all**, or just register and report? Trigger.dev's `--no-browser` precedent suggests a flag for the headless/agent case.
5. **Does Radius need distinct exit codes, and what is the machine-readable output contract?** Trigger.dev is binary 0/1 and only some commands have `--json`. Radius has `--json` on some commands and no exit-code taxonomy. If the CLI is meant to be driven by CI or by an agent, both need specifying, and neither is in the map.
6. **Is the keyring dependency's cost actually payable at distribution time?** CUR-34 asks whether `@napi-rs/keyring` survives. The evidence sharpens the question: `packages/cli/package.json` already `--external`s it in three separate `bun build` invocations, and Trigger.dev — with vastly more users — ships plaintext. What is the concrete failure mode being defended against, and is it worth blocking a standalone binary?
7. **What is the `radius init` contract for a repo that already has files to modify?** Trigger.dev uses `jsonc-parser` to edit the user's `tsconfig.json` in place and `nypm` to install with whatever package manager they use. Radius's `init` writes new files and appends to `.gitignore`. CUR-34 asks what `init` writes per class of harness; the unasked half is **what it must safely modify** in a repo it doesn't own.
8. **Should `radius validate` exist as a separate command?** Trigger.dev has no `validate`; config loading fails loudly with an actionable message inside whatever command needed it. If Radius's `loadAgentConfig` produced errors that good, `validate` might be redundant surface.
