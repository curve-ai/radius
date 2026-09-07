# CUR-36 — Which CLI framework should Radius build on

Research date: **2026-09-06**. All version/cadence figures pulled live from the npm registry
on that date; all behavioural claims were verified by executing the libraries locally
(Node v22.17.0, bun 1.3.4, macOS arm64), not from documentation or recall.

---

## 0. Recommendation up front

**Adopt Commander 15.** Keep `runCli(argv, { cwd, io, readSecret })` exactly as it is and put
Commander *behind* it. Load each command module with a dynamic `import()` inside the action
handler. Add `picocolors` only when something actually needs colour, and `@clack/prompts`
only on the `login` path.

**Do not adopt oclif.** Its differentiator is a plugin system that Radius has no requirement
for (see §5), and it is disqualified on mechanics anyway: `@oclif/core` is CommonJS and
discovers commands by globbing the filesystem at runtime, which is incompatible with the
single-file ESM artifact `bun build --outfile=dist/cli.js` produces.

**Runner-up: Stricli**, and it is a close one. It is the only candidate where the injected-IO
seam is a first-class framework primitive rather than something you bolt on. §4 says what
would flip the decision.

The single most important finding in this investigation is **not about frameworks at all** —
see §2. The framework is worth roughly 12 lines of adapter code; the startup problem the
ticket is worried about is caused by something else entirely and is fixable independently.

---

## 1. What the code actually is

Read before scoring: `packages/cli/package.json`, `src/main.ts` (492 lines), `src/io.ts`
(9 lines), `src/cli.ts`, `src/main.test.ts`, `src/login.test.ts`, `src/profiles.test.ts`.

Measured surface:

| Metric | Value |
| --- | --- |
| `main.ts` | 492 lines |
| `parseArgs` call sites in `main.ts` | 16 |
| Distinct flag names | 25 |
| Leaf commands (incl. subcommands) | 24 |
| Whole package | 3,374 lines across 32 files |

The 24 leaves: `init`, `validate`, `dev`, `deploy`, `build`, `promote`, `rollback`,
`deployments list`, `environments status`, `profiles list|add|switch`, `login`, `logout`,
`tokens list|create|revoke`, `members list|role|suspend|restore|remove`, `platform-info`,
`whoami`.

### The seam is already better than the ticket gives it credit for

`main.ts` is a **pure argv→options adapter and nothing else**. Every command module already
exposes a plain async function taking an options object that carries `root`, `io`, and its
injectable collaborators:

- `deployAgent(options)`, `buildAgent(options)`, `runDevelopmentAgent(options)`,
  `initializeAgentProject(options)`, `listDeveloperTokens(options)` … all take `io: CliIo`.
- `loginToRadius` additionally accepts injected `fetch`, `profileStore`, `credentialStore`
  (`src/login.test.ts` exercises all three with no network and no keychain).
- Domain validation already lives in the command modules, not the parser — e.g. the
  "at least one `--scope`" rule is in `tokens.ts:parseScopes`, not in `main.ts`.

`CliIo` is nine lines and deliberately narrow:

```ts
export interface CliIo { out(message: string): void; error(message: string): void; }
```

`runCli` **throws rather than exiting**; `cli.ts` is the only place that touches
`process.exitCode`. That is what lets `main.test.ts` write `await assert.rejects(runCli([...]))`
in-process.

**Consequence for scoring:** the framework decision touches `main.ts` and `main.test.ts` and
nothing else. The 13 command modules and their tests are already framework-agnostic and do not
move. Any framework that forces `process.exit`, writes help directly to `process.stdout`, or
insists on owning the entry point is not merely inconvenient — it breaks the one property the
ticket says must survive.

---

## 2. The startup finding (independent of framework choice)

Measured, `bun build src/cli.ts --target=node --format=esm --external @napi-rs/keyring`:

- Bundle: **1.46 MB, 185 modules**
- `node dist/cli.js --help`: **~90 ms warm** (bare `node -e ""` baseline is 30 ms)
- Time inside `import()` of the bundle alone: **~60–66 ms**

