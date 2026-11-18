window.__ModuleLoader__.load({ id: "keel", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// src/model.ts
function issueKey(issue2) {
  return `${issue2.projectId}:${issue2.iid}`;
}

// node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/remote-info.js
function createTypertRemoteInfo(spec, zod) {
  return new RemoteInfo(spec, zod);
}
var RemoteInfo = class {
  spec;
  zod;
  index;
  constructor(spec, zod) {
    this.spec = spec;
    this.zod = zod;
  }
  get package() {
    return this.spec.package;
  }
  get descriptors() {
    return this.resolve().descriptors;
  }
  get methods() {
    return this.resolve().methods;
  }
  resolve() {
    if (this.index !== void 0)
      return this.index;
    const zod = this.zod;
    const descriptors = [];
    const methods = /* @__PURE__ */ Object.create(null);
    for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
      const separator = endpoint.indexOf("/");
      const namespace = endpoint.slice(0, separator);
      const method2 = endpoint.slice(separator + 1);
      const parameters = definition.parameters.map((parameter2) => ({ ...parameter2, wire: parameter2.wire ?? parameter2.name }));
      const descriptor = {
        ...definition,
        id: `${this.spec.package}#${endpoint}`,
        namespace,
        method: method2,
        parameters,
        result: definition.result.description === void 0 ? definition.result : new ResultValue(definition.result)
      };
      if (definition.invocation.kind === "direct") {
        const inputs = [];
        const direct = Object.assign(descriptor, {
          input(options) {
            const strict = options?.strict === true;
            return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
          },
          invoke(remote, input, signal) {
            const named = input;
            const values = parameters.map((parameter2) => named[parameter2.wire]);
            if (definition.cancellation !== void 0)
              values.push(signal);
            const receiver = Reflect.get(remote, namespace);
            const call = Reflect.get(receiver, method2);
            return call.apply(receiver, values);
          }
        });
        methods[endpoint] = direct;
      }
      descriptors.push(descriptor);
    }
    return this.index = { descriptors, methods };
  }
};
function optional(parameter2) {
  return parameter2.source === "json" && parameter2.acceptsUndefined === true;
}
var NamedInput = class {
  parameters;
  strict;
  zod;
  schema;
  projection;
  constructor(parameters, strict, zod) {
    this.parameters = parameters;
    this.strict = strict;
    this.zod = zod;
  }
  codec(parameter2) {
    return this.strict ? parameter2.strictCodec : parameter2.codec;
  }
  create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter2) => {
    const value = this.codec(parameter2).create();
    return [parameter2.wire, optional(parameter2) ? value.optional() : value.nonoptional()];
  })));
  get jsonSchema() {
    return this.project().jsonSchema;
  }
  get jsonSchemaError() {
    return this.project().jsonSchemaError;
  }
  project() {
    if (this.projection !== void 0)
      return this.projection;
    const unavailable = this.parameters.find((parameter2) => this.codec(parameter2).jsonSchema === void 0);
    if (unavailable !== void 0) {
      return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` };
    }
    return this.projection = {
      jsonSchema: {
        type: "object",
        properties: Object.fromEntries(this.parameters.map((parameter2) => [parameter2.wire, {
          ...this.codec(parameter2).jsonSchema,
          ...parameter2.description === void 0 ? {} : { description: parameter2.description }
        }])),
        required: this.parameters.filter((parameter2) => !optional(parameter2)).map((parameter2) => parameter2.wire),
        additionalProperties: false
      }
    };
  }
};
var ResultValue = class {
  spec;
  projection;
  constructor(spec) {
    this.spec = spec;
  }
  get mode() {
    return this.spec.mode;
  }
  get typeSymbol() {
    return this.spec.typeSymbol;
  }
  get create() {
    return this.spec.create;
  }
  get decode() {
    return this.spec.decode;
  }
  get encode() {
    return this.spec.encode;
  }
  get description() {
    return this.spec.description;
  }
  get jsonSchemaError() {
    return this.spec.jsonSchemaError;
  }
  get jsonSchema() {
    if (this.projection === void 0) {
      const schema = this.spec.jsonSchema;
      this.projection = { value: schema === void 0 ? void 0 : { ...schema, description: this.spec.description } };
    }
    return this.projection.value;
  }
};

// src/remote.ts
var import_zod = require("zod");
var issue = import_zod.z.object({
  projectId: import_zod.z.number().int(),
  projectPath: import_zod.z.string(),
  iid: import_zod.z.number().int(),
  title: import_zod.z.string(),
  state: import_zod.z.enum(["opened", "closed"]),
  issueType: import_zod.z.string(),
  status: import_zod.z.enum(["todo", "doing", "blocked", "done"]).nullable(),
  statusConflict: import_zod.z.boolean(),
  confidential: import_zod.z.boolean(),
  dueDate: import_zod.z.string().nullable(),
  overdue: import_zod.z.boolean(),
  risk: import_zod.z.enum(["low", "medium", "high"]).nullable(),
  riskConflict: import_zod.z.boolean(),
  milestoneTitle: import_zod.z.string().nullable(),
  commentCount: import_zod.z.number().int(),
  labels: import_zod.z.array(import_zod.z.object({ name: import_zod.z.string(), color: import_zod.z.string().nullable() })),
  assignees: import_zod.z.array(import_zod.z.object({ id: import_zod.z.number().int(), username: import_zod.z.string(), name: import_zod.z.string() })),
  webUrl: import_zod.z.string(),
  updatedAt: import_zod.z.string(),
  description: import_zod.z.string().optional()
});
var page = import_zod.z.object({
  issues: import_zod.z.array(issue),
  page: import_zod.z.number().int(),
  perPage: import_zod.z.number().int(),
  nextPage: import_zod.z.number().int().nullable(),
  truncated: import_zod.z.boolean(),
  total: import_zod.z.number().int().nullable()
});
var query = import_zod.z.object({
  scope: import_zod.z.enum(["opened", "closed", "status", "unscoped", "all"]),
  status: import_zod.z.enum(["todo", "doing", "blocked", "done"]).optional(),
  assigneeId: import_zod.z.union([import_zod.z.number().int(), import_zod.z.literal("None")]).optional(),
  labels: import_zod.z.array(import_zod.z.string()).optional(),
  risk: import_zod.z.enum(["low", "medium", "high", "none"]).optional(),
  search: import_zod.z.string().optional(),
  summary: import_zod.z.enum(["overdue", "due_this_week", "high_risk", "unassessed"]).optional(),
  projectId: import_zod.z.number().int().optional(),
  page: import_zod.z.number().int(),
  perPage: import_zod.z.number().int()
});
var connection = import_zod.z.object({
  configured: import_zod.z.boolean(),
  baseUrl: import_zod.z.string(),
  groupPath: import_zod.z.string(),
  groupFullPath: import_zod.z.string().nullable(),
  allowSelfSigned: import_zod.z.boolean(),
  tokenConfigured: import_zod.z.boolean(),
  tokenMasked: import_zod.z.string().nullable(),
  labelsReady: import_zod.z.boolean(),
  gitlabHealth: import_zod.z.enum(["unconfigured", "ok", "error"]),
  gitlabHealthDetail: import_zod.z.string().nullable(),
  wecomConfigured: import_zod.z.boolean(),
  wecomCorpId: import_zod.z.string(),
  wecomSpaceId: import_zod.z.string(),
  wecomFatherId: import_zod.z.string(),
  wecomSecretConfigured: import_zod.z.boolean(),
  wecomSecretMasked: import_zod.z.string().nullable(),
  wecomHealth: import_zod.z.enum(["unconfigured", "ok", "error"]),
  wecomHealthDetail: import_zod.z.string().nullable(),
  lastReport: import_zod.z.object({
    at: import_zod.z.string(),
    written: import_zod.z.number().int(),
    skipped: import_zod.z.number().int(),
    failed: import_zod.z.number().int()
  }).nullable()
});
function codec(name2, schema) {
  return {
    mode: "strict",
    typeSymbol: `keel.${name2}`,
    create: () => schema
  };
}
function parameter(name2, schema) {
  const value = codec(name2, schema);
  return {
    name: name2,
    source: "json",
    codec: value,
    strictCodec: value
  };
}
function method(serviceMethod, parameters, result, resultName) {
  return {
    service: "keel",
    invocation: { kind: "direct" },
    parameters,
    cancellation: { parameter: "signal" },
    result: codec(resultName, result)
  };
}
var TYPERT_REMOTE = createTypertRemoteInfo({
  package: "keel",
  methods: {
    "keel/connection": method("connection", [], connection, "Connection"),
    "keel/setToken": method("setToken", [parameter("value", import_zod.z.string())], import_zod.z.object({ configured: import_zod.z.literal(true) }), "TokenSet"),
    "keel/clearToken": method("clearToken", [], import_zod.z.object({ configured: import_zod.z.literal(false) }), "TokenCleared"),
    "keel/listMembers": method("listMembers", [], import_zod.z.array(import_zod.z.object({
      id: import_zod.z.number().int(),
      username: import_zod.z.string(),
      name: import_zod.z.string()
    })), "Members"),
    "keel/listLabels": method("listLabels", [], import_zod.z.array(import_zod.z.object({
      name: import_zod.z.string(),
      color: import_zod.z.string().nullable()
    })), "Labels"),
    "keel/listProjects": method("listProjects", [], import_zod.z.array(import_zod.z.object({
      projectId: import_zod.z.number().int(),
      projectPath: import_zod.z.string()
    })), "Projects"),
    "keel/listIssues": method("listIssues", [parameter("query", query)], page, "ListPage"),
    "keel/setDueDate": method("setDueDate", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int()),
      parameter("dueDate", import_zod.z.string())
    ], issue, "Issue"),
    "keel/setRisk": method("setRisk", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int()),
      parameter("risk", import_zod.z.enum(["low", "medium", "high", "none"]))
    ], issue, "Issue"),
    "keel/setState": method("setState", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int()),
      parameter("state", import_zod.z.enum(["opened", "closed"]))
    ], issue, "Issue"),
    "keel/setStatus": method("setStatus", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int()),
      parameter("status", import_zod.z.enum(["todo", "doing", "blocked", "done", "none"]))
    ], issue, "Issue"),
    "keel/createIssue": method("createIssue", [parameter("input", import_zod.z.object({
      projectId: import_zod.z.number().int(),
      title: import_zod.z.string(),
      assigneeId: import_zod.z.number().int().optional(),
      status: import_zod.z.enum(["todo", "doing", "blocked", "done"]).optional(),
      dueDate: import_zod.z.string().optional(),
      risk: import_zod.z.enum(["low", "medium", "high"]).optional()
    }))], issue, "Issue"),
    "keel/columnModes": method("columnModes", [parameter("projectId", import_zod.z.number().int())], import_zod.z.object({
      modes: import_zod.z.array(import_zod.z.object({ projectId: import_zod.z.number().int(), columnMode: import_zod.z.enum(["status", "state"]) })),
      truncated: import_zod.z.boolean()
    }), "ColumnModes"),
    "keel/summary": method("summary", [parameter("query", query)], import_zod.z.object({
      overdue: import_zod.z.object({ count: import_zod.z.number().int(), complete: import_zod.z.boolean() }),
      dueThisWeek: import_zod.z.object({ count: import_zod.z.number().int(), complete: import_zod.z.boolean() }),
      highRisk: import_zod.z.object({ count: import_zod.z.number().int(), complete: import_zod.z.boolean() }),
      unassessed: import_zod.z.object({ count: import_zod.z.number().int(), complete: import_zod.z.boolean() })
    }), "Summary"),
    "keel/getIssue": method("getIssue", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int())
    ], issue, "Issue"),
    "keel/listNotes": method("listNotes", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int()),
      parameter("page", import_zod.z.number().int())
    ], import_zod.z.object({
      notes: import_zod.z.array(import_zod.z.object({
        id: import_zod.z.number().int(),
        system: import_zod.z.boolean(),
        body: import_zod.z.string(),
        authorName: import_zod.z.string(),
        createdAt: import_zod.z.string()
      })),
      page: import_zod.z.number().int(),
      nextPage: import_zod.z.number().int().nullable(),
      truncated: import_zod.z.boolean()
    }), "Notes"),
    "keel/setWecomSecret": method("setWecomSecret", [parameter("value", import_zod.z.string())], import_zod.z.object({ configured: import_zod.z.literal(true) }), "WecomSecretSet"),
    "keel/clearWecomSecret": method("clearWecomSecret", [], import_zod.z.object({ configured: import_zod.z.literal(false) }), "WecomSecretCleared"),
    "keel/analyzeIssue": method("analyzeIssue", [
      parameter("projectId", import_zod.z.number().int()),
      parameter("iid", import_zod.z.number().int()),
      parameter("sessionId", import_zod.z.string()),
      parameter("agentPreset", import_zod.z.string())
    ], import_zod.z.object({ sessionId: import_zod.z.string() }), "Session")
  }
}, import_zod.z);

// src/board/model.ts
var DEFAULT_FILTER = {
  assigneeId: "all",
  labels: [],
  projectId: "all",
  risk: "all",
  search: "",
  onlyMine: false,
  summary: null,
  view: "board"
};
var BOARD_PAGE_SIZE = 100;
function toListQuery(filter, scope, page2, perPage = BOARD_PAGE_SIZE, status, mineId) {
  const assigneeId = filter.onlyMine && mineId !== void 0 ? mineId : filter.assigneeId === "all" ? void 0 : filter.assigneeId;
  return {
    scope,
    page: page2,
    perPage,
    ...status === void 0 ? {} : { status },
    ...assigneeId === void 0 ? {} : { assigneeId },
    ...filter.labels.length > 0 ? { labels: [...filter.labels] } : {},
    ...filter.projectId === "all" ? {} : { projectId: filter.projectId },
    ...filter.risk === "all" ? {} : { risk: filter.risk },
    ...filter.search.trim() === "" ? {} : { search: filter.search.trim() },
    ...filter.summary === null ? {} : { summary: filter.summary }
  };
}
function beginSave(cards, key, field, attempted) {
  return cards.map((card) => issueKey(card.issue) === key ? { issue: card.issue, pending: { field, attempted, previous: card.issue } } : card);
}
function finishSave(cards, key, result) {
  return cards.map((card) => {
    if (issueKey(card.issue) !== key) return card;
    const field = card.pending?.field;
    const issue2 = field === "risk" || field === "status" ? { ...result, overdue: card.pending?.previous.overdue ?? card.issue.overdue } : result;
    return { issue: issue2 };
  });
}
function failSave(cards, key, message) {
  return cards.map((card) => {
    if (issueKey(card.issue) !== key || card.pending === void 0) return card;
    return {
      issue: card.pending.previous,
      error: { field: card.pending.field, attempted: card.pending.attempted, message }
    };
  });
}
function mergeColumn(previous, incoming) {
  const incomingKeys = new Set(incoming.map(issueKey));
  const merged = incoming.map((issue2) => {
    const prior = previous.find((card) => issueKey(card.issue) === issueKey(issue2));
    if (prior?.pending !== void 0) return prior;
    return { issue: issue2 };
  });
  const held = previous.filter((card) => card.pending !== void 0 && !incomingKeys.has(issueKey(card.issue)));
  return [...merged, ...held];
}
function shouldMove(from, to) {
  return from !== to;
}
function droppedIssue(opened, closed, key, target) {
  const card = [...opened, ...closed].find((item) => issueKey(item.issue) === key);
  if (card === void 0 || !shouldMove(card.issue.state, target)) return null;
  return card.issue;
}

// src/board/load.ts
var MAX_PAGES = 20;
var EMPTY_SUMMARY = {
  overdue: { count: 0, complete: true },
  dueThisWeek: { count: 0, complete: true },
  highRisk: { count: 0, complete: true },
  unassessed: { count: 0, complete: true }
};
async function loadBoard(api, filter, closedPages, mineId) {
  const projectId = filter.projectId === "all" ? 0 : filter.projectId;
  const modes = await api.columnModes(projectId);
  const summary = await api.summary(toListQuery({ ...filter, summary: null, risk: "all", labels: [] }, "all", 1, 1, void 0, mineId));
  if (modes.truncated) return emptyBoard(true, summary);
  const statusIds = new Set(modes.modes.filter((mode) => mode.columnMode === "status").map((mode) => mode.projectId));
  const stateIds = new Set(modes.modes.filter((mode) => mode.columnMode === "state").map((mode) => mode.projectId));
  const showStatus = statusIds.size > 0;
  const showState = stateIds.size > 0;
  if (filter.view === "list") {
    const list = await loadPages(api, filter, "all", MAX_PAGES, void 0, mineId);
    const marked = await markOverdue(api, filter, list.issues, mineId);
    return { ...emptyBoard(false, summary), showState, showStatus, list: marked.issues, listTruncated: list.truncated, overduePartial: marked.partial };
  }
  const opened = showState ? await loadPages(api, filter, "opened", MAX_PAGES, void 0, mineId) : { issues: [], truncated: false };
  const closed = showState ? await loadClosed(api, filter, closedPages, mineId) : { issues: [], truncated: false, hasMore: false };
  const todo = showStatus ? await loadPages(api, filter, "status", MAX_PAGES, "todo", mineId) : { issues: [], truncated: false };
  const doing = showStatus ? await loadPages(api, filter, "status", MAX_PAGES, "doing", mineId) : { issues: [], truncated: false };
  const blocked = showStatus ? await loadPages(api, filter, "status", MAX_PAGES, "blocked", mineId) : { issues: [], truncated: false };
  const done = showStatus ? await loadPages(api, filter, "status", MAX_PAGES, "done", mineId) : { issues: [], truncated: false };
  const unscopedAll = showStatus ? await loadPages(api, filter, "unscoped", MAX_PAGES, void 0, mineId) : { issues: [], truncated: false };
  const keep = (issues, allowed) => filter.projectId === "all" ? issues.filter((issue2) => allowed.has(issue2.projectId)) : issues;
  const columns = {
    opened: keep(opened.issues, stateIds),
    closed: keep(closed.issues, stateIds),
    todo: keep(todo.issues, statusIds),
    doing: keep(doing.issues, statusIds),
    blocked: keep(blocked.issues, statusIds),
    done: keep(done.issues, statusIds),
    unscoped: keep(unscopedAll.issues, statusIds)
  };
  const overdue = await markOverdue(api, filter, [
    ...columns.opened,
    ...columns.todo,
    ...columns.doing,
    ...columns.blocked,
    ...columns.done,
    ...columns.unscoped
  ], mineId);
  const flagged = new Set(overdue.issues.filter((issue2) => issue2.overdue).map(issueKey));
  const apply2 = (issues) => issues.map((issue2) => ({ ...issue2, overdue: issue2.state === "opened" && flagged.has(issueKey(issue2)) }));
  return {
    ...emptyBoard(false, summary),
    showState,
    showStatus,
    opened: apply2(columns.opened),
    closed: columns.closed.map((issue2) => ({ ...issue2, overdue: false })),
    todo: apply2(columns.todo),
    doing: apply2(columns.doing),
    blocked: apply2(columns.blocked),
    done: apply2(columns.done),
    unscoped: apply2(columns.unscoped),
    openedTruncated: opened.truncated,
    closedTruncated: closed.truncated,
    closedHasMore: closed.hasMore,
    statusTruncated: todo.truncated || doing.truncated || blocked.truncated || done.truncated || unscopedAll.truncated,
    overduePartial: overdue.partial
  };
}
async function loadPages(api, filter, scope, maxPages, status, mineId) {
  const issues = [];
  for (let page2 = 1; page2 <= maxPages; page2 += 1) {
    const result = await api.listIssues(toListQuery(filter, scope, page2, BOARD_PAGE_SIZE, status, mineId));
    issues.push(...result.issues);
    if (result.nextPage === null) return { issues, truncated: false };
    if (result.truncated || page2 === maxPages) return { issues, truncated: true };
  }
  return { issues, truncated: false };
}
async function loadClosed(api, filter, pages, mineId) {
  const issues = [];
  const limit = Math.min(Math.max(pages, 1), MAX_PAGES);
  let truncated = false;
  let hasMore = false;
  for (let page2 = 1; page2 <= limit; page2 += 1) {
    const result = await api.listIssues(toListQuery(filter, "closed", page2, BOARD_PAGE_SIZE, void 0, mineId));
    issues.push(...result.issues);
    truncated = result.truncated;
    hasMore = result.nextPage !== null && !result.truncated;
    if (result.nextPage === null || result.truncated) break;
  }
  return { issues, truncated, hasMore };
}
async function markOverdue(api, filter, issues, mineId) {
  const markFilter = {
    ...filter,
    summary: "overdue",
    ...filter.summary === "high_risk" && filter.risk === "all" ? { risk: "high" } : {},
    ...filter.summary === "unassessed" && filter.risk === "all" ? { risk: "none" } : {}
  };
  const overdue = await loadPages(api, markFilter, "opened", MAX_PAGES, void 0, mineId);
  const ids = new Set(overdue.issues.map(issueKey));
  return {
    partial: overdue.truncated,
    issues: issues.map((issue2) => ({ ...issue2, overdue: issue2.state === "opened" && ids.has(issueKey(issue2)) }))
  };
}
function emptyBoard(modeTruncated, summary) {
  return {
    modeTruncated,
    opened: [],
    closed: [],
    todo: [],
    doing: [],
    blocked: [],
    done: [],
    unscoped: [],
    showState: false,
    showStatus: false,
    openedTruncated: false,
    closedTruncated: false,
    closedHasMore: false,
    statusTruncated: false,
    overduePartial: false,
    list: [],
    listTruncated: false,
    summary: summary ?? EMPTY_SUMMARY
  };
}

// src/board/shortcuts.ts
function createDebounce(wait, schedule) {
  let cancel = () => {
  };
  return (fn) => {
    cancel();
    cancel = schedule(fn, wait);
  };
}

// src/risk.ts
var RISK_LABELS = {
  low: "risk::low",
  medium: "risk::medium",
  high: "risk::high"
};
var RANK = ["high", "medium", "low"];
var ALL = RANK.map((level) => RISK_LABELS[level]);

// src/status.ts
var STATUS_LEVELS = ["done", "blocked", "doing", "todo"];
var STATUS_LABELS = {
  todo: "status::todo",
  doing: "status::doing",
  blocked: "status::blocked",
  done: "status::done"
};
var ALL2 = STATUS_LEVELS.map((level) => STATUS_LABELS[level]);

// src/messages.ts
var OVERDUE_PARTIAL_MESSAGE = "\u903E\u671F\u6807\u8BB0\u4E0D\u5B8C\u6574";
var OPENED_CAP_MESSAGE = "\u53EA\u663E\u793A\u6700\u8FD1\u66F4\u65B0\u7684 2000 \u6761\u6253\u5F00\u8BAE\u9898";
var CLOSED_CAP_MESSAGE = "\u53EA\u663E\u793A\u6700\u8FD1\u66F4\u65B0\u7684 2000 \u6761\u5DF2\u5173\u95ED\u8BAE\u9898";
var CLOSED_PAGE_MESSAGE = "\u6700\u8FD1\u66F4\u65B0\u7684 100 \u6761\u5DF2\u5173\u95ED\u8BAE\u9898";

// src/board/markdown.ts
function renderIssueMarkdown(source, baseUrl) {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let html = "";
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(source.slice(cursor, index)).replaceAll("\n", "<br>");
    html += renderImage(match[1] ?? "", match[2] ?? "", baseUrl);
    cursor = index + match[0].length;
  }
  html += escapeHtml(source.slice(cursor)).replaceAll("\n", "<br>");
  return html;
}
function renderImage(alt, rawUrl, baseUrl) {
  const safeAlt = escapeHtml(alt);
  if (rawUrl.startsWith("data:")) return safeAlt;
  let absolute;
  try {
    absolute = new URL(rawUrl, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    return safeAlt;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return safeAlt;
  let origin = "";
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = "";
  }
  const sameHost = absolute.origin === origin || !/^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
  if (sameHost || rawUrl.startsWith("/")) {
    const href2 = escapeHtml(absolute.toString());
    return `<a href="${href2}" target="_blank" rel="noopener">\u56FE\u7247\uFF1A${safeAlt || "\u56FE\u7247"}\uFF08\u5728 GitLab \u4E2D\u6253\u5F00\uFF09</a>`;
  }
  const href = escapeHtml(absolute.toString());
  return `<img alt="${safeAlt}" src="${href}">`;
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// src/board/people.ts
function assigneeInitials(name2, username) {
  const trimmed = name2.trim();
  if (trimmed !== "") {
    const han = trimmed.match(/\p{Script=Han}/u);
    if (han?.[0] !== void 0) return han[0];
    const words = trimmed.split(/\s+/).filter((word) => word !== "");
    const first = words[0] ?? "";
    const second = words[1];
    if (second !== void 0) return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
    return first.slice(0, 2).toUpperCase();
  }
  return username.slice(0, 2);
}
function formatShanghai(iso, kind) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: kind === "full" ? "2-digit" : void 0,
    hourCycle: "h23"
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  if (kind === "short") return `${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

// src/client/view.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var RISK_NAMES = new Set(Object.values(RISK_LABELS));
var RISK_OPTIONS = [
  { value: "none", label: "\u672A\u8BC4\u4F30" },
  { value: "low", label: "\u4F4E" },
  { value: "medium", label: "\u4E2D" },
  { value: "high", label: "\u9AD8" }
];
function BoardView(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "keel-board", "aria-label": "\u9879\u76EE\u770B\u677F", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: STYLES }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "keel-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "\u9879\u76EE\u770B\u677F" }),
      props.groupFullPath !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-path", children: props.groupFullPath }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-status", children: props.status }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-refreshed", children: props.refreshedAt === null ? "\u5C1A\u672A\u62C9\u53D6" : formatLocal(props.refreshedAt) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: props.onRefresh, disabled: props.loading || !props.configured, children: "\u5237\u65B0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => props.onView("board"), "aria-pressed": props.view === "board", children: "\u770B\u677F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => props.onView("list"), "aria-pressed": props.view === "list", children: "\u5217\u8868" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: props.onCreate, children: "\u65B0\u5EFA\u8BAE\u9898" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: true, title: "\u4F01\u4E1A\u5FAE\u4FE1\u5468\u62A5\u5C06\u5728\u4E0B\u4E00\u7248\u63D0\u4F9B", children: "\u7ACB\u5373\u751F\u6210\u672C\u5468\u5468\u62A5" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: props.onHelp, children: "\u5FEB\u6377\u952E" })
    ] }),
    props.helpOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShortcutHelp, {}) : null,
    props.connectionError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-error", role: "alert", children: props.connectionError }) : null,
    props.overduePartial ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-banner", children: OVERDUE_PARTIAL_MESSAGE }) : null,
    props.modeTruncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-banner", children: "\u72B6\u6001\u6807\u7B7E\u8BAE\u9898\u8D85\u8FC7 2000 \u6761\uFF0C\u65E0\u6CD5\u5224\u5B9A\u5217\u6A21\u5F0F" }) : null,
    props.configured ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryBar, { ...props }) : null,
    props.configured ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Filters, { ...props }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectionForm, { ...props }),
    props.configured && props.projectError === null && !props.modeTruncated ? props.view === "list" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IssueTable, { ...props }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "keel-columns", children: [
      props.showStatus ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusColumn, { name: "\u5F85\u529E", column: "todo", cards: props.todo, note: props.statusTruncated ? OPENED_CAP_MESSAGE : null, ...props }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusColumn, { name: "\u8FDB\u884C\u4E2D", column: "doing", cards: props.doing, note: null, ...props }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusColumn, { name: "\u963B\u585E", column: "blocked", cards: props.blocked, note: null, ...props }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusColumn, { name: "\u5B8C\u6210", column: "done", cards: props.done, note: null, ...props }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusColumn, { name: "\u672A\u5206\u72B6\u6001", column: "none", cards: props.unscoped, note: null, ...props })
      ] }) : null,
      props.showState ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Column, { name: "\u6253\u5F00", state: "opened", cards: props.opened, note: props.openedTruncated ? OPENED_CAP_MESSAGE : null, onDrop: (key) => dropCard(props, "opened", key), ...props }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Column, { name: "\u5DF2\u5173\u95ED", state: "closed", cards: props.closed, note: props.closedTruncated ? CLOSED_CAP_MESSAGE : props.closedHasMore ? CLOSED_PAGE_MESSAGE : null, extra: props.closedHasMore && !props.closedTruncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: props.onLoadClosed, children: "\u52A0\u8F7D\u66F4\u65E9\u7684\u5DF2\u5173\u95ED\u8BAE\u9898" }) : null, onDrop: (key) => dropCard(props, "closed", key), ...props })
      ] }) : null
    ] }) : null,
    props.drawer.kind !== "none" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Drawer, { ...props }) : null
  ] });
}
function formatLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function SummaryBar(props) {
  const items = [
    ["overdue", "\u903E\u671F", props.summary?.overdue],
    ["due_this_week", "\u672C\u5468\u5230\u671F", props.summary?.dueThisWeek],
    ["high_risk", "\u9AD8\u98CE\u9669", props.summary?.highRisk],
    ["unassessed", "\u672A\u8BC4\u4F30", props.summary?.unassessed]
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "keel-summary", children: items.map(([id, label, count]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      "aria-pressed": props.filter.summary === id,
      onClick: () => props.onSummary(props.filter.summary === id ? null : id),
      children: [
        label,
        " ",
        count === void 0 ? "\u2026" : `${count.count}${count.complete ? "" : " \u4E0D\u5B8C\u6574"}`
      ]
    },
    id
  )) });
}
function ShortcutHelp() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", { className: "keel-help", "aria-label": "\u5FEB\u6377\u952E", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "c \u65B0\u5EFA\u8BAE\u9898\uFF0C/ \u641C\u7D22\uFF0C1 \u5230 4 \u8BBE\u7F6E\u72B6\u6001\uFF0CEnter \u6253\u5F00\u62BD\u5C49\uFF0CEsc \u5173\u95ED\uFF0C\u65B9\u5411\u952E\u79FB\u52A8\u7126\u70B9\u3002" }) });
}
function ConnectionForm(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "form",
    {
      className: "keel-connect",
      "data-keel": "connection",
      onSubmit: (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        props.onConnect({
          baseUrl: String(data.get("baseUrl") ?? ""),
          groupPath: String(data.get("groupPath") ?? ""),
          token: String(data.get("token") ?? ""),
          allowSelfSigned: data.get("allowSelfSigned") === "on",
          wecomCorpId: String(data.get("wecomCorpId") ?? ""),
          wecomSpaceId: String(data.get("wecomSpaceId") ?? ""),
          wecomFatherId: String(data.get("wecomFatherId") ?? ""),
          wecomSecret: String(data.get("wecomSecret") ?? "")
        });
        event.currentTarget.reset();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "GitLab \u6E90\u7AD9",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "baseUrl", defaultValue: "", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u7EC4\u8DEF\u5F84",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "groupPath", defaultValue: "", autoComplete: "off" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u4F8B\u5982 acme/platform\u3002\u53EA\u586B\u8DEF\u5F84\uFF0C\u4E0D\u586B\u6574\u6BB5\u7F51\u5740\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u5141\u8BB8\u81EA\u7B7E\u8BC1\u4E66",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "allowSelfSigned", type: "checkbox", defaultChecked: props.allowSelfSigned }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u53EA\u653E\u5BBD\u8FD9\u4E2A GitLab \u6E90\u7AD9\u7684\u4FE1\u4EFB\u5E93\u6821\u9A8C\uFF0C\u4E3B\u673A\u540D\u4ECD\u7136\u8981\u5339\u914D\uFF0C\u4E0D\u5F71\u54CD\u4F01\u4E1A\u5FAE\u4FE1\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u4EE4\u724C",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "token", type: "password", autoComplete: "off" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: props.tokenMasked ?? (props.tokenConfigured ? "\u5DF2\u4FDD\u5B58\u4EE4\u724C" : "\u5C1A\u672A\u4FDD\u5B58\u4EE4\u724C") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u4EE4\u724C\u4FDD\u5B58\u5728 DSH \u51ED\u636E\u5E93\uFF0C\u914D\u7F6E\u91CC\u53EA\u4FDD\u7559\u5F15\u7528\u540D tokenRef\u3002\u8BF7\u4F7F\u7528\u8BE5\u7EC4\u7684\u7EC4\u8BBF\u95EE\u4EE4\u724C\uFF0C\u89D2\u8272\u4E0D\u4F4E\u4E8E Reporter\uFF0C\u8303\u56F4\u5305\u542B api\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u4F01\u4E1A\u5FAE\u4FE1\u4F01\u4E1A ID",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "wecomCorpId", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u7A7A\u95F4 spaceid",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "wecomSpaceId", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u76EE\u5F55 fatherid",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "wecomFatherId", autoComplete: "off" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "\u6587\u6863\u653E\u5728\u7A7A\u95F4\u6839\u4E0A\u65F6\uFF0Cfatherid \u586B\u540C\u4E00\u4E2A spaceid\u3002\u5468\u62A5\u5199\u5165\u5C06\u5728\u4E0B\u4E00\u7248\u63D0\u4F9B\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u4F01\u4E1A\u5FAE\u4FE1 Secret",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { name: "wecomSecret", type: "password", autoComplete: "off" })
        ] }),
        props.connectError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-error", role: "alert", children: props.connectError }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", children: "\u4FDD\u5B58\u5E76\u8FDE\u63A5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: props.onClearToken, children: "\u6E05\u9664\u4EE4\u724C" })
      ]
    }
  );
}
function Filters(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "keel-filters", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      "\u641C\u7D22",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: props.filter.search, onChange: (event) => props.onSearch(event.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      "\u53EA\u770B\u6211\u7684",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: props.filter.onlyMine, disabled: props.mineName === null, onChange: (event) => props.onOnlyMine(event.target.checked) }),
      props.mineName ?? ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      "\u98CE\u9669",
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: props.filter.risk, onChange: (event) => props.onFilter({ ...props.filter, risk: event.target.value }), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: "\u5168\u90E8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "none", children: "\u672A\u8BC4\u4F30" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "low", children: "\u4F4E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "medium", children: "\u4E2D" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "high", children: "\u9AD8" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      "\u8D1F\u8D23\u4EBA",
      props.memberError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "keel-error", children: props.memberError }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "select",
        {
          value: String(props.filter.assigneeId),
          disabled: props.filter.onlyMine,
          onChange: (event) => {
            const value = event.target.value;
            props.onFilter({
              ...props.filter,
              assigneeId: value === "all" || value === "None" ? value : Number(value)
            });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: "\u5168\u90E8" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "None", children: "\u672A\u6307\u6D3E" }),
            props.members.map((member) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: member.id, children: [
              member.name,
              " (",
              member.username,
              ")"
            ] }, member.id))
          ]
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "\u6807\u7B7E" }),
      props.labelError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "keel-error", children: props.labelError }) : props.labels.map((label) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: props.filter.labels.includes(label.name),
            onChange: (event) => {
              const labels = event.target.checked ? [...props.filter.labels, label.name] : props.filter.labels.filter((name2) => name2 !== label.name);
              props.onFilter({ ...props.filter, labels });
            }
          }
        ),
        label.name
      ] }, label.name))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
      "\u4ED3\u5E93",
      props.projectError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "keel-error", children: props.projectError }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "select",
        {
          value: String(props.filter.projectId),
          onChange: (event) => {
            const value = event.target.value;
            props.onFilter({
              ...props.filter,
              projectId: value === "all" ? "all" : Number(value)
            });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: "\u5168\u90E8\u4ED3\u5E93" }),
            props.projects.map((project) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: project.projectId, children: project.projectPath }, project.projectId))
          ]
        }
      )
    ] })
  ] });
}
function StatusColumn(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    Column,
    {
      name: props.name,
      state: "opened",
      cards: props.cards,
      note: props.note,
      onDrop: (key) => dropStatus(props, props.column, key),
      onDueDate: props.onDueDate,
      onRisk: props.onRisk,
      onMove: props.onMove,
      onRetry: props.onRetry,
      onOpen: props.onOpen,
      onStatus: props.onStatus
    }
  );
}
function dropStatus(props, target, key) {
  const card = [props.todo, props.doing, props.blocked, props.done, props.unscoped].flat().find((item) => issueKey(item.issue) === key);
  if (card === void 0) return;
  const current = card.issue.status ?? "none";
  if (current === target) return;
  props.onStatus(card.issue, target);
}
function IssueTable(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "keel-list", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u6807\u9898" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u4ED3\u5E93" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7F16\u53F7" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u72B6\u6001\u6216\u5F00\u5173" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u8D1F\u8D23\u4EBA" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u622A\u6B62\u65E5\u671F" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u98CE\u9669" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u8BC4\u8BBA\u6570" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u66F4\u65B0\u65F6\u95F4" })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: props.list.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { onClick: () => props.onOpen(card.issue), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.projectPath }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
        "#",
        card.issue.iid
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.status ?? card.issue.state }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.assignees[0]?.name ?? "\u672A\u6307\u6D3E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.dueDate ?? "" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.risk ?? "\u672A\u8BC4\u4F30" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: card.issue.commentCount }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: formatShanghai(card.issue.updatedAt, "full"), children: formatShanghai(card.issue.updatedAt, "short") })
    ] }, issueKey(card.issue))) })
  ] });
}
function Drawer(props) {
  if (props.drawer.kind === "none") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { className: "keel-drawer", "aria-label": props.drawer.kind === "create" ? "\u65B0\u5EFA\u8BAE\u9898" : "\u8BAE\u9898\u8BE6\u60C5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: props.onCloseDrawer, children: "\u5173\u95ED\u62BD\u5C49" }),
    props.drawer.kind === "create" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u65B0\u5EFA\u8BAE\u9898" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: props.drawer.issue.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { dangerouslySetInnerHTML: { __html: props.drawer.html || renderIssueMarkdown(props.drawer.issue.description ?? "", "") } }),
      props.drawer.issue.milestoneTitle !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
        "\u91CC\u7A0B\u7891 ",
        props.drawer.issue.milestoneTitle
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: props.drawer.notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
        note.system ? "\u52A8\u6001" : "\u8BC4\u8BBA",
        " ",
        note.authorName,
        " ",
        note.body
      ] }, note.id)) })
    ] })
  ] });
}
function dropCard(props, target, key) {
  const issue2 = droppedIssue(props.opened, props.closed, key, target);
  if (issue2 === null) return;
  props.onMove(issue2, target);
}
function Column(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      className: "keel-column",
      "data-keel": `column-${props.state}`,
      "aria-label": props.name,
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => {
        event.preventDefault();
        props.onDrop(event.dataTransfer.getData("text/plain"));
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
          props.name,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: props.cards.length })
        ] }),
        props.note !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: props.note }) : null,
        props.extra,
        props.cards.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6CA1\u6709\u8BAE\u9898" }) : props.cards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Card,
          {
            card,
            onDueDate: props.onDueDate,
            onRisk: props.onRisk,
            onMove: props.onMove,
            onRetry: props.onRetry,
            onOpen: props.onOpen,
            onStatus: props.onStatus
          },
          issueKey(card.issue)
        ))
      ]
    }
  );
}
function Card(props) {
  const { issue: issue2 } = props.card;
  const saving = props.card.pending !== void 0;
  const reserved = /* @__PURE__ */ new Set([...RISK_NAMES, ...Object.values(STATUS_LABELS)]);
  const otherLabels = issue2.labels.filter((label) => !reserved.has(label.name));
  const unknownRisk = issue2.labels.some((label) => label.name.startsWith("risk::") && !RISK_NAMES.has(label.name));
  const unknownStatus = issue2.labels.some((label) => label.name.startsWith("status::") && !Object.values(STATUS_LABELS).includes(label.name));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "article",
    {
      className: "keel-card",
      draggable: !saving,
      onDragStart: (event) => event.dataTransfer.setData("text/plain", issueKey(issue2)),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => props.onOpen(issue2), children: issue2.title }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", { href: issue2.webUrl, target: "_blank", rel: "noopener", children: [
          issue2.projectPath,
          "#",
          issue2.iid
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: issue2.assignees.length === 0 ? "\u672A\u6307\u6D3E" : issue2.assignees.map((person) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "keel-avatar", "aria-hidden": "true", children: assigneeInitials(person.name, person.username) }),
          person.name
        ] }, person.id)) }),
        issue2.milestoneTitle !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
          "\u91CC\u7A0B\u7891 ",
          issue2.milestoneTitle
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
          "\u8BC4\u8BBA ",
          issue2.commentCount
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { title: formatShanghai(issue2.updatedAt, "full"), children: formatShanghai(issue2.updatedAt, "short") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u622A\u6B62\u65E5\u671F",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "date",
              value: issue2.dueDate ?? "",
              disabled: saving,
              onChange: (event) => props.onDueDate(issue2, event.target.value)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: saving, onClick: () => props.onDueDate(issue2, ""), children: "\u6E05\u9664" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u98CE\u9669",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "select",
            {
              value: issue2.risk ?? "none",
              disabled: saving,
              onChange: (event) => props.onRisk(issue2, event.target.value),
              children: RISK_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: option.value, children: option.label }, option.value))
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u72B6\u6001",
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: issue2.status ?? "none", disabled: saving, onChange: (event) => props.onStatus(issue2, event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "none", children: "\u672A\u5206\u72B6\u6001" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "todo", children: "\u5F85\u529E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "doing", children: "\u8FDB\u884C\u4E2D" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "blocked", children: "\u963B\u585E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "done", children: "\u5B8C\u6210" })
          ] })
        ] }),
        issue2.riskConflict ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u98CE\u9669\u6807\u7B7E\u91CD\u590D" }) : null,
        issue2.statusConflict ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u72B6\u6001\u6807\u7B7E\u91CD\u590D" }) : null,
        unknownRisk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u672A\u8BC6\u522B\u7684\u98CE\u9669\u6807\u7B7E" }) : null,
        unknownStatus ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u672A\u8BC6\u522B\u7684\u72B6\u6001\u6807\u7B7E" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "keel-labels", children: otherLabels.map((label) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "keel-chip", style: { borderColor: label.color ?? "currentColor" }, children: label.name }, label.name)) }),
        issue2.overdue ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u903E\u671F" }) : null,
        issue2.issueType !== "issue" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: issue2.issueType }) : null,
        issue2.confidential ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u4FDD\u5BC6" }) : null,
        issue2.state === "closed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5DF2\u5173\u95ED" }) : null,
        saving ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u4FDD\u5B58\u4E2D" }) : null,
        props.card.error !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "keel-error", role: "alert", children: [
          props.card.error.message,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => props.onRetry(issue2), children: "\u91CD\u8BD5" })
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: saving || issue2.state === "opened", onClick: () => props.onMove(issue2, "opened"), children: "\u79FB\u52A8\u5230\u6253\u5F00" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: saving || issue2.state === "closed", onClick: () => props.onMove(issue2, "closed"), children: "\u79FB\u52A8\u5230\u5DF2\u5173\u95ED" })
      ]
    }
  );
}
function KeelIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 24 24", width: "20", height: "20", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 16h16M6 16V8h4v8M14 16V5h4v11", fill: "none", stroke: "currentColor", strokeWidth: "1.6" }) });
}
var STYLES = `
.keel-board { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 0; }
.keel-title { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.keel-title h1 { margin: 0; font-size: 20px; }
.keel-filters, .keel-connect { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.keel-filters label, .keel-connect label { display: flex; flex-direction: column; gap: 4px; }
.keel-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.keel-column, .keel-card { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px; }
.keel-column { display: flex; flex-direction: column; gap: 8px; min-height: 160px; }
.keel-card { display: flex; flex-direction: column; gap: 6px; background: #fff; }
.keel-card h3 { margin: 0; font-size: 16px; }
.keel-chip { display: inline-block; margin-right: 6px; padding: 0 6px; border: 1px solid; border-radius: 999px; }
.keel-error { color: #cf222e; }
.keel-drawer { position: absolute; right: 0; top: 0; width: 420px; max-width: 100%; background: #fff; border-left: 1px solid #d0d7de; padding: 16px; }
.keel-avatar { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; background: #eaeef2; margin-right: 4px; }
.keel-board { position: relative; }
@media (max-width: 767px) {
  .keel-columns, .keel-filters, .keel-connect { display: flex; flex-direction: column; }
  .keel-filters label, .keel-connect label { width: 100%; }
}
`;
function statusOf(configured, failed) {
  if (!configured) return "\u672A\u914D\u7F6E";
  if (failed) return "\u8FDE\u63A5\u5931\u8D25";
  return "\u5DF2\u8FDE\u63A5";
}

