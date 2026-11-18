# Keel Board Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship milestone 1 of the Keel DSH web plugin against the revised spec on main (status columns, drawer, create, search, summary, session handoff). The WeCom weekly report stays milestone 2.

**Architecture:** One npm package `keel` exports a Host plugin (`apply(ctx, config)`), a browser client (`./client`), and a strict Typert Remote contribution (`./remote`). The Host talks to a self-hosted GitLab REST API with a group token resolved per operation from DSH credentials. The browser never sees the token. Issue state lives only in GitLab responses.

**Tech Stack:** TypeScript, Node 22, `@deepseek-ai/cordis` ~4.1, `@deepseek-ai/schemastery` ~3.19, `@deepseek-ai/dsh-tools` / `dsh-credentials` / `dsh-typert-protocol` / `dsh-llm` 0.2.2-rc.1, Zod 4, React (externalized to the DSH platform seed), node:test via tsx, esbuild for the lazy-CJS client bundle.

## Global Constraints

- npm package name `keel`, version `0.1.0`, `type: module`, license MIT. Cordis id, Host `name`, service name, and panel id are `keel`.
- `engines.dsh` is `>=0.2.0 <0.3.0`, from published `dsh` `0.2.2-rc.1` (`X.Y.Z` → `>=X.Y.0 <X.(Y+1).0`).
- No `prepare` script. Publish the built `lib/`. Dependencies are published versions, never `workspace:`.
- GitLab is the only source of truth. No issue database, no local sync ledger, no token in config, logs, tool results, or Remote responses.
- Do not implement spec section 9: no issue create, no title/description/assignee/comment edits, no `relative_position`, no milestone object, no `risk::none` label, no sub-10s polling, no second top-level group.
- User-facing copy is Chinese, matching the existing README.
- Module evaluation does not touch the network, the token, or timers.
- Writes from the board are the user's confirmation. Agent writes return `tools/pre-execute` `{ kind: 'ask' }` and do not call GitLab until DSH grants `allowed-once`.

## Spec versus the kickoff list

The approved spec on `main` replaces the broader kickoff list. This milestone follows the spec:

| Kickoff wording | Approved spec | This PR |
| --- | --- | --- |
| `status::todo/doing/blocked/done` columns, Open/Closed fallback | Columns are GitLab `opened` and `closed` only | Two columns: 打开 / 已关闭 |
| Create issue, detail drawer, comment count, milestone, search, only-mine, risk filter, list view, summary counts | Not in the spec; section 9 forbids create-issue and milestone-as-object | Not built |
| `allowSelfSigned` | Not in the spec. `baseUrl` is an absolute `http:`/`https:` origin | Not built. A self-signed instance must be trusted by Node's CA store |
| Send-to-session | Agent surface is the `keel_*` tools | Not built |
| WeCom weekly report | Not in the spec | Milestone 2 only, described below |

## Verified DSH behavior (0.2.2-rc.1)

Checked against the docs and the published packages, not guessed:

- Bundle: `dsh.bundle.patch` → `cordis.patch.yml`; `dsh plugin --profile web add` appends the bundle. A later layer replaces a row's whole `config`.
- Config: export `Config` interface and Schemastery schema. `.volatile()` values are read with `.get()`.
- Credentials: `credentialRef` + `ctx.credentials.resolve/describe/set/unset`. Empty stored value is unconfigured. `describe().masked` is the only preview.
- Tools: `defineTool` + `ctx.tools.register` inside `ctx.effect`. `tools/pre-execute` returns `{ kind: 'ask', reason, displayReason: { zh, en } }`. DSH continues only on `allowed-once`.
- Remote: Host methods are `@Remote` on a `TypertRemoteService` named `keel`. The Host gateway's SRC fallback dispatches those methods when no strict Host descriptor is registered (`resolveSrcDescriptor` in `@deepseek-ai/dsh-api-gateway@0.2.2-rc.1`). The browser refuses SRC codecs, so `./remote` is a strict contribution from `createTypertRemoteInfo` (`codec.create()`), mounted with `ctx.remote.$mount`. The in-repo Typert generator only emits packages under the DSH workspace `packages/` tree, so this package builds the contribution itself.
- Client bundle: `window.__ModuleLoader__.load({ id: "keel", factory })`. `id` must equal the package name. Platform seeds include `react`, `react/jsx-runtime`, and `zod`. `@deepseek-ai/dsh-client-runtime` is not published at 0.2.2-rc.1 and is not a platform seed, so `dsh.client.inject` does not list it. Cordis `inject` is `slots`, `locale`, `remote`, `remote.settings`, `layout`.
- Settings writes: `ctx.remote.settings.describe()` then `update(ns, patch, revision)` for entry id `keel`.
- Slots: `sidebar.panellist` list entry `id: keel`, `order: 20`, label `项目看板`, and keyed `main` entry with the same key. The layout unmounts a main panel that is not selected, which clears the 10s timer.
- `MainPanelId` in the running layout is a string union. The registration uses `'keel' as MainPanelId` at the call site by passing the string `keel`; the layout matches it to the `main` key.