Where those 60 ms go — top modules by byte weight in the emitted bundle:

| KB | Module |
| --- | --- |
| 100.4 | `tsx/dist/index-DQtFPMc2.mjs` |
| 99.3 | `tsx/node_modules/esbuild/lib/main.js` |
| 99.0 | `esbuild/lib/main.js` |
| 70.3 | `zod/v4/core/schemas.js` |
| 60.0 | `@agentclientprotocol/sdk/dist/schema/zod.gen.js` |
| 55.1 | `zod/v4/core/compile.js` |
| 40.4 | `zod/v4/classic/schemas.js` |
| 25.5 | `ws/lib/websocket.js` |

Roughly **700 KB of the 1.46 MB is tsx + two copies of esbuild + zod + the ACP schema**, and
every one of them is evaluated on `radius --help`. The cause is a static import chain:
`main.ts` → `config.ts` → `import { tsImport } from "tsx/esm/api"`, plus `main.ts` statically
importing all 13 command modules so `dev.ts`'s ACP/ws graph loads for every invocation.

### Dynamic imports survive `bun build --outfile`

I checked whether laziness survives single-file bundling, because if it did not, the fix would
require changing the distribution model. It does. Bun wraps dynamically-imported modules in
deferred initialiser thunks:

```js
var init_heavy = __esm(() => { console.error("HEAVY MODULE EVALUATED"); });
```

Verified: the module is inlined into the single output file (so bundle size and the
`@napi-rs/keyring` external arrangement are unaffected) but **is not evaluated until the
dynamic import actually runs**. Confirmed on the help path (silent) and the run path (fires).

**So:** switching `main.ts` to `await import("./deploy.js")` inside each action, and making
`config.ts`'s `tsImport` a dynamic import, should recover most of that 60 ms with **no change
to the build command, the output shape, or the packaging story**. This is worth more than any
framework choice on this list, and it is orthogonal to all of them. Do it regardless of who wins.

---

## 3. Parser comparison

Versions and cadence from the npm registry, 2026-09-06. Import cost is best-of-3 warm
`await import()` on Node v22.17.0. Size is the registry-reported unpacked size of the package alone, excluding transitive deps.

| | Version (date) | rel/12mo | Module fmt | Deps | Size | Import | Nested subcmds | Injectable IO / no `process.exit` | Bundles to 1 file | Plugins |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Commander** | 15.0.0 (2026-05-29) | 5 | **ESM** | 0 | 203KB | 7.7 ms | ✅ `.command()` nesting | ✅ `exitOverride()` + `configureOutput()` — **verified** | ✅ verified | ❌ |
| **Stricli** | 1.3.0 (2026-07-16) | 10 | **ESM** | 0 | 320KB | 2.1 ms | ✅ `buildRouteMap` | ✅✅ context object is a **required arg** to `run()` — **verified** | ✅ verified | ❌ |
| **Citty** | 0.2.2 (2026-04-01) | 3 | **ESM** | 0 | 34KB | 2.7 ms | ✅ `subCommands` | ✅ `runCommand(cmd,{rawArgs})`, throws — **verified** | ✅ verified | ❌ |
| **Cac** | 7.0.0 (2026-02-27) | 2 | ESM | 0 | 40KB | 1.6 ms | ⚠️ flat/string-pattern only | ⚠️ writes to stdout, exits | ✅ | ❌ |
| **Clipanion** | **4.0.0-rc.4 (2024-09-06)** | **0** | **CJS** | 1 | 229KB | 8.7 ms | ✅ | ✅ `Cli.run(args, ctx)` | ⚠️ CJS | ❌ |
| **oclif** | core 5.0.0 (2026-08-31) | 46 | **CJS** | 18 | 446KB | **40.3 ms** | ✅ (topics) | ⚠️ `Config` needs a real `root` dir | **❌ runtime fs globbing** | ✅ |
| **`node:util` parseArgs** | built-in | — | builtin | 0 | 0 | 0 ms | ❌ manual (status quo) | ✅ | ✅ | ❌ |

