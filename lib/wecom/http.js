import { keelError } from '../errors.js';
const WECOM_HOST = 'https://qyapi.weixin.qq.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const ALLOWED_PATHS = new Set([
    '/cgi-bin/gettoken',
    '/cgi-bin/wedrive/file_list',
    '/cgi-bin/wedoc/create_doc',
    '/cgi-bin/wedoc/document/get',
    '/cgi-bin/wedoc/document/batch_update',
]);
const RETRYABLE_PATHS = new Set([
    '/cgi-bin/gettoken',
    '/cgi-bin/wedrive/file_list',
    '/cgi-bin/wedoc/document/get',
]);
function sanitizeLog(line) {
    return line.replace(/(access_token|corpsecret|key)=([^& \s]+)/g, '$1=***');
}
export class WecomHttp {
    corpId;
    secret;
    fetchFn;
    logFn;
    sleepFn;
    nowFn;
    timeoutMs;
    cachedToken = null;
    constructor(options) {
        this.corpId = options.corpId;
        this.secret = options.secret;
        this.fetchFn = options.fetch ?? fetch;
        const log = options.log;
        this.logFn = log ? (line) => log(sanitizeLog(line)) : () => { };
        this.sleepFn = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
        this.nowFn = options.now ?? Date.now;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    async token(signal) {
        if (this.cachedToken && this.nowFn() < this.cachedToken.expiresAt - 120_000) {
            return this.cachedToken.token;
        }
        const path = '/cgi-bin/gettoken';
        const params = new URLSearchParams({
            corpid: this.corpId,
            corpsecret: this.secret,
        });
        const url = `${WECOM_HOST}${path}?${params.toString()}`;
        let attempt = 0;
        while (true) {
            attempt++;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
            const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            let res;
            try {
                res = await this.fetchFn(url, {
                    method: 'GET',
                    redirect: 'manual',
                    signal: combinedSignal,
                });
            }
            catch (error) {
                if (signal?.aborted)
                    throw error;
                this.logFn(`GET ${path} - errcode=-`);
                if (attempt === 1) {
                    await this.sleepFn(1000);
                    continue;
                }
                throw keelError('keel/wecom-unavailable');
            }
            finally {
                clearTimeout(timeoutId);
            }
            if (res.status < 200 || res.status >= 300) {
                this.logFn(`GET ${path} ${res.status} errcode=-`);
                throw keelError('keel/wecom-unavailable');
            }
            let data;
            try {
                data = await res.json();
            }
            catch {
                this.logFn(`GET ${path} ${res.status} errcode=-`);
                throw keelError('keel/wecom-unavailable');
            }
            const payload = typeof data === 'object' && data !== null ? data : null;
            const errcode = typeof payload?.errcode === 'number' ? payload.errcode : 0;
            this.logFn(`GET ${path} ${res.status} errcode=${errcode}`);
            if (errcode === 45009) {
                if (attempt === 1) {
                    await this.sleepFn(1000);
                    continue;
                }
                throw keelError('keel/wecom-unavailable');
            }
            if (errcode !== 0 || typeof payload?.access_token !== 'string' || !payload.access_token) {
                throw keelError('keel/wecom-unauthorized');
            }
            const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 7200;
            this.cachedToken = {
                token: payload.access_token,
                expiresAt: this.nowFn() + expiresIn * 1000,
            };
            return payload.access_token;
        }
    }
    async call(path, body, signal) {
        if (!ALLOWED_PATHS.has(path) || path === '/cgi-bin/gettoken') {
            throw keelError('keel/invalid-input');
        }
        const isRetryable = RETRYABLE_PATHS.has(path);
        let tokenRetried = false;
        while (true) {
            const accessToken = await this.token(signal);
            let reqAttempt = 0;
            let responseData;
            let responseErrcode = 0;
            while (true) {
                reqAttempt++;
                const params = new URLSearchParams({ access_token: accessToken });
                const url = `${WECOM_HOST}${path}?${params.toString()}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
                const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
                let res;
                try {
                    res = await this.fetchFn(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(body),
                        redirect: 'manual',
                        signal: combinedSignal,
                    });
                }
                catch (error) {
                    if (signal?.aborted)
                        throw error;
                    this.logFn(`POST ${path} - errcode=-`);
                    if (isRetryable && reqAttempt === 1) {
                        await this.sleepFn(1000);
                        continue;
                    }
                    throw keelError('keel/wecom-unavailable');
                }
                finally {
                    clearTimeout(timeoutId);
                }
                if (res.status < 200 || res.status >= 300) {
                    this.logFn(`POST ${path} ${res.status} errcode=-`);
                    throw keelError('keel/wecom-unavailable');
                }
                let data;
                try {
                    data = await res.json();
                }
                catch {
                    this.logFn(`POST ${path} ${res.status} errcode=-`);
                    throw keelError('keel/wecom-unavailable');
                }
                const payload = typeof data === 'object' && data !== null ? data : null;
                const errcode = typeof payload?.errcode === 'number' ? payload.errcode : 0;
                this.logFn(`POST ${path} ${res.status} errcode=${errcode}`);
                if (errcode === 45009) {
                    if (isRetryable && reqAttempt === 1) {
                        await this.sleepFn(1000);
                        continue;
                    }
                    throw keelError('keel/wecom-unavailable');
                }
                responseData = data;
                responseErrcode = errcode;
                break;
            }
            if (responseErrcode === 0) {
                return responseData;
            }
            if (responseErrcode === 40014 || responseErrcode === 42001) {
                if (!tokenRetried) {
                    tokenRetried = true;
                    this.cachedToken = null;
                    continue;
                }
                throw keelError('keel/wecom-unauthorized');
            }
            if (responseErrcode === 41001) {
                throw keelError('keel/wecom-unauthorized');
            }
            if ([60011, 60020, 48002, 301002, 640014].includes(responseErrcode)) {
                throw keelError('keel/wecom-forbidden');
            }
            if (responseErrcode === -1) {
                throw keelError('keel/wecom-unavailable');
            }
            throw keelError('keel/wecom-rejected', `企业微信拒绝了这次写入（errcode ${responseErrcode}）`);
        }
    }
}
