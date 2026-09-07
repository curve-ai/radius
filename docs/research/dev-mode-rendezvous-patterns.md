# CUR-38 — How adjacent platform CLIs handle "your process, our platform" dev mode

Research for [CUR-38](https://linear.app/curve-ai/issue/CUR-38), under map [CUR-34](https://linear.app/curve-ai/issue/CUR-34).
Primary sources only: vendor source on GitHub and first-party docs, read September 2026.

---

## 0. The question, restated precisely

`radius dev` has to solve a **rendezvous**: two processes with no parent/child
relationship — the developer's agent process and the Radius desktop app — must
find each other on one machine, agree on a transport, and notice when the other
goes away.

The incumbent answer is a **registry directory of JSON descriptor files** plus a
**best-effort app launch**. That is a real pattern with real precedent. The
question is whether the specific contract is sound.

Short answer: **the shape is right and has good precedent (Wrangler's dev
registry, Expo's dev-server list). Two things are wrong in the details** — the
endpoint is *declared* rather than *discovered*, and liveness is proven by PID
rather than by the thing that actually matters (is anything listening on that
socket). Both are cheap to fix.

---

## 1. The incumbent design, established from the code

### 1.1 The CLI half — `packages/cli/src/dev.ts`

`runDevelopmentAgent()`:

1. `loadAgentConfig(root, configPath)`.
2. Builds a `DevelopmentAgentConnection` (`developmentConnection()`):
   - `agentId = config.agent ?? "agent_dev_" + sha256(resolve(root)).slice(0,16)`
   - `endpoint = --endpoint ?? config.development.endpoint` — **required, and read
     verbatim from config**. The CLI never dials it.
   - `authorization` read from `process.env[authorizationEnv]` once, at
     registration time, and stored as `Bearer <token>`.
   - `ownerPid: process.pid` — the PID of the *CLI*, not of the agent process.
   - `registeredAt: new Date().toISOString()` — written once, never refreshed.
3. Writes it to `<userData>/development/agents/<agentId>.json`, mode `0600` inside a
   `0700` directory, via a `.tmp-<pid>` file + `rename` (atomic — good).
4. Calls `launchRadiusDesktop()`: `RADIUS_DESKTOP_PATH` if set, else `open -a Radius`
   (darwin), `cmd /c start "" Radius` (win32), `gtk-launch ai.curve.radius` (linux).
   Rejects if the launcher exits non-zero.
5. Prints four lines, `fs.watch`es `dirname(configPath)` filtered to the config
   basename with a 75 ms debounce, and awaits SIGINT/SIGTERM.
6. `finally`: closes the watcher and `rm -f`s the registration path.

On config change, `reloadDevelopmentRegistration()` re-reads the config, refuses a
changed `agentId`, and rewrites the descriptor. Errors are caught and reported as
"Radius kept the last valid development configuration".

### 1.2 The descriptor contract — `packages/runtime/src/development.ts`

Zod-validated. Notable enforcement:
- `schemaVersion: z.literal(1)` — no forward compatibility story.
- `agentId` must match `/^agent_[A-Za-z0-9_-]{6,64}$/`.
- `endpoint` must be a valid URL, **`ws:`/`wss:` only**, and **loopback-only**
  (`localhost`, `127.0.0.1`, `[::1]`, `::1`). Good security posture — a
  compromised descriptor cannot point the desktop app at a remote host.
- `cwd` must be absolute. `ownerPid` a positive int. `capabilities` ≤ 256 strings.

### 1.3 The desktop half — `apps/desktop/src/main/development-agents.ts`

- `listDevelopmentAgentConnections()` `readdir`s the directory, parses every `.json`,
  and **filters on `processIsAlive(connection.ownerPid)`** (`process.kill(pid, 0)`,
  treating `EPERM` as alive). Invalid files are logged and skipped. Results sorted by
  `registeredAt`.
- `initializeDevelopmentAgentConnections(onChange)` `mkdir -p`s the directory and
  `fs.watch`es it (`persistent: false`), broadcasting `AGENTS_CHANGED_CHANNEL` to
  every `BrowserWindow` on any change. Called from `index.ts:350` during app ready.
- `stopDevelopmentAgentConnections()` closes the watcher on `before-quit`.

### 1.4 How the descriptor is consumed — `apps/desktop/src/main/agent-runtime.ts`

- `listDesktopAgents()` (line 538) merges development connections with configured
  releases; **development wins** on `agentId` collision.
- `getDesktopRuntimeStatus()` (line 593) reports `releaseVersion: "development"`.
- `requireAgentTarget()` (line 2219) re-reads the directory fresh on every prompt and
  returns `{ kind: "development", connection }`.
- At line 1895 the session opens `AcpRuntimeSession.connect(acpStreamFromWebSocket(
  connection.endpoint, connection.authorization), { cwd: projectRoots[0] ?? connection.cwd, ... })`.
  `acpStreamFromWebSocket` (`packages/runtime/src/websocket.ts`) is a thin
  `createWebSocketStream` wrapper — **no retry, no backoff, no reconnect**.
- Any throw in that block lands in the `catch` at line 1960 and becomes the generic
  `AGENT_RUN_FAILED`, `retryable: true`. There is no dev-specific diagnostic.

### 1.5 The agent half — `packages/sdk/src/development.ts`

`serveDevelopmentAgent()` binds `options.port ?? 7331` on `127.0.0.1`, serving ACP
over HTTP + WebSocket upgrade at `/acp`, gated on an optional exact-match
`Authorization` header. It **returns the actually bound endpoint** — but nothing
carries that value back to the CLI.

`packages/cli/src/init.ts:44` hardcodes `development.endpoint: "ws://127.0.0.1:7331/acp"`
into the scaffolded config. The same literal appears in `examples/typescript-agent/`,
the contracts tests, and `dev.test.ts`.

### 1.6 Empirical verdict on the failure modes named in the ticket

| Failure mode | Handled? | Evidence |
|---|---|---|
| Crashed CLI leaves a stale registration | **Partially.** The file is never removed (SIGKILL skips `finally`), but the desktop ignores it via the `ownerPid` liveness check. Nothing ever garbage-collects the file, so the directory grows without bound. | `dev.ts` `finally`; `development-agents.ts` `processIsAlive` |
| Desktop app not installed | **Yes, loudly.** `open -a Radius` exits non-zero → `runLauncher` rejects → `radius dev` fails and the `finally` cleans up. Note the registration is written *before* the launch, so ordering is safe. **But** `cmd /c start "" Radius` on Windows exits 0 almost unconditionally — a false success. `gtk-launch ai.curve.radius` on Linux is untested and likely wrong for most installs. | `launchRadiusDesktop`, `runLauncher` |
| Desktop app not running | **Yes.** The CLI launches it; if already running, `open -a` is a no-op that focuses it. | same |
| App started *before* the file appears | **Yes.** The directory `fs.watch` fires and the renderer is told to re-list. | `initializeDevelopmentAgentConnections` |
| App started *after* the file appears | **Yes.** Every read path (`listDesktopAgents`, `getDesktopRuntimeStatus`, `requireAgentTarget`) does a fresh `readdir`. | `agent-runtime.ts` 538/593/2219 |
| Polls, watches, or reads once? | **Watches the directory, and re-reads on demand.** Neither polls nor reads only at startup. This is the strongest part of the design. | above |
| Two `radius dev` for the same agent | **No — and it is actively broken.** The path is keyed solely by `agentId`. Session B silently overwrites session A's descriptor; then whichever session exits *first* `rm`s the shared path, deleting the *other* live session's registration. The survivor becomes invisible to the desktop app with no error on either side. | `developmentRegistrationPath`, `finally` |
| Endpoint declared but nothing listening | **No.** The CLI never dials the endpoint before advertising it. The desktop lists the agent as available and fails only at prompt time, as `AGENT_RUN_FAILED`. | `developmentConnection`, line 1960 |
| Agent process dies, CLI survives | **No.** `ownerPid` is the *CLI's* PID. Since `radius dev` explicitly does not supervise the agent (`docs/architecture/agent-sdk-and-cli.md:24`: "It does not launch, watch, build, or restart agent source"), the exact case the design invites — agent dies, CLI keeps running — is the case liveness cannot detect. **This is the central flaw.** |
| PID reuse | **No.** A recycled PID makes a stale descriptor look live. Low probability, but the file is never cleaned so the exposure window is unbounded. |
| Fixed port 7331 collision | **No.** Two agents in dev on one machine both try to bind 7331; the second's `listen` rejects. The config-declared endpoint cannot express "whatever port I got". |
| Token rotation | **No.** `authorization` is snapshotted at registration; refreshing it requires touching the config file to trigger the reload watcher. |

Two further notes. The `.json.tmp-<pid>` staging files are correctly skipped by the
desktop's `.endsWith(".json")` filter, though they do cause harmless extra
`fs.watch` churn. And `schemaVersion: z.literal(1)` means a newer CLI writing v2
descriptors makes an older desktop app log a parse error and silently ignore the
agent — there is no "your Radius app is too old" path.

---

## 2. Pattern catalogue: how the field solves rendezvous

Six mechanisms recur. Radius uses #2.

### Pattern 1 — CLI spawns the app (parent/child supervision)

**Tauri.** `crates/tauri-cli/src/dev.rs` runs `build.beforeDevCommand` as a
`SharedChild`, then polls a **raw TCP connect** against the parsed `build.devUrl`
(2 s interval, 1 s timeout, 90 attempts ≈ 3 min; skippable with
`--no-dev-server-wait` / `TAURI_CLI_NO_DEV_SERVER_WAIT`), then runs `cargo run`,
which compiles *and* launches the app in one command.

Crucially, **there is no runtime handshake at all**: the CLI serializes merged config
into a `TAURI_CONFIG` env var (`helpers/config.rs`), `tauri-build`'s `build.rs` reads
it at compile time (`cargo:rerun-if-env-changed=TAURI_CONFIG`) and bakes it in via
`generate_context!()`. The running binary reads `devUrl` from its own compiled
`Context`. The app is *born knowing* where to connect.

Crash handling is explicit: `on_app_exit` distinguishes `TriggeredKill` (watcher
restart), `CompilationFailed` (cargo exit 101 — CLI survives, waits for next save),
and `NormalExit` (a real crash — kills `beforeDevCommand` and **exits the whole CLI**).
No auto-restart of a crashed app.

Tauri also takes zombie cleanup seriously, because frontend tooling forks detached
grandchildren: a `ctrlc::set_handler` calls `kill_before_dev_process()`, which shells
out to a bundled `crates/tauri-cli/scripts/kill-children.sh` (recursive `pgrep -P`) on
Unix and a PowerShell `Kill-Tree` over `Win32_Process`/`ParentProcessId` on Windows.

**Electron Forge.** `packages/api/core/src/api/start.ts` spawns the Electron binary with
`stdio: 'inherit'` and full env inheritance. The renderer dev server runs
*in-process* as a Vite JS-API call; its real bound port is read back from
`server.httpServer.address()` and substituted into the main bundle via Vite `define`
as `MAIN_WINDOW_VITE_DEV_SERVER_URL` — again compile-time, and again no polling is
needed because sequential in-process ordering replaces discovery entirely. Notably
`pluginHotRestart('restart')` is **stubbed** (`// TODO: blocked in #3380`): main-process
edits do *not* auto-restart; you type `rs`.

**electron-vite** is the cleaner variant — `src/server.ts` sets
`process.env.ELECTRON_RENDERER_URL` on the parent right before `spawn`, and the child
reads it **at runtime**, a genuine live handshake. Main-process changes do trigger a
real `ps.kill()` + `startElectron()`. `ps.on('close', process.exit)` propagates death
upward.

> **Failure modes:** none of the stale-state problems exist — the OS process tree *is*
> the registry. Cost: the CLI must own the app's lifecycle, which is precisely what
> Radius has ruled out, and what Radius cannot do anyway (the desktop app is a
> long-lived, user-owned, possibly-already-running GUI, not a per-project child).

### Pattern 2 — Registry directory of descriptor files (what Radius does)

**Wrangler's dev registry** is the closest structural analogue and the most direct
precedent for the incumbent design: separate `wrangler dev` sessions discover each
other for service bindings through a directory of one-JSON-file-per-worker holding
port/protocol/host/durable-object metadata. (Details from the cloud-CLI research pass;
see §3.)

**Expo's `.expo/` directory** is instructive mainly for what it *no longer* does. The
historical `packager-info.json` (ports and PIDs) is **gone**. Current source
(`packages/@expo/cli/src/start/project/dotExpo.ts`) keeps only:
- `.expo/settings.json` — `{ urlRandomness }` for stable tunnel subdomains. **No ports,
  no PIDs.**
- `.expo/devices.json` — `{ devices: [{ installationId, lastUsed }] }`, populated from the
  `expo-dev-client-id` header on manifest fetches. Staleness is handled **purely by
  time**: a 30-day age cutoff and a cap of 10 entries. No liveness check at all.

Neither file drives discovery. Expo deliberately moved rendezvous *out* of the state
file and into live network protocols. Nothing is deleted on shutdown —
`DevServerManager.stopAsync()` stops watchers and servers via `Promise.allSettled` and
leaves both files in place by design.

> **Failure modes:** stale entries after an ungraceful exit; no natural key for
> concurrent sessions; the descriptor's contents can drift from reality between writes.
> The two credible mitigations are **liveness proof** (PID check, heartbeat, or —
> best — probing the advertised socket) and **content-addressed filenames** so
> concurrent sessions don't collide.

### Pattern 3 — Long-lived daemon behind a Unix socket

**flyctl** runs a background agent daemon that other `flyctl` invocations connect to
over a Unix socket, with an explicit version check that kills a stale agent.
**Encore** likewise spawns an `encore daemon` on demand and talks to it over a socket.
(See §3.)

> **Failure modes:** stale socket files after a crash; version skew between the CLI that
> started the daemon and the CLI now connecting (both handle this by *killing and
> respawning* on mismatch); permissions and `$TMPDIR` path-length limits.
> Strength: the socket *is* the liveness proof — connect succeeds or it doesn't, with
> no PID guessing.

### Pattern 4 — Multicast service discovery (mDNS / DNS-SD / Bonjour / NSD)

**Expo's on-device "development servers" list** — the mechanism the ticket flags as the
closest analogue, and worth reading closely.

*CLI side (advertise):* `packages/@expo/cli/src/start/server/Bonjour.ts` advertises a
`_expo._tcp` DNS-SD service via `dnssd-advertise`, TXT record carrying `name`, `slug`,
`androidPackage`, `iosBundleIdentifier`, `username`. **Gated behind
`EXPO_UNSTABLE_BONJOUR`** — still opt-in, not default, in current source.

*Client side (browse):*
- Android — `packages/expo-dev-launcher/android/src/debug/java/expo/modules/devlauncher/nsd/`
  (`NsdDiscoveryBase.kt`, `NsdDiscoveryApi34.kt`, `NsdDiscoveryLegacy.kt`, `NsdDiscovery.kt`,
  `NsdDiscoveryListener.kt`) plus `services/PackagerService.kt` exposing
  `runningPackagers: StateFlow<Set<PackagerInfo>>`. Calls
  `manager.discoverServices("_expo._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)`.
- iOS — `packages/expo-dev-launcher/ios/SwiftUI/`: `NetworkUtilities.swift` (Apple
  `Network` framework, `NWConnection`/`NWEndpoint`), `DevServerMetadata.swift` (parses the
  `NWTXTRecord`; its doc comment names `Bonjour.ts` as the source of truth),
  `LocalNetworkConfig.swift` (hardcodes `bonjourServiceType = "_expo._tcp"`, checks
  `Info.plist` for `NSLocalNetworkUsageDescription` / `NSBonjourServices`),
  `DevServersView.swift` ("Searching for development servers…" plus manual URL entry).

**The staleness answer is the important bit.** Expo cannot use PIDs — the client is on a
different device. So it uses an **active health check**: on discovery it resolves the TXT
record and then polls `GET <url>/status`, listing the server **only if the body is
literally `packager-status:running`** — Android on a recurring 3-second loop, iOS on
resolve with a 7 s timeout race. mDNS's own `onServiceLost` goodbye prunes entries
immediately as well. That `/status` route is served by Metro
(`start/server/metro/dev-server/createMetroMiddleware.ts`); the manifest itself is served
by `ManifestMiddleware` at `/`, `/manifest`, and `/index.exp`.

Expo layers manual fallbacks beneath this: QR code and `exp://` deep links built by
`UrlCreator.ts` (`hostType` of `localhost` / `lan` / `tunnel`, with
`constructDevClientUrl()` producing `exp://expo-development-client/?url=<encoded>`), and
an ngrok tunnel (`AsyncNgrok.ts`, `exp.direct` domain) for networks where multicast and
LAN both fail. `DevelopmentSession.ts` additionally fire-and-forgets a ping to Expo's
cloud so a "recently opened" list exists server-side (skipped under `CI` / `EXPO_OFFLINE`).

> **Failure modes:** multicast (224.0.0.251:5353) is blocked by most corporate VLANs and
> client-isolated Wi-Fi; iOS requires a Local Network permission prompt; there is no
> authentication in the discovery layer. Every one of these is why Expo keeps manual URL
> entry and tunnels as fallbacks.

> **Relevance to Radius:** the *discovery* half is overkill — Radius is same-machine and
> loopback-only by schema. The **health-check half is exactly what Radius is missing.**
> Expo learned that "a process is alive" and "a server is answering" are different
> claims, and only the second one matters.

### Pattern 5 — Well-known fixed port

Tauri's built-in static dev server defaults to `127.0.0.1:1430` (`--port` /
`TAURI_CLI_PORT`). Radius's SDK defaults to `7331`.

> **Failure modes:** collision with a second instance or an unrelated process; no way to
> tell "my server" from "someone else's server on my port". Everyone who uses a fixed
> port also provides an override, and the mature systems (Vite's non-strict port
> auto-bump, Forge reading `server.httpServer.address()` back) treat the fixed port as a
> *hint* and the actually-bound port as the truth.

### Pattern 6 — Cloud round-trip

Expo's `DevelopmentSession.ts` ping; Modal's `modal serve`. Requires network and an
account; unusable offline. Radius should not need this: both parties are on one machine.

---

## 3. The cloud-CLI comparators

| | Local rendezvous | Supervises user's process? | Build/deploy |
|---|---|---|---|
| **Wrangler** | Registry dir `~/.wrangler/registry/<name>` | Yes (Miniflare supervises `workerd`) | Fused, always |
| **Vercel** | None found | Partial (proxies your framework's dev script) | Fused by default; `--prebuilt` opt-out |
| **flyctl** | Unix socket daemon `~/.fly/fly-agent.sock` | No | Fused by default; `--image` opt-out |
| **Modal** | None — in-memory `app_id` + server heartbeat | Only its own watch subprocess | Fused, always |
| **Encore** | Unix socket daemon `~/.cache/encore/encored.sock` | Yes (recompiles + restarts your binary) | **Separated** |
| **Supabase** | Docker labels | No (Docker does) | Split by artifact type |

### 3.1 Wrangler's dev registry — the direct precedent, and the one to copy

`packages/miniflare/src/shared/dev-registry.ts` (moved there from
`packages/wrangler/src/dev-registry.ts`), with a committed architecture note at
[`DEV_REGISTRY.md`](https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/src/shared/DEV_REGISTRY.md).

Independently-running `wrangler dev` sessions discover each other (for service and
Durable Object bindings) through **one JSON file per running worker** in a
**global, per-user** directory — not project-local:

```ts
export function getDefaultDevRegistryPath() {
  return process.env.MINIFLARE_REGISTRY_PATH
    ?? path.join(getGlobalConfigPath(), "registry");
}
```

`getGlobalConfigPath()` resolves to `~/.wrangler` when it exists, else an XDG dir —
so in practice `~/.wrangler/registry/<worker-name>`. The `WorkerDefinition` payload
carries `debugPortAddress`, `defaultEntrypointService`, `userWorkerService`,
`queueConsumers?`, `storageScope?`. **This is structurally the same design as
`~/Library/Application Support/Radius/development/agents/<agentId>.json`.**

Four details Radius does not have:

1. **Heartbeat by mtime.** Each owner `utimesSync`'s its own file every
   `WORKER_HEARTBEAT_MS = 10_000` (2 s for shared-storage candidates).
2. **TTL sweep.** Readers treat a file older than `WORKER_STALE_MS = 90_000` as dead
   and delete it in place:
   ```ts
   if (stats.mtime.getTime() < Date.now() - staleMs) {
     try { unlinkSync(definitionPath); } catch {}
     continue;
   }
   ```
   Note it **unlinks**, so the directory self-cleans. There is **no `process.kill(pid,0)`
   and no port probe anywhere in this path** — Cloudflare chose liveness-by-heartbeat
   over liveness-by-PID.
3. **Name-claim arbitration.** A new registrant claiming an already-present name checks
   the existing file's age and either deletes-and-claims (stale) or **defers with a retry
   timeout** (a live `instanceId` still owns it). This is precisely the concurrent-session
   case Radius gets wrong.
4. **Graceful deregistration + self-healing.** `DevRegistry.dispose()` → `unregisterWorkers()`
   deletes every file owned by this `instanceId` before closing the watcher, so Ctrl-C
   deregisters instantly and only a hard kill falls back to the 90 s TTL. Conversely the
   heartbeat interval notices if its *own* file vanished unexpectedly (e.g. a system-sleep
   false-positive sweep) and recreates it.

Watching is `chokidar.watch(registryPath, { usePolling: process.platform === "win32",
interval: 100 })`, diffed against a cached snapshot to avoid redundant reconfiguration —
worth noting because raw `fs.watch` (what Radius uses on both ends) is documented as
unreliable on some platforms and fires spuriously.

Terminal UX is an interactive hotkey bar (`packages/wrangler/src/dev/hotkeys.ts`):
`b` browser, `d` devtools, `l` toggle local/remote, `c` clear, `x`/`q`/Ctrl-C exit into
`primaryDevEnv.teardown()`. Signals are centralized in
`packages/miniflare/src/exit-hook.ts`, which drives dispose callbacks before re-raising
default signal behaviour.

### 3.2 flyctl and Encore — the socket-daemon alternative

Both replace "a file says it's alive" with "the socket either connects or it doesn't."

**flyctl** (`agent/` in `github.com/superfly/flyctl`). Socket at
`filepath.Join(helpers.GetConfigDirectory(), "fly-agent.sock")` — typically
`~/.fly/fly-agent.sock`. `StartDaemon` (`agent/start.go`) takes a file lock at
`[ConfigDir]/flyctl.agent.start.lock` via `filemu.Lock()` to prevent duplicate concurrent
starts (raising `alreadyStartingError` on a race), writes a log under
`[ConfigDir]/agent-logs` (mode `0o700`, pruned after 1 day), forks `flyctl agent run` as a
detached subprocess, then polls `DefaultClient()` every 50 ms for up to 5 s. A stale
orphaned socket simply fails to dial and routes into that same start path.

Version skew is handled by **kill-and-restart**: `Establish()` pings, gets
`PingResponse{pid, version, background}`, and keeps the agent only if
`buildinfo.Version().Equal(resVer)` (or dev-channel-newer); otherwise `c.Kill()`, wait for
socket deletion, `StartDaemon()` again. `fly agent start|stop|restart|run|ping` are exposed
as subcommands.

**Encore** (`cli/daemon/daemon.go`). Socket at
`filepath.Join(os.UserCacheDir(), "encore", "encored.sock")`. `ConnectDaemon` dials with a
500 ms timeout and on failure `StartDaemonInBackground` re-execs the same binary as
`encore daemon -f` in a new process group, polling 50x100 ms for the socket to appear.
Staleness is a **version + config-hash handshake**: newer daemon → keep; same version but
different `ConfigHash` → *"encore: restarting daemon due to configuration change."*; older →
*"encore: daemon is running an outdated version (%s), restarting."* Restart is
`os.Remove(socketPath)`, after which the daemon's own `detectSocketClose()` goroutine
(polling every 200 ms, comparing via `xos.SameSocket`) exits gracefully. **No PID file
anywhere.**

Encore is also the survey's one true supervisor: `run.Manager.watch()`
(`cli/daemon/run/watch.go`) prints *"Changes detected, recompiling..."*, kills the process
group and starts a freshly compiled binary, then *"Reloaded successfully."*

### 3.3 The rest, briefly

**Vercel.** No cross-process registry found in docs or `packages/cli/src/util/dev/server.ts`.
`.vercel/` holds `project.json` (`orgId`/`projectId`), `repo.json`, pulled `.env.*.local`,
and `output/` build artifacts. Architecturally consistent: functions are proxied through one
router process, so there is no independent-services-finding-each-other problem. When a
framework dev script exists, `vercel dev` runs it on a random port and proxies 3000 to it —
a launcher/proxy, not a supervisor with restart semantics.

**Modal.** No local daemon and no registry at all. `~/.modal.toml` is credentials only
(`token_id`, `token_secret`, `loglevel`, `force_build`). Rendezvous reduces to an in-memory
`app_id` plus a server-side `AppHeartbeat` loop (`py/modal/runner.py`); exit sends
`AppClientDisconnect`. `modal serve`'s reload (`py/modal/serving.py`) kills and respawns a
`multiprocessing` child, reusing the same `app_id` via `serve_update(...)` — no file needed
because the parent just holds the id.

**Supabase.** **Docker itself is the registry.** Every container/network/volume is labelled
`com.supabase.cli.project=<project_id>` (`apps/cli-go/internal/utils/docker.go`), and
`supabase status` queries Docker directly rather than any CLI-maintained file
(`internal/status/status.go` → `ContainerList` with `CliProjectFilter`). `supabase/.temp/`
exists but holds only `project-ref`, an update-check throttle, and cached version tags —
it is *not* consulted by `start`/`status`/`stop`. On a port collision the CLI re-lists all
containers, reads the offender's label, and suggests `supabase stop --project-id <id>`.
A good reminder that **the best registry is often a system that already tracks liveness for
you.**

### 3.4 Is "deploy never rebuilds" normal or unusually rigid?

**It is normal at the infrastructure layer and unusual among developer-experience CLIs.**
Radius sits in the second category but has adopted the first category's rule.

*Enforced strictly by construction — no build capability exists:*
- **Kubernetes + Docker.** `kubectl` has no build verb and no awareness of Dockerfiles; a
  `Deployment` spec carries only an `image:` string. The purest example.
- **Terraform.** Never builds application source; `apply` references an AMI id or image tag
  produced by Packer/Docker/CI.

*Enforced as the documented standard flow:*
- **AWS SAM.** *"When using `sam deploy`, the AWS SAM CLI deploys your application's build
  artifacts located in the `.aws-sam` directory. When you make changes to your application's
  original files, run `sam build` to update the `.aws-sam` directory before deploying."*

*Offered as the production-recommended alternative to a fused convenience mode:*
- **Google Cloud Run.** `gcloud run deploy --source .` is described by Google itself as
  *"a convenience feature"* that *"does not allow full customization of the build"*;
  `--image` is the decoupled mode recommended for *"production deployments, teams with
  existing build pipelines."*
- **Heroku.** `git push heroku main` fuses; the container flow splits `heroku container:push`
  from an explicit `heroku container:release`. Deliberate hardening — the changelog records
  *"Pushing images to Container Registry no longer creates a release."*
- **Elastic Beanstalk.** `eb deploy` uploads source for server-side build; `Dockerrun.aws.json`
  v2 referencing a pre-built image is the strict path.

*Fused by default, separation as an opt-in escape hatch:*
- **Wrangler** — `deploy` always bundles via esbuild; `--no-bundle` skips only Wrangler's own
  pass, not the build/upload. **No artifact-only deploy path exists at all.**
- **Vercel** — `build` + `deploy --prebuilt` is a documented CI pattern, explicitly pitched as
  letting you deploy *"without sharing the source code with Vercel."*
- **flyctl** — `deploy --image <ref>`. **Netlify** — `deploy --no-build --dir`.
  **Serverless Framework** — `package` + `deploy --package`, added *"for Better CI/CD Support."*
- **Modal** — the most fused of all: no build verb exists; `deploy` always resolves and builds
  changed Images.

*The one genuine peer:*
- **Encore** separates `encore run` (dev), `encore build docker` (a real, inspectable,
  independently shippable image built by *"exactly the same code path that Encore's CI system
  uses"*), and cloud deploy (`git push encore`).

**Conclusion.** Radius's stance — `deploy` refuses a stale receipt and never rebuilds
(`docs/architecture/agent-sdk-and-cli.md:41,45`; `deploy.ts` compares
`canonicalJson(build.manifest)` against the live config and throws *"Radius config changed
after the selected build; run radius build again"*) — is **more rigid than every
developer-experience CLI surveyed, and squarely normal for infrastructure tooling.**

That rigidity is *defensible here* and should be kept, because Radius's artifact is a
digest-addressed OCI image whose identity is the entire point of the deployment record. But
it carries a cost, and one internal inconsistency worth flagging:
`docs/architecture/agent-sdk-and-cli.md:88-92` advertises the quickstart as
`init → dev → build → deploy`, four commands where every comparator markets three. The
honest options are to keep four and say why, or to let `deploy` *invoke* `build` when no
receipt exists while still refusing to *silently* rebuild a drifted one — which is Cloud Run's
`--source` / `--image` split rather than an abandonment of the principle.

---

## 4. Recommendation for Radius

### 4.1 What to keep

The registry-directory shape is **correct and well-precedented** — it is Wrangler's design.
Keep also: atomic tmp+rename writes, `0600`/`0700` modes, loopback-and-WebSocket-only schema
enforcement, the desktop's directory watch, and fresh re-reads on every access path. Keep the
non-supervision stance; flyctl, Modal, Vercel and Supabase all decline to supervise the user's
process, and only Encore (which owns the compiler) does.

### 4.2 The five changes

**(1) Discover the endpoint; stop declaring it.** This is the most important change.
`serveDevelopmentAgent()` already returns the real bound endpoint, and `init.ts` already
hardcodes `ws://127.0.0.1:7331/acp` into config — the information flows the wrong way. Every
comparator that got this right reads the *actually bound* address back: Electron Forge reads
`server.httpServer.address()` and substitutes it as `MAIN_WINDOW_VITE_DEV_SERVER_URL`;
electron-vite passes `ELECTRON_RENDERER_URL` down at runtime.

Concretely: have the SDK dev server write its own bound endpoint to a well-known path (or
have `radius dev` accept it on stdin / via a file descriptor), default the SDK to port `0`,
and treat `development.endpoint` in config as an override rather than the source of truth.
This removes the fixed-7331 collision class entirely.

**(2) Prove liveness by probing the socket, not the PID.** `ownerPid` is the *CLI's* PID, and
since `radius dev` explicitly does not supervise the agent, the failure it most needs to detect
— agent dead, CLI alive — is exactly the one a PID check cannot see. Expo hit this and answered
with an active health check (`GET /status`, expecting literally `packager-status:running`,
re-polled every 3 s on Android). Do the same: before advertising, `radius dev` should dial the
ACP endpoint and complete a handshake, failing with a real diagnostic if nothing answers; and
the desktop should treat "descriptor present" as a candidate, not a promise.

**(3) Heartbeat + TTL, and unlink stale files.** Copy Wrangler exactly: `utimesSync` the
descriptor on an interval (10 s), and have the desktop treat `mtime < now - 90s` as dead **and
`unlink` it**. This fixes both unbounded directory growth and the PID-reuse hazard, and it
degrades correctly when the CLI is `SIGKILL`ed. Keep the `finally` unlink as the fast path;
the TTL is the backstop.

**(4) Make concurrent sessions safe.** Today session B silently clobbers A's descriptor and
whichever exits first deletes the survivor's file. Two parts: give each descriptor an
`instanceId` and only ever unlink files whose `instanceId` matches your own (Wrangler's
`unregisterWorkers()`), and add name-claim arbitration — on finding a live descriptor for the
same `agentId`, either refuse with *"`radius dev` is already running for this agent (pid N)"*
or defer with a retry, rather than overwrite.

**(5) Give failure a voice.** Right now a dead endpoint surfaces as generic
`AGENT_RUN_FAILED` (`agent-runtime.ts:1961`). Add a distinct error code for "development
endpoint unreachable" carrying the endpoint and the descriptor path, and fix the two launcher
lies: `cmd /c start "" Radius` exits 0 whether or not Radius exists, and
`gtk-launch ai.curve.radius` is unlikely to be correct on most Linux installs. Also add a
`schemaVersion` mismatch path that says *"your Radius app is too old for this CLI"* instead of
logging a parse error and silently hiding the agent.

### 4.3 Recommended mechanism, stated plainly

> **Keep the per-user registry directory of JSON descriptors. Add: endpoint discovered from
> the agent's actual bind, a pre-advertisement ACP handshake probe, a 10 s mtime heartbeat with
> a 90 s TTL sweep that unlinks, an `instanceId` guarding both unlink and name-claim, and a
> distinct unreachable-endpoint error code.**

A Unix-socket daemon (flyctl/Encore) is the theoretically cleaner design — the socket *is* the
liveness proof, with no staleness question to answer — but it is the wrong trade here. Radius
already has a long-lived process that could hold such a socket (the desktop app), yet the app
is user-launched and may not be running when `radius dev` starts, which reintroduces exactly the
bootstrapping problem the registry solves. The file registry also survives the app restarting
underneath a live dev session, which a socket held by the app would not. Wrangler reached the
same conclusion for the same reason.

mDNS (Expo) is overkill: Radius is same-machine and loopback-only by schema. But Expo's
*health-check* half is exactly what Radius is missing — Expo learned that "a process is alive"
and "a server is answering" are different claims, and only the second one matters.

### 4.4 Failure modes of the recommendation, enumerated

1. **Clock skew or a paused machine** makes mtime-based TTL misjudge liveness. Wrangler hit
   this after system sleep; its answer is self-healing — the owner's heartbeat notices its own
   file was swept and recreates it. Adopt that.
2. **Heartbeat write storms.** Every `utimesSync` wakes the desktop's directory watcher. With
   several sessions at 10 s this is trivial, but the watcher handler must be cheap and
   debounced, and ideally diffed against a cached snapshot (Wrangler does exactly this) rather
   than re-listing eagerly.
3. **`fs.watch` unreliability.** Node documents platform caveats; Wrangler uses chokidar with
   `usePolling` on Windows. The 90 s TTL means a missed event self-corrects within a sweep, but
   the desktop should not rely on the watcher alone for correctness.
4. **The probe passes, then the agent dies.** A handshake at registration time proves only
   that moment. Mitigation: the desktop should surface connect failure distinctly and re-probe
   before listing, but there is an irreducible race here — any rendezvous can only report the
   past.
5. **Probe false-negative on a slow agent.** If `radius dev` starts before the agent's server
   binds, a strict pre-advertisement probe fails a legitimate setup. Needs Tauri's answer: a
   bounded retry loop (Tauri polls TCP every 2 s up to 90 attempts, with
   `--no-dev-server-wait` to skip) rather than a single attempt.
6. **`instanceId` collision** if generated weakly. Use `randomUUID()`, not the PID.
7. **Port `0` breaks anyone who hardcoded 7331.** The literal already appears in
   `init.ts`, `examples/typescript-agent/radius.config.ts`, the contracts tests and
   `dev.test.ts`. Requires a migration: keep honouring an explicit `development.endpoint`.
8. **Two dev sessions in the same directory** still collide on `agentId`, since it derives from
   `sha256(root)`. Arbitration turns silent corruption into a clear error, which is the right
   outcome, but the error message must name the incumbent PID or nobody will understand it.
9. **Descriptor schema evolution.** `z.literal(1)` still hard-fails across versions. Widen to
   a minimum-supported-version check with an explicit user-facing message.
10. **Stale `authorization`.** Still snapshotted at registration. Rotating a dev token requires
    touching the config to trigger the reload watcher; either document this or re-read the env
    on heartbeat.
11. **Cross-user `EPERM`.** If PID checks are retained alongside the TTL, note that
    `processIsAlive` treats `EPERM` as alive, so another user's recycled PID reads as live.
    Dropping the PID check in favour of the heartbeat removes this entirely.
12. **The desktop never being installed** remains a hard failure by design — but must be
    detected honestly on Windows and Linux, where the current launchers cannot tell.

---

## Open questions surfaced

- **Should the SDK dev server own the registration instead of the CLI?** If the endpoint must
  be discovered from the actual bind, the agent process knows it first and is the process whose
  liveness actually matters. That would make `radius dev` a *viewer* (launch the app, tail
  status, clean up) rather than the registrar — closer to Expo's split, and it would make
  `ownerPid` meaningful. But it pushes registry-format knowledge into every SDK, including the
  Python one and any third-party harness.
- **What registers a non-SDK harness?** The map's central tension (CUR-34: `runtime.kind:
  "command"` vs. the scaffolded `@curve-ai/sdk` agent) lands directly here. An existing fx or
  LangChain agent cannot be asked to write a Radius descriptor, so for that class the CLI must
  remain the registrar — implying **both** paths must work.
- **Should `radius dev` supervise after all?** Every comparator that supervises (Encore, Tauri,
  Forge) owns the build toolchain. Radius does not — but the cost of not supervising is that
  nothing notices when the agent dies. Is a *watch-without-restart* middle ground (detect death,
  report it, keep the registration but mark it unhealthy) worth prototyping?
- **Does the desktop app need a "dev sessions" surface?** Expo, Wrangler and Supabase all give
  the user a way to see and kill what is running. Radius currently has no UI for "these agents
  are registered but unreachable."
- **Is four commands right?** Every comparator markets three. Worth settling deliberately given
  section 3.4.