### Notes that decide it

**Clipanion — eliminated.** The npm `latest` dist-tag points at **`4.0.0-rc.4`, published
2024-09-06**: a release candidate that has been `latest` for two years, with **zero releases in
the last 12 months**. It is also CommonJS. Whatever its design merits, adopting a two-year-stale
RC as the foundation of a CLI being rebuilt "on proven foundations" is not defensible.

**oclif — eliminated on mechanics, not taste.** From its own source in
`@oclif/core/lib/config/plugin.js:333`:

```js
const files = await (0, tinyglobby_1.glob)(this.commandDiscoveryOpts?.globPatterns ?? GLOB_PATTERNS, { cwd: commandsDir });
```

It globs a commands directory on disk at runtime, and `Config` requires a `root: string`
filesystem path. It is CommonJS (`@oclif/core` 5.0.0 ships `./lib/*.js`, no `type: module`),
carries 18 direct dependencies and 446 KB unpacked, and costs **40.3 ms just to import** —
which would nearly double `radius --help` before parsing a single argument. Three independent
blockers against an ESM single-file `dist/cli.js`. It is very actively maintained (46 releases
in 12 months); that is not the problem. It is built for a distribution model Radius does not have.

**Cac — weak fit.** Tiny and fast, but nested subcommands are not first-class (you express
them as string patterns on a flat command list), and it writes help to stdout and exits. Radius
has three two-level groups today. This is the one place the ticket's "does it handle nesting"
question actually eliminates a candidate on capability rather than hygiene.

**Citty — viable, but 0.x.** Genuinely nice: 52 KB, zero deps, `runCommand` returns a promise
and throws on validation failure (verified: `Missing required argument: --label`), lazy
`subCommands` supported. But it is **0.2.2 with 3 releases in 12 months**, still pre-1.0, and
unjs pre-1.0 packages carry real breaking-change risk. Reasonable if the team already lives in
unjs; Radius does not.

**Verified behaviour for the three finalists.** I ran each against a replica of the `tokens`
group (nested command, required flag, repeatable `--scope`, positional arg) with captured IO:

- Commander: nested parse ✅, repeatable flag ✅, positional ✅, `exitOverride()` **throws**
  `CommanderError{code:"commander.missingMandatoryOptionValue"}` instead of exiting ✅,
  `configureOutput()` routes the framework's *own* help and error text into `CliIo` ✅.
- Stricli: nested route map ✅, variadic flag ✅, custom context threaded to handlers as `this`
  ✅, errors written to the **injected** stderr with the process left alive ✅.
- Citty: nested ✅, throws on missing required ✅.

---

## 4. Ranked recommendation

### 1. Commander 15 — adopt

- **ESM as of v15** (`"type": "module"`), **zero dependencies**, 203 KB.
- The seam survives, demonstrably. `exitOverride()` keeps the throw-not-exit contract that
  `main.test.ts` relies on, so `assert.rejects(runCli([...]))` continues to work unchanged.
  `configureOutput()` means even Commander's generated help and error text go through `CliIo`
  rather than to `process.stdout` — the current hand-rolled `helpText()` string does not even
  achieve that consistently.
- Nested subcommands are first-class and verified.
- Lowest migration cost by a wide margin (§6), and the lowest risk: it is the most widely
  deployed Node CLI parser in existence, and 5 releases in 12 months reflects maturity, not
  neglect.
- 7.7 ms import is the worst of the finalists and it does not matter — it is noise against the
  60 ms of §2, and it disappears entirely once you realise it is paid on every invocation
  either way.

**The honest weakness:** flag→handler type inference is the weakest of the three. You will
hand-write the handler's options type or accept a loose one. Given that every command module
already declares its own strongly-typed options interface (`DeployOptions`, `DevOptions`, …),
the type boundary you actually care about is already there and TypeScript will still catch a
mismatch at the call site. This costs less than it sounds like.

### 2. Stricli 1.3.0 — the principled alternative