## File structure

| File | Responsibility |
| --- | --- |
| `package.json`, `cordis.patch.yml`, `tsconfig.json`, `eslint.config.js` | Package identity, build, lint |
| `src/config.ts` | Volatile schema and pure normalizers |
| `src/errors.ts` | `KeelError` codes and Chinese messages |
| `src/model.ts` | `KeelIssue` and list types |
| `src/risk.ts` | Risk parse and PUT bodies |
| `src/gitlab/http.ts` | Allowlisted HTTP, no redirects, timeout, one read retry on 429 |
| `src/gitlab/map.ts` | GitLab JSON → `KeelIssue` |
| `src/gitlab/api.ts` | Group, projects, labels, issues, writes |
| `src/operations.ts` | Config + credential resolution around the API |
| `src/service.ts` | `KeelService` Remote methods |
| `src/tools.ts` | `defineTool` tools and the pre-execute decision |
| `src/remote.ts` | Strict `./remote` contribution |
| `src/index.ts` | Host `apply` |
| `src/board/model.ts` | Filters, save lifecycle, refresh merge, drag decision |
| `src/board/load.ts` | Column paging and overdue marks |
| `src/client/view.tsx` | Board and connection form |
| `src/client/index.tsx` | Client `apply`, slots, 10s refresh |
| `scripts/build-client.mjs` | Lazy-CJS bundle |
| `tests/*.test.ts` | Mock GitLab. No network by default |
| `README.md` | Chinese install instructions |

Milestone 2 adds `src/reports/wecom.ts` later. It must call `operations` / `listIssues` and must not grow a store. This PR does not add a stub that pretends to send WeCom.

## Milestone 2 (企业微信周报与月报), not in this PR

The revised spec's section 7 is the source for this follow-up. This milestone only stores the WeCom config fields and secret ref. It does not call `qyapi.weixin.qq.com`, does not arm the Friday timer, and does not append documents.

The follow-up should:

- Keep GitLab as the only issue store. The report reads issues through the existing client and writes only to WeCom docs.
- Use `Asia/Shanghai`. Week id `F` is the Friday of the week containing the run. The window starts Monday 00:00:00.000 inclusive. A scheduled run and a catch-up end at Friday 10:00:00.000 inclusive. An immediate run ends at `min(now, Friday 10:00:00.000)`.
- Run `0 10 * * 5` inside `ctx.effect`, then catch up only the latest Friday before the following Monday 10:00. Do not backfill older weeks. Serialize runs in one process.
- One ordinary doc (`doc_type` 3) per allowed project, named by replacing `/` in `path_with_namespace` with ` - `, truncated at 240 code points plus a 14-hex SHA-256 suffix when longer.
- Call only `gettoken`, `wedrive/file_list`, `wedoc/create_doc`, `wedoc/document/get`, and `wedoc/document/batch_update` on `https://qyapi.weixin.qq.com`. TLS stays on the system trust store and ignores `allowSelfSigned`.
- Replace an existing `周报 YYYY-MM-DD` section when the plain text differs. Skip when it matches. On the month's last Friday, also write `月报 YYYY-MM` by summing the month's weekly counts, taking the last week's overdue number as the month-end overdue count.
- Idempotency is the heading in the document, not a local database or a stored `docid`.
- Confidential issues contribute only to `已省略保密议题：N`.
- `generateReports` and `checkWecom` are the Remote methods to add. There is still no agent tool that writes WeCom, and the board is not copied into the system prompt.

## Task 1: Package skeleton

**Files:** `package.json`, `tsconfig.json`, `tsconfig.emit.json`, `eslint.config.js`, `.gitignore`, `cordis.patch.yml`, `scripts/build-client.mjs`

- [x] Declare the manifest from the spec, with `files` covering `lib/` so local Host imports are published along with `lib/index.js`, `lib/client.js`, and `lib/remote.js`.
- [x] Peer-depend on the DSH packages the Host must share. Depend on `zod` for the Remote codecs.
- [x] `npm run build` runs `tsc -p tsconfig.emit.json` and the client bundle.
- [x] `npm test` runs node:test. The default suite does not call GitLab.

## Task 2: Config, risk, and issue projection

**Files:** `src/config.ts`, `src/risk.ts`, `src/gitlab/map.ts`, `tests/config.test.ts`, `tests/risk.test.ts`, `tests/map.test.ts`

**Interfaces:**

- `normalizeBaseUrl(value: string): string` — empty stays empty; otherwise an origin without a trailing slash.
- `normalizeGroupPath(value: string): string`
- `normalizeTokenRef(value: string): string`
- `parseRisk(labels: { name: string }[]): { risk: 'low' \| 'medium' \| 'high' \| null, riskConflict: boolean, unrecognized: boolean }`
- `riskUpdate(current: readonly string[], target: 'low' \| 'medium' \| 'high' \| 'none'): { add_labels?: string, remove_labels: string } \| null`
- `dueDateUpdate(current: string \| null, next: string): { due_date: string } \| null`
- `stateUpdate(current: 'opened' \| 'closed', next: 'opened' \| 'closed'): { state_event: 'close' \| 'reopen' } \| null`
- `mapIssue(raw, projects, overdue: boolean): KeelIssue`