// src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var POLL_MS = 1e4;
var name = "keel";
var inject = ["slots", "locale", "remote", "remote.settings", "layout"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register("keel", {
    zh: { panel: "\u9879\u76EE\u770B\u677F" },
    en: { panel: "Project board" }
  }));
  let disposeMount;
  let cancelled = false;
  const ready = ctx.remote.$mount(TYPERT_REMOTE).then(async (dispose) => {
    if (cancelled) {
      await dispose();
      return;
    }
    disposeMount = dispose;
  });
  ctx.effect(() => () => {
    cancelled = true;
    void disposeMount?.();
  });
  const remote = {
    async listIssues(query2) {
      await ready;
      return unwrap(await ctx.remote.keel.listIssues(query2));
    },
    async columnModes(projectId) {
      await ready;
      return unwrap(await ctx.remote.keel.columnModes(projectId));
    },
    async summary(query2) {
      await ready;
      return unwrap(await ctx.remote.keel.summary(query2));
    },
    async saveConfig(input, tokenConfigured) {
      await ready;
      const described = await ctx.remote.settings.describe();
      if (!described.ok) throw new Error(described.error?.message ?? "\u5C1A\u672A\u914D\u7F6E GitLab \u8FDE\u63A5");
      const current = described.value?.namespaces.find((item) => item.ns === "keel");
      const updated = await ctx.remote.settings.update("keel", {
        baseUrl: input.baseUrl,
        groupPath: input.groupPath,
        allowSelfSigned: input.allowSelfSigned,
        wecomCorpId: input.wecomCorpId,
        wecomSpaceId: input.wecomSpaceId,
        wecomFatherId: input.wecomFatherId
      }, current?.revision);
      if (input.wecomSecret.trim() !== "") {
        const secret = await ctx.remote.keel.setWecomSecret(input.wecomSecret);
        if (!secret.ok) throw new Error(secret.error?.message ?? "\u8F93\u5165\u4E0D\u7B26\u5408\u7EA6\u5B9A\u683C\u5F0F");
      }
      if (!updated.ok) throw new Error(updated.error?.message ?? "\u5C1A\u672A\u914D\u7F6E GitLab \u8FDE\u63A5");
      if (input.token.trim() !== "") {
        const saved = await ctx.remote.keel.setToken(input.token);
        if (!saved.ok) throw new Error(saved.error?.message ?? "\u8F93\u5165\u4E0D\u7B26\u5408\u7EA6\u5B9A\u683C\u5F0F");
      } else if (!tokenConfigured) {
        throw new Error("\u5C1A\u672A\u4FDD\u5B58\u4EE4\u724C");
      }
      return unwrap(await ctx.remote.keel.connection());
    },
    async clearToken() {
      await ready;
      return unwrap(await ctx.remote.keel.clearToken());
    },
    async connection() {
      await ready;
      return unwrap(await ctx.remote.keel.connection());
    },
    async members() {
      await ready;
      return unwrap(await ctx.remote.keel.listMembers());
    },
    async labels() {
      await ready;
      return unwrap(await ctx.remote.keel.listLabels());
    },
    async projects() {
      await ready;
      return unwrap(await ctx.remote.keel.listProjects());
    },
    async write(field, issue2, attempted) {
      await ready;
      if (field === "dueDate") return unwrap(await ctx.remote.keel.setDueDate(issue2.projectId, issue2.iid, attempted));
      if (field === "risk") return unwrap(await ctx.remote.keel.setRisk(issue2.projectId, issue2.iid, attempted));
      return unwrap(await ctx.remote.keel.setState(issue2.projectId, issue2.iid, attempted));
    }
  };
  ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: "keel",
    order: 20,
    label: "\u9879\u76EE\u770B\u677F"
  }, KeelIcon)));
  ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: "keel"
  }, function KeelPanel() {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(BoardApp, { remote });
  })));
}
function unwrap(result) {
  if (!result.ok || result.value === void 0) {
    throw new Error(result.error?.message ?? "\u65E0\u6CD5\u8FDE\u63A5 GitLab");
  }
  return result.value;
}
function BoardApp({ remote }) {
  const [filter, setFilter] = (0, import_react.useState)(DEFAULT_FILTER);
  const [connection2, setConnection] = (0, import_react.useState)(null);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const [connectionError, setConnectionError] = (0, import_react.useState)(null);
  const [connectError, setConnectError] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [refreshedAt, setRefreshedAt] = (0, import_react.useState)(null);
  const [members, setMembers] = (0, import_react.useState)([]);
  const [memberError, setMemberError] = (0, import_react.useState)(null);
  const [labels, setLabels] = (0, import_react.useState)([]);
  const [labelError, setLabelError] = (0, import_react.useState)(null);
  const [projects, setProjects] = (0, import_react.useState)([]);
  const [projectError, setProjectError] = (0, import_react.useState)(null);
  const [opened, setOpened] = (0, import_react.useState)([]);
  const [closed, setClosed] = (0, import_react.useState)([]);
  const [todo, setTodo] = (0, import_react.useState)([]);
  const [doing, setDoing] = (0, import_react.useState)([]);
  const [blocked, setBlocked] = (0, import_react.useState)([]);
  const [done, setDone] = (0, import_react.useState)([]);
  const [unscoped, setUnscoped] = (0, import_react.useState)([]);
  const [list, setList] = (0, import_react.useState)([]);
  const [summary, setSummary] = (0, import_react.useState)(null);
  const [showState, setShowState] = (0, import_react.useState)(true);
  const [showStatus, setShowStatus] = (0, import_react.useState)(false);
  const [modeTruncated, setModeTruncated] = (0, import_react.useState)(false);
  const [statusTruncated, setStatusTruncated] = (0, import_react.useState)(false);
  const [openedTruncated, setOpenedTruncated] = (0, import_react.useState)(false);
  const [closedTruncated, setClosedTruncated] = (0, import_react.useState)(false);
  const [closedHasMore, setClosedHasMore] = (0, import_react.useState)(false);
  const [overduePartial, setOverduePartial] = (0, import_react.useState)(false);
  const [closedPages, setClosedPages] = (0, import_react.useState)(1);
  const ticketRef = (0, import_react.useRef)(0);
  const cards = (0, import_react.useRef)({ opened, closed });
  const busy = (0, import_react.useRef)(false);
  const filterRef = (0, import_react.useRef)(filter);
  const searchDebounce = (0, import_react.useRef)(createDebounce(300, (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  }));
  const pagesRef = (0, import_react.useRef)(closedPages);
  cards.current = { opened, closed };
  filterRef.current = filter;
  pagesRef.current = closedPages;
  async function reload(nextFilter, pages, fromTimer = false) {
    if (fromTimer && busy.current) return;
    const ticket = ++ticketRef.current;
    busy.current = true;
    setLoading(true);
    try {
      const loaded = await loadBoard(remote, nextFilter, pages);
      if (ticket !== ticketRef.current) return;
      setOpened(mergeColumn(cards.current.opened, loaded.opened));
      setClosed(mergeColumn(cards.current.closed, loaded.closed));
      setTodo(loaded.todo.map((issue2) => ({ issue: issue2 })));
      setDoing(loaded.doing.map((issue2) => ({ issue: issue2 })));
      setBlocked(loaded.blocked.map((issue2) => ({ issue: issue2 })));
      setDone(loaded.done.map((issue2) => ({ issue: issue2 })));
      setUnscoped(loaded.unscoped.map((issue2) => ({ issue: issue2 })));
      setList(loaded.list.map((issue2) => ({ issue: issue2 })));
      setSummary(loaded.summary);
      setShowState(loaded.showState);
      setShowStatus(loaded.showStatus);
      setModeTruncated(loaded.modeTruncated);
      setStatusTruncated(loaded.statusTruncated);
      setOpenedTruncated(loaded.openedTruncated);
      setClosedTruncated(loaded.closedTruncated);
      setClosedHasMore(loaded.closedHasMore);
      setOverduePartial(loaded.overduePartial);
      setRefreshedAt(/* @__PURE__ */ new Date());
      setFailed(false);
      setConnectionError(null);
    } catch (error) {
      if (ticket !== ticketRef.current) return;
      setFailed(true);
      setConnectionError(error instanceof Error ? error.message : "\u65E0\u6CD5\u8FDE\u63A5 GitLab");
    } finally {
      if (ticket === ticketRef.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }
  (0, import_react.useEffect)(() => {
    const handle = {};
    let stop = false;
    void (async () => {
      try {
        const view = await remote.connection();
        if (stop) return;
        setConnection(view);
        setFailed(false);
        if (!view.configured) return;
        const [memberResult, labelResult, projectResult] = await Promise.allSettled([
          remote.members(),
          remote.labels(),
          remote.projects()
        ]);
        if (stop) return;
        if (memberResult.status === "fulfilled") setMembers(memberResult.value);
        else setMemberError(messageOf(memberResult.reason));
        if (labelResult.status === "fulfilled") setLabels(labelResult.value);
        else setLabelError(messageOf(labelResult.reason));
        if (projectResult.status === "fulfilled") setProjects(projectResult.value);
        else {
          setProjectError(messageOf(projectResult.reason));
          return;
        }
        await reload(DEFAULT_FILTER, 1);
      } catch (error) {
        if (stop) return;
        setFailed(true);
        setConnectionError(messageOf(error));
      }
      if (stop) return;
      handle.timer = setInterval(() => {
        void reload(filterRef.current, pagesRef.current, true);
      }, POLL_MS);
    })();
    return () => {
      stop = true;
      if (handle.timer !== void 0) clearInterval(handle.timer);
    };
  }, []);
  async function save(field, issue2, attempted) {
    const key = issueKey(issue2);
    const update = (column, setter) => setter(beginSave(column, key, field, attempted));
    if (issue2.state === "opened") update(opened, setOpened);
    else update(closed, setClosed);
    try {
      const result = await remote.write(field, issue2, attempted);
      const place = (column, state) => {
        if (result.state !== state) return column.filter((card) => issueKey(card.issue) !== key);
        return column.some((card) => issueKey(card.issue) === key) ? finishSave(column, key, result) : [{ issue: result }, ...column];
      };
      setOpened((column) => place(column, "opened"));
      setClosed((column) => place(column, "closed"));
    } catch (error) {
      const apply2 = (column) => failSave(column, key, messageOf(error));
      setOpened(apply2);
      setClosed(apply2);
    }
  }
  const configured = connection2?.configured === true;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    BoardView,
    {
      configured,
      status: statusOf(configured, failed),
      groupFullPath: connection2?.groupFullPath ?? null,
      tokenMasked: connection2?.tokenMasked ?? null,
      tokenConfigured: connection2?.tokenConfigured === true,
      allowSelfSigned: connection2?.allowSelfSigned === true,
      showState,
      showStatus,
      modeTruncated,
      todo,
      doing,
      blocked,
      done,
      unscoped,
      statusTruncated,
      summary,
      view: filter.view,
      list,
      helpOpen: false,
      drawer: { kind: "none" },
      mineName: null,
      onSummary: () => {
      },
      onView: (view) => setFilter((current) => ({ ...current, view })),
      onSearch: (search) => {
        setFilter((current) => ({ ...current, search }));
        searchDebounce.current(() => {
          void reload({ ...filterRef.current, search }, 1);
        });
      },
      onOnlyMine: (onlyMine) => setFilter((current) => ({ ...current, onlyMine })),
      onCreate: () => {
      },
      onOpen: () => {
      },
      onCloseDrawer: () => {
      },
      onHelp: () => {
      },
      onStatus: () => {
      },
      refreshedAt,
      loading,
      connectionError,
      connectError,
      filter,
      members,
      memberError,
      labels,
      labelError,
      projects,
      projectError,
      opened,
      closed,
      openedTruncated,
      closedTruncated,
      closedHasMore,
      overduePartial,
      onRefresh: () => {
        void reload(filter, closedPages);
      },
      onFilter: (next) => {
        setFilter(next);
        setClosedPages(1);
        setOpened([]);
        setClosed([]);
        void reload(next, 1);
      },
      onDueDate: (issue2, value) => {
        void save("dueDate", issue2, value);
      },
      onRisk: (issue2, risk) => {
        void save("risk", issue2, risk);
      },
      onMove: (issue2, state) => {
        void save("state", issue2, state);
      },
      onRetry: (issue2) => {
        const card = [...opened, ...closed].find((item) => issueKey(item.issue) === issueKey(issue2));
        if (card?.error === void 0) return;
        void save(card.error.field, card.issue, card.error.attempted);
      },
      onLoadClosed: () => {
        const pages = closedPages + 1;
        setClosedPages(pages);
        void reload(filter, pages);
      },
      onConnect: (input) => {
        void (async () => {
          try {
            const view = await remote.saveConfig(input, connection2?.tokenConfigured === true);
            setConnection(view);
            setConnectError(null);
            setFailed(!view.configured);
          } catch (error) {
            setConnectError(messageOf(error));
          }
        })();
      },
      onClearToken: () => {
        void (async () => {
          await remote.clearToken();
          setConnection((current) => current === null ? current : { ...current, configured: false, tokenConfigured: false, tokenMasked: null });
        })();
      }
    }
  );
}
function messageOf(error) {
  return error instanceof Error ? error.message : "\u65E0\u6CD5\u8FDE\u63A5 GitLab";
}
return module.exports; } });