Bloomberg built Stricli around exactly the property this ticket says must not be lost. The
context object is a **required argument to `run(app, args, context)`**, typed, and threaded into
every command handler. `CliIo` and `options.cwd` stop being a convention Radius maintains by
hand and become something the compiler enforces. Its `loader:` field makes per-command lazy
loading a built-in rather than a discipline. Zero deps, ESM, 2.1 ms import, 10 releases/12mo.

**Why it is not first:** more ceremony (`buildCommand` + `buildRouteMap` + `buildApplication` +
a context module + a loader indirection per command, across 24 leaves), a much smaller
ecosystem, and its error path *writes to injected stderr and returns* rather than throwing —
which changes `runCli`'s contract and means rewriting the `assert.rejects` assertions in
`main.test.ts` rather than keeping them.

**What would flip this to first place:** if the team decides the typed context is worth the
ceremony — i.e. if `CliIo` is going to grow beyond `out`/`error` into something carrying colour
support, TTY detection, prompt capability and a logger, and you want that threaded and
type-checked everywhere. That is a plausible outcome of the CUR-34 rewrite. If `CliIo` stays
two methods, Commander wins.

### 3. Citty — fine, but 0.x. Pick it only if unjs is already a house dependency.

### 4. "No framework, just a small parser plus convention" — the serious runner-up to reject

This deserves more than a dismissal, because it is what the code does today and the ticket asks
whether the answer is a framework at all.

A ~120-line dispatcher over `node:util parseArgs` — a `Command` record type with
`{ flags, positionals, run }`, a table of 24 of them, and one generic loop — would be
genuinely adequate. It has zero dependencies, zero import cost, and total control.

Reject it anyway, for one reason: **what `main.ts` gets wrong is not the parsing, it is
everything around the parsing.** There is no `--version`. Help is a hand-maintained template
literal that will drift from the flag table the moment anyone adds a flag. There are no
suggestions on a typo. Error messages are hand-rolled per call site and inconsistent
(`"Usage: radius tokens list|create|revoke"` thrown as an `Error` for one group,
`"Unknown Radius command"` for another). Numeric coercion is duplicated in two nearly identical
private helpers (`parseExpectedRevision`, `parsePageLimit`). Writing a framework yourself means
writing all of that yourself, and the current file is direct evidence of what happens when you
do: it is 492 lines and, per CUR-34, "behaviourally wrong". Commander is 203 KB and zero
dependencies. The build-it-yourself argument does not clear that bar.

Keep the *shape* of this option — `runCli(argv, options)` as a plain function — and let a
library fill it in. That is the recommendation.

---

## 5. Is the plugin requirement real? No.