- [x] Failing tests for the spec examples, then the functions above.

## Task 3: GitLab client

**Files:** `src/gitlab/http.ts`, `src/gitlab/api.ts`, `src/errors.ts`, `tests/gitlab-http.test.ts`, `tests/gitlab-api.test.ts`, `tests/fixtures/issue.json`

- [x] Allow only the spec paths. Reject anything else before `fetch`.
- [x] `redirect: 'manual'`. Status 3xx fails with `keel/gitlab-unavailable` and the redirect message. Timeout 15s. Read 429 retries once. Writes do not retry.
- [x] Logs are `METHOD path status` and must not contain the token.
- [x] Project allow-set: `include_subgroups=true&with_shared=false&archived=false&simple=true`. Over 2000 projects throws `keel/outside-group` with 「项目列表超过 2000 个，超出第一版支持的组规模」.
- [x] Label create only from the connection check. Risk writes do not POST labels. Missing labels on a risk write throw `keel/labels-missing`.
- [x] `listIssues` returns one page. `truncated` is true only when `page === 20` and GitLab still sends `x-next-page`.
- [x] Optional `dueDate: 'overdue'` on the list query. The spec's `KeelListQuery` has no overdue field, but the board is required to mark overdue from GitLab's `due_date=overdue` filter rather than a local timezone. The field is optional and the board is the caller. Agent `keel_list_overdue` uses the same filter with `order_by=due_date&sort=asc` and accepts no extra filters.

## Task 4: Host service, tools, Remote contribution

**Files:** `src/operations.ts`, `src/service.ts`, `src/tools.ts`, `src/remote.ts`, `src/index.ts`, `tests/tools.test.ts`, `tests/remote.test.ts`

- [x] Resolve `tokenRef` on every operation. Do not cache the secret.
- [x] Remote methods end with `signal: AbortSignal`.
- [x] Tools: `keel_list_issues`, `keel_list_high_risk`, `keel_list_overdue`, `keel_set_due_date`, `keel_set_risk`, `keel_set_state`.
- [x] `preExecuteDecision` asks for the three write names and calls through for every other name. Reason includes tool name, project id, iid, and the target value. `displayReason.zh` and `displayReason.en` are both set. The decision function does not call GitLab.
- [x] `./remote` lists those ten methods and every codec has `create()`.

## Task 5: Board model and UI

**Files:** `src/board/model.ts`, `src/board/load.ts`, `src/client/view.tsx`, `src/client/index.tsx`, `tests/board.test.ts`, `tests/view.test.tsx`

- [x] Default filter is all assignees, no labels, all projects. Selected labels are passed as an array (GitLab AND).
- [x] A field stays `saving` until the response. Failure restores the last confirmed value and keeps the error plus the attempted value for 重试.
- [x] Dropping on the same column does not call `setState`.
- [x] Opened column pages through to 20. Closed column starts at page 1. Overdue ids mark opened cards only. A truncated overdue scan sets 「逾期标记不完整」.
- [x] Refresh replaces a column except cards with a save in flight.
- [x] Unconfigured connection renders the form, not empty columns. Configured connection renders 打开 and 已关闭.
- [x] Saving base URL and group path goes through `ctx.remote.settings.update('keel', ...)`, then `setToken` when a new token was typed, then `connection()`.

## Task 6: Docs, bundle, integration skip

**Files:** `README.md`, `tests/integration.test.ts`, `tests/bundle.test.ts`

- [x] README in Chinese: `dsh plugin --profile web add ./`, `dsh plugin --profile web add github:qiq-mine/Keel#<40位commit>`, `dsh --profile web --dump-config`, restart `dsh web`, `dsh plugin --profile web remove keel`.
- [x] Built `lib/client.js` registers `id: "keel"` and its `require()` specifiers are only platform seeds.
- [x] Integration test runs only when `KEEL_GITLAB_TEST_BASE_URL`, `KEEL_GITLAB_TEST_GROUP`, and `KEEL_GITLAB_TEST_TOKEN` are set. Otherwise it skips and the default suite stays green.

## Self-review

- Spec sections 1–8 map to tasks 2–6. Section 9 is an explicit non-goal list in Global Constraints.
- WeCom is milestone 2 only. The GitLab API is the extension point; no half-implemented sender ships here.
- `dueDate: 'overdue'` and client-preserved `overdue` on risk writes are the two places the implementation fills a gap the Remote signature left open. Both are called out above.
- `dsh.client.inject` omits `@deepseek-ai/dsh-client-runtime` because that package is not in the 0.2.2-rc.1 registry and listing it would fail client composition.
