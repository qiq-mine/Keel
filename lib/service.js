var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { KeelError } from './errors.js';
import * as ops from './operations.js';
import { ReportJobs } from './report/run.js';
import { WecomClients } from './wecom/http.js';
let KeelService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _connection_decorators;
    let _setToken_decorators;
    let _clearToken_decorators;
    let _listMembers_decorators;
    let _listLabels_decorators;
    let _listProjects_decorators;
    let _listIssues_decorators;
    let _setDueDate_decorators;
    let _setRisk_decorators;
    let _setState_decorators;
    let _setStatus_decorators;
    let _createIssue_decorators;
    let _columnModes_decorators;
    let _summary_decorators;
    let _getIssue_decorators;
    let _listNotes_decorators;
    let _setWecomSecret_decorators;
    let _clearWecomSecret_decorators;
    let _analyzeIssue_decorators;
    let _reportStart_decorators;
    let _reportStatus_decorators;
    return class KeelService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _connection_decorators = [Remote];
            _setToken_decorators = [Remote];
            _clearToken_decorators = [Remote];
            _listMembers_decorators = [Remote];
            _listLabels_decorators = [Remote];
            _listProjects_decorators = [Remote];
            _listIssues_decorators = [Remote];
            _setDueDate_decorators = [Remote];
            _setRisk_decorators = [Remote];
            _setState_decorators = [Remote];
            _setStatus_decorators = [Remote];
            _createIssue_decorators = [Remote];
            _columnModes_decorators = [Remote];
            _summary_decorators = [Remote];
            _getIssue_decorators = [Remote];
            _listNotes_decorators = [Remote];
            _setWecomSecret_decorators = [Remote];
            _clearWecomSecret_decorators = [Remote];
            _analyzeIssue_decorators = [Remote];
            _reportStart_decorators = [Remote];
            _reportStatus_decorators = [Remote];
            __esDecorate(this, null, _connection_decorators, { kind: "method", name: "connection", static: false, private: false, access: { has: obj => "connection" in obj, get: obj => obj.connection }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setToken_decorators, { kind: "method", name: "setToken", static: false, private: false, access: { has: obj => "setToken" in obj, get: obj => obj.setToken }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _clearToken_decorators, { kind: "method", name: "clearToken", static: false, private: false, access: { has: obj => "clearToken" in obj, get: obj => obj.clearToken }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listMembers_decorators, { kind: "method", name: "listMembers", static: false, private: false, access: { has: obj => "listMembers" in obj, get: obj => obj.listMembers }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listLabels_decorators, { kind: "method", name: "listLabels", static: false, private: false, access: { has: obj => "listLabels" in obj, get: obj => obj.listLabels }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listProjects_decorators, { kind: "method", name: "listProjects", static: false, private: false, access: { has: obj => "listProjects" in obj, get: obj => obj.listProjects }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listIssues_decorators, { kind: "method", name: "listIssues", static: false, private: false, access: { has: obj => "listIssues" in obj, get: obj => obj.listIssues }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setDueDate_decorators, { kind: "method", name: "setDueDate", static: false, private: false, access: { has: obj => "setDueDate" in obj, get: obj => obj.setDueDate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setRisk_decorators, { kind: "method", name: "setRisk", static: false, private: false, access: { has: obj => "setRisk" in obj, get: obj => obj.setRisk }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setState_decorators, { kind: "method", name: "setState", static: false, private: false, access: { has: obj => "setState" in obj, get: obj => obj.setState }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setStatus_decorators, { kind: "method", name: "setStatus", static: false, private: false, access: { has: obj => "setStatus" in obj, get: obj => obj.setStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _createIssue_decorators, { kind: "method", name: "createIssue", static: false, private: false, access: { has: obj => "createIssue" in obj, get: obj => obj.createIssue }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _columnModes_decorators, { kind: "method", name: "columnModes", static: false, private: false, access: { has: obj => "columnModes" in obj, get: obj => obj.columnModes }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _summary_decorators, { kind: "method", name: "summary", static: false, private: false, access: { has: obj => "summary" in obj, get: obj => obj.summary }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getIssue_decorators, { kind: "method", name: "getIssue", static: false, private: false, access: { has: obj => "getIssue" in obj, get: obj => obj.getIssue }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listNotes_decorators, { kind: "method", name: "listNotes", static: false, private: false, access: { has: obj => "listNotes" in obj, get: obj => obj.listNotes }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setWecomSecret_decorators, { kind: "method", name: "setWecomSecret", static: false, private: false, access: { has: obj => "setWecomSecret" in obj, get: obj => obj.setWecomSecret }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _clearWecomSecret_decorators, { kind: "method", name: "clearWecomSecret", static: false, private: false, access: { has: obj => "clearWecomSecret" in obj, get: obj => obj.clearWecomSecret }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _analyzeIssue_decorators, { kind: "method", name: "analyzeIssue", static: false, private: false, access: { has: obj => "analyzeIssue" in obj, get: obj => obj.analyzeIssue }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _reportStart_decorators, { kind: "method", name: "reportStart", static: false, private: false, access: { has: obj => "reportStart" in obj, get: obj => obj.reportStart }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _reportStatus_decorators, { kind: "method", name: "reportStatus", static: false, private: false, access: { has: obj => "reportStatus" in obj, get: obj => obj.reportStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        jobs = new ReportJobs();
        wecomClients = new WecomClients();
        constructor(ctx, config) {
            super(ctx, 'keel');
            this.config = config;
        }
        connection(signal) {
            return this.run(signal, ctx => ops.connection(ctx, signal));
        }
        setToken(value, signal) {
            return this.run(signal, ctx => ops.setToken(ctx, value));
        }
        clearToken(signal) {
            return this.run(signal, ctx => ops.clearToken(ctx));
        }
        listMembers(signal) {
            return this.run(signal, ctx => ops.listMembers(ctx, signal));
        }
        listLabels(signal) {
            return this.run(signal, ctx => ops.listLabels(ctx, signal));
        }
        listProjects(signal) {
            return this.run(signal, ctx => ops.listProjects(ctx, signal));
        }
        listIssues(query, signal) {
            return this.run(signal, ctx => ops.listIssues(ctx, query, signal));
        }
        setDueDate(projectId, iid, dueDate, signal) {
            return this.run(signal, ctx => ops.setDueDate(ctx, projectId, iid, dueDate, signal));
        }
        setRisk(projectId, iid, risk, signal) {
            return this.run(signal, ctx => ops.setRisk(ctx, projectId, iid, risk, signal));
        }
        setState(projectId, iid, state, signal) {
            return this.run(signal, ctx => ops.setState(ctx, projectId, iid, state, signal));
        }
        setStatus(projectId, iid, status, signal) {
            return this.run(signal, ctx => ops.setStatus(ctx, projectId, iid, status, signal));
        }
        createIssue(input, signal) {
            return this.run(signal, ctx => ops.createIssue(ctx, input, signal));
        }
        columnModes(projectId, signal) {
            return this.run(signal, ctx => ops.columnModes(ctx, projectId === 0 ? undefined : projectId, signal));
        }
        summary(query, signal) {
            return this.run(signal, ctx => ops.summary(ctx, query, signal));
        }
        getIssue(projectId, iid, signal) {
            return this.run(signal, ctx => ops.getIssue(ctx, projectId, iid, signal));
        }
        listNotes(projectId, iid, page, signal) {
            return this.run(signal, ctx => ops.listNotes(ctx, projectId, iid, page, signal));
        }
        setWecomSecret(value, signal) {
            return this.run(signal, ctx => ops.setWecomSecret(ctx, value));
        }
        clearWecomSecret(signal) {
            return this.run(signal, ctx => ops.clearWecomSecret(ctx));
        }
        analyzeIssue(projectId, iid, sessionId, agentPreset, signal) {
            return this.run(signal, ctx => ops.analyzeIssue(ctx, { projectId, iid, sessionId, agentPreset }, signal));
        }
        reportStart(mode, asOf, signal) {
            return this.run(signal, ctx => ops.reportStart(ctx, mode, asOf));
        }
        reportStatus(runId, signal) {
            return this.run(signal, async (ctx) => ops.reportStatus(ctx, runId));
        }
        async run(signal, action) {
            signal.throwIfAborted();
            try {
                return await action(this.context());
            }
            catch (error) {
                if (error instanceof KeelError) {
                    throw new RemoteError(error.code, error.message, {});
                }
                throw error;
            }
        }
        operationContext() {
            return this.context();
        }
        context() {
            const credentials = this.ctx.credentials;
            const log = (line) => this.ctx.logger.info(line);
            return {
                config: this.config,
                log,
                agents: this.ctx.agents,
                resolve: async (ref) => (await credentials.resolve(credentialRef(ref)))?.value,
                describe: async (ref) => {
                    const info = await credentials.describe(credentialRef(ref));
                    const preview = info.masked;
                    return { configured: info.configured, masked: typeof preview === 'string' ? preview : undefined };
                },
                set: (ref, value) => credentials.set(credentialRef(ref), value),
                unset: ref => credentials.unset(credentialRef(ref)),
                jobs: this.jobs,
                wecomClients: this.wecomClients,
            };
        }
    };
})();
export { KeelService };