The ticket asks that this be established before it drives the choice toward oclif. I searched
`docs/` and `packages/cli/` for `cli plugin`, `plugin command`, `third-party command`,
`extend the cli`, `custom command`: **zero hits**. The only "plugin" references in the
repository are `docs/architecture/agent-sdk-and-cli.md:178` ("TypeScript SDK, **build plugin**,
and CLI developer loop" — a bundler plugin) and ADR-005 "pluggable optional sync" — both
unrelated to CLI command extension. CUR-34's "Not yet specified" list covers distribution,
config format, auth and testing strategy; it does not mention CLI extensibility.

**Conclusion: speculative, not a requirement.** It should carry zero weight. If it ever becomes
real, note that third-party command extension is a *distribution* problem (how does a plugin get
installed and discovered) far more than a *parser* problem, and Commander can be handed a
dynamically-built command list as easily as a static one.

---

## 6. Presentation layer

Independent of the parser, as the ticket says. Same measurement method.

| | Version (date) | rel/12mo | Module fmt | Deps | Size | Import | Output injectable? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **picocolors** | 1.1.1 (2024-10-16) | 0 | CJS (dual) | 0 | 6KB | 3.5 ms | ✅ `createColors(enabled)` |
| **@clack/prompts** | 1.7.0 (2026-07-03) | 16 | ESM | 4 | 114KB | 11.3 ms | ✅ `input?: Readable, output?: Writable` |
| **listr2** | 11.1.0 (2026-09-02) | 20 | ESM | 3 | 134KB | 4.8 ms | ✅ renderer `outputStream` |
| **Ink** | 7.1.1 (2026-07-16) | 17 | ESM | **25** | **544KB** | **171 ms** | ✅ `render(node,{stdout})` |

*(For reference: `@inquirer/prompts` 8.7.1 — 24 rel/12mo, the heavier and more configurable
alternative to clack; `ora` 9.4.1; `yoctocolors` 2.2.0.)*

### Verdicts

**Ink — reject.** 171 ms to import, 25 direct dependencies, 544 KB unpacked, pulls React,
`react-reconciler`, `yoga-layout` and a `ws` copy. On a CLI where the named constraint is that
`radius dev` is run constantly, importing Ink would take the current 90 ms `--help` to roughly
260 ms. It is the right tool for a persistent full-screen TUI. If `radius dev` ever grows a
live dashboard, load Ink behind a dynamic import on that path only — §2 proves the laziness
survives bundling — and never on the startup path. Do not adopt it as the general output layer.

**@clack/prompts — adopt, lazily, for `login` only.** Verified from its own type definitions
that `@clack/core` accepts `input?: Readable` and `output?: Writable`, so it is testable in
process and respects the seam. This is a direct replacement for `src/secret-input.ts`, 43 lines
of hand-rolled raw-mode `setRawMode`/backspace/Ctrl-C handling that is exactly the sort of thing
one should not maintain. Note clack is only needed on interactive paths; at 11.3 ms it should
be dynamically imported so `radius dev` never pays for it.

**listr2 — not yet.** Nothing in the current 13 commands renders concurrent or multi-step
progress; `build.ts` and `deploy.ts` emit plain sequential `io.out` lines. Adopting it now would
be solving a problem that does not exist. Revisit once `build` and `deploy` have a settled step
model — which CUR-34 lists as still unspecified. Its `outputStream` option means it can be
adopted later without breaking the seam.

**picocolors — probably skip; use `node:util styleText`.** Verified working on this machine's
Node v22.17.0:

```
$ node -e 'console.log(require("node:util").styleText("green","works"))'  → works
```

`styleText` is built in, respects `NO_COLOR`/`FORCE_COLOR` and TTY detection, and costs nothing
to import. picocolors is 6 KB, zero deps and completely fine (its zero releases in 12 months is
"finished", not "abandoned"), but it is now a dependency for something the platform provides.
**Caveat to check before committing:** confirm `styleText`'s stability level in the Node docs for
the minimum Node version Radius supports — it was introduced around Node 20.12/21.7 and spent
time as Experimental. If Radius must support a Node where it is absent or experimental, take
picocolors; the API surface is small enough that swapping later is trivial either way.

**The real presentation-layer decision is not on this list.** `CliIo` currently has no notion of
colour, TTY-ness, or verbosity, and `src/main.test.ts` captures plain strings. Whatever is
adopted, colour must be resolved *behind* `CliIo` (or via a capability flag on it) so that
captured test output stays free of escape codes. Deciding whether `CliIo` grows is a design
question that belongs to the CUR-34 rewrite — and, per §4, it is also the question that decides
Commander vs Stricli.

---

## 7. Migration cost under Commander

**Scope: `main.ts` and `main.test.ts`. Nothing else.** The 13 command modules keep their
signatures; their tests (`login.test.ts`, `profiles.test.ts`, `deploy.test.ts`, `dev.test.ts`,
`build.test.ts`, `deployments.test.ts`, `inventory.test.ts`, `config.test.ts`,
`credential-store.test.ts`) call the command functions directly and do not touch `runCli` at all.
Only `main.test.ts` exercises `runCli`.

I migrated the `tokens` group for real and ran it — nested commands, required `--label`,
repeatable `--scope` collected into an array, `<token-id>` positional, captured IO, dynamic
import of the command module, error throwing instead of exiting. All passed.

| | Old | New |
| --- | --- | --- |
| `tokens` group | **65 lines** (`main.ts:310–374`) | **12 lines** |
| `runCli` scaffolding (program + output config + coercion helpers) | — | **13 lines** |

The `tokens` group is representative: 3 leaves, 6 distinct flags, one positional, one repeatable
flag. Extrapolating across 24 leaves: **`main.ts` goes from 492 lines to roughly 150–200**, plus
a small shared module of coercion helpers (positive-integer revision, 1–100 page limit,
`--language` enum) that today exist as duplicated private functions.

Estimated effort: **1.5–3 days**, including rewriting `main.test.ts` and reconciling help output.

Work items, in dependency order:

1. Replace the 16 `parseArgs` sites with a Commander tree, fresh `new Command()` per `runCli`
   call so tests stay isolated. Wire `.exitOverride()` and `.configureOutput()` to `CliIo`.
2. Convert the static command-module imports to `await import()` inside each action, and make
   `config.ts`'s `tsImport` dynamic. **This is the §2 startup win — do it in the same pass**,
   and measure `--help` before and after (baseline: ~90 ms).
3. Delete `helpText()` (~28 lines) and let Commander generate help from the flag definitions.
   This is where behaviour intentionally changes and where the effort estimate is softest —
   `main.test.ts` currently asserts on help text with regexes like
   `/radius dev \[--endpoint <ws-url>\]/`, and those assertions will need rewriting against
   generated output.
4. Normalise the inconsistent hand-thrown `Usage: …` errors into Commander's error reporting.
5. Add `--version` and unknown-command suggestions — both free, both currently missing.
6. Optionally, replace `secret-input.ts` with `@clack/prompts` (separate, independently
   revertable change).

Things that will actually bite:

- **Repeatable `--scope`.** `parseArgs` uses `{ type: "string", multiple: true }`. In Commander
  use `.option("--scope <scope>", desc, collect, [])` with a collector function — *not*
  `--scope <scope...>` variadic, which greedily consumes following tokens and would change
  parsing behaviour. Verified both forms; the collector is the correct one.
- **`promote` vs `rollback`** share a code path but differ in how the deployment id arrives
  (positional for `promote`, `--to` for `rollback`). This asymmetry is worth fixing during the
  migration rather than faithfully reproducing.
- **`deployments list` / `environments status`** are currently parsed as a command plus a
  hand-checked literal action string. As real subcommands they become trivial, and the
  bespoke "Usage:" errors disappear.

---

## 8. Irreversibility flags

Almost nothing here is irreversible, and that is a deliberate consequence of one decision:

🟢 **Keeping `runCli(argv, { cwd, io, readSecret })` as the public entry point makes the parser
choice reversible.** With that wrapper intact, the parser is an implementation detail behind a
function signature, and swapping Commander for Stricli later is a `main.ts` rewrite — days, not
weeks — with the 13 command modules and their tests untouched. *This is the actual architectural
decision in this ticket.* The parser is not. **Do not let any framework own the entry point.**

🟢 Parser choice, given the above. Reversible.

🟢 picocolors vs `util.styleText`. Trivially swappable behind `CliIo`.

🟡 **The user-facing command grammar.** Framework-independent, but the moment `radius` is
published and someone puts it in CI, flag names and command shapes become a compatibility
surface. The migration is the cheap moment to fix `rollback --to`, the `deployments list` /
`environments status` asymmetry, and any flag naming — *before* anyone depends on them.
CUR-34 lists distribution as unspecified, so this window is still open. It will not stay open.

🟡 **Deleting `helpText()`.** Not irreversible, but it changes observable output and invalidates
the help-text assertions in `main.test.ts`. Expect to rewrite those tests, and treat the
generated help as the new contract.

🔴 **oclif is the one genuinely irreversible choice on this list.** Adopting it means adopting a
project layout (one command per file under a globbed directory), a CommonJS runtime, a
`package.json` manifest read at runtime, and a distribution model built around plugin
resolution. That is not a dependency you swap out; it is a rewrite. Combined with §5 finding no
plugin requirement and §2 showing a 40 ms import tax on a latency-sensitive CLI, this is the
clearest "do not do this" in the survey.

🔴 **Ink, if it ever lands on the startup path**, is close behind: 171 ms and a React runtime
propagate into how every command renders output, and backing that out later means rewriting
every command's presentation. Behind a lazy import on one command, it is fine.

---

## 9. Questions this surfaced

1. **Does `CliIo` grow?** If it becomes a richer context (colour, TTY, verbosity, logger), Stricli's
   typed context becomes worth its ceremony and the §4 ranking flips. This should be settled in
   the CUR-34 rewrite *before* the parser is committed to.
2. **What is Radius's minimum supported Node version?** Decides `util.styleText` vs picocolors,
   and is unspecified anywhere I could find. It also bears on CUR-34's open distribution question.
3. **Why are there two copies of esbuild in the bundle** (`esbuild/lib/main.js` and
   `tsx/node_modules/esbuild/lib/main.js`)? A dedupe may be a free size win independent of everything
   above.
4. **Should `radius.config.ts` loading via `tsx` survive at all?** It is single-handedly responsible
   for ~200 KB and much of the startup cost. CUR-34 already lists the config format as unspecified;
   §2 gives that question a concrete performance price tag.
5. **`tsx` is a runtime `dependency`, not a devDependency.** Intentional, since `config.ts` needs it
   to load TypeScript config at runtime — but it means shipping a bundler to every CLI user. Worth
   confirming that is the intended trade.

---

## 10. Addendum — corrections from independent verification

Two independent research passes landed after §1–§9 were written. Where they contradicted
me, I re-verified locally. **The recommendation is unchanged, but four things above were
wrong or incomplete, and the Commander-vs-Stricli margin is narrower than §4 conveyed.**

### Corrections

**a) picocolors is CJS-only, not "CJS (dual)" as the §6 table said — and named ESM imports fail.**
Verified: its `package.json` has **no `exports` field and no `type` field**, only
`main: ./picocolors.js`. `import { red } from "picocolors"` throws
`SyntaxError: Named export 'red' not found`; you must use a default import. For an ESM
codebase this is a real wart.

**b) picocolors gets `FORCE_COLOR=0` backwards.** Verified side by side, showing raw bytes:

```
FORCE_COLOR=0  picocolors -> "[31mx[39m"   <- colours ON, wrong
FORCE_COLOR=0  styleText  -> "x"                       <- correct
```

The check is `!!env.FORCE_COLOR`, which is truthy for the string `"0"`. Open upstream since
2026-02-19. It also forces colours on when `CI` is set. Combined with (a) and its dormancy
(last release 2024-10-16, last commit 2024-11-18), **the §6 "probably skip picocolors"
hardens into "skip picocolors".**

**c) `util.styleText` is Stability 2 (Stable) — my §6 caveat is resolved.** Node's own docs
history: *"v23.5.0 / v22.13.0 — styleText is now stable."* It takes `options.stream`
(default `process.stdout`) so colour capability is checked **per stream** — the one thing
picocolors cannot do, and it matters if status goes to stderr and data to stdout. Radius
builds on Node 22.17.0, comfortably past the stable threshold. **Corroboration:** clack 1.7
and listr2 11 have *both already dropped picocolors* for `node:util styleText` — verified,
neither lists it as a dependency. If a Node floor below 20.12 is ever required, use
**`yoctocolors`** (zero deps, real ESM, maintained), not picocolors.

**d) listr2's default renderer cannot be redirected — the §6 table's "renderer `outputStream`"
cell was too optimistic.** `rendererOptions.processOutput` is **ignored** by `SimpleRenderer`
(it constructs its own `ListrLogger`), and the default spinner renderer writes through
`log-update` bound to the real `process.stdout` with no override at all. What actually works
is injecting a pre-built logger:

```js
const logger = new ListrLogger({ processOutput: new ProcessOutput(fakeOut, fakeErr) })
new Listr(tasks, { renderer: 'simple', rendererOptions: { logger },
                   fallbackRenderer: 'simple', fallbackRendererOptions: { logger } })
```

This does not change the §6 verdict (still "not yet"), but it changes the *terms*: if listr2
is adopted later, the CLI must standardise on the `simple` renderer with an injected logger,
or output capture in tests breaks. Worth writing down now so it is not discovered late.
(listr2's non-TTY auto-fallback is genuinely best-in-class, so this is the only sharp edge.)

### Additions that bear on the recommendation

**e) Commander 15 is ESM-only and requires Node >= 22.12.0.** I omitted this. From its
CHANGELOG: *"migrated Commander implementation from CommonJS to ESM (#2464)"* and
*"Commander 15 requires Node.js v22.12.0 or higher (for `require(esm)`)"*; the
`commander/esm.mjs` export was deleted. Radius runs 22.17.0 so this is satisfied today, but
it **hard-couples the parser choice to a Node floor** and partially answers open question
§9.2 — adopting Commander 15 *sets* the floor at 22.12. Note listr2 11 (>= 22.13) and chalk 6
(>= 22) would push it slightly higher anyway. If Radius ever needs to support older Node,
Commander 14.x is the fallback line (maintained with security fixes into 2027).

**f) New migration gotcha: avoid Commander's stand-alone executable mode.**
`.command('name [args]', 'description')` — with a *description string as the second
argument* — silently switches to spawning external `radius-name` executables found next to
the entry script at runtime. That mode is bundler-hostile and would break `dist/cli.js`. The
`.action()` form used in the §7 prototype is not affected. This is an easy accident during a
16-site migration; put it on the review checklist.

**g) oclif's `explicit` discovery strategy is a real escape hatch — my §3 wording was too
absolute.** oclif supports `pattern` (default, globs), `explicit` (one file exporting
`Record<string, Command.Class>` — static and bundler-compatible), and `single`. So "runtime
fs globbing" is the *default*, not an inescapable property. **The conclusion stands anyway**,
on oclif's own documentation: *"We do not support bundling"* — even with esbuild "you will
not be able to successfully bundle your entire CLI … into a single file", and a root
`package.json` plus `bin/run.js` must remain on disk. Plus CJS, ~40 transitive packages, and
**157 CJS modules loaded** before your code runs. Rejected for the right reasons, but state
them precisely.

**h) Minor table corrections.** **Stricli is dual ESM/CJS** (`import`/`require` conditions),
not ESM-only as §3 implied. **Clipanion's published tarball is properly dual** too — the CJS
reading in §3 came from its installed `package.json` lacking a `type` field. Neither changes
any outcome; Clipanion remains eliminated, and both passes independently confirmed why:
**zero commits in 12 months** and an open upstream issue literally titled *"Is Clipanion
abandoned?"* (#181, last updated 2026-05-18). **citty** is more alive than its 3 npm releases
suggest — **41 commits in 12 months**; still 0.2.x. **cac's** lack of nesting is confirmed
from source: `isMatched` is a single-level name compare (`src/command.ts:120`).

### The honest bottom line on Commander vs Stricli

The independent parser pass, which had no knowledge of my §4 reasoning, concluded that
**Stricli is "the strongest fit if you want typed flags + nested routes + genuinely
injectable context for in-process tests."** It also confirmed my stated weakness with a
source: Commander's `action(fn: (this: this, ...args: any[]) => …)` gives handler args typed
**`any[]`**, and `opts<T>()` requires you to supply `T` by hand — nothing is inferred from
your `.option()` calls. Meanwhile Stricli's `run(app, inputs, context)` sets
`context.process.exitCode ??=` on **your injected** process object and never touches global
`process`.

I am keeping Commander at #1 — the migration is ~5x cheaper (proven, §7), the seam survives
(proven, §3), and the choice is reversible so long as `runCli` owns the entry point (§8).
But two independent evaluations both identified Stricli as the better *design* fit for this
codebase's central constraint. **§4's tiebreaker question — does `CliIo` grow? — is doing
more work than a tiebreaker should.** It deserves an explicit decision in CUR-34 rather than
being inherited by default from whichever parser gets merged first.
