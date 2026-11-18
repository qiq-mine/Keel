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
async function errcodeOf(res) {
    try {
        const data = await res.json();
        if (typeof data === 'object' && data !== null) {
            const errcode = data.errcode;
            if (typeof errcode === 'number' && errcode !== 0)
                return errcode;
        }
    }
    catch {
        // 非 JSON 响应：没有 errcode
    }
    return null;
}
function mapErrcode(errcode) {
    if (errcode === 40014 || errcode === 42001 || errcode === 41001)
        return keelError('keel/wecom-unauthorized');
    if ([60011, 60020, 48002, 301002, 640014].includes(errcode))
        return keelError('keel/wecom-forbidden');
    if (errcode === 45009 || errcode === -1)
        return keelError('keel/wecom-unavailable');
    return keelError('keel/wecom-rejected', `企业微信拒绝了这次写入（errcode ${errcode}）`);
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
        let netRetried = false;
        let rateRetried = false;
        while (true) {
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
                if (!netRetried) {
                    netRetried = true;
                    await this.sleepFn(1000);
                    continue;
                }
                throw keelError('keel/wecom-unavailable');
            }
            finally {
                clearTimeout(timeoutId);
            }
            if (res.status < 200 || res.status >= 300) {
                const errcode = await errcodeOf(res);
                this.logFn(`GET ${path} ${res.status} errcode=${errcode ?? '-'}`);
                if (errcode === 45009) {
                    if (!rateRetried) {
                        rateRetried = true;
                        await this.sleepFn(1000);
                        continue;
                    }
                    throw keelError('keel/wecom-unavailable');
                }
                if (errcode === -1) {
                    throw keelError('keel/wecom-unavailable');
                }
                if (errcode !== null)
                    throw keelError('keel/wecom-unauthorized');
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
                if (!rateRetried) {
                    rateRetried = true;
                    await this.sleepFn(1000);
                    continue;
                }
                throw keelError('keel/wecom-unavailable');
            }
            if (errcode === -1) {
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
        let netRetried = false;
        let rateRetried = false;
        while (true) {
            const accessToken = await this.token(signal);
            let responseData;
            let responseErrcode = 0;
            while (true) {
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
                    if (isRetryable && !netRetried) {
                        netRetried = true;
                        await this.sleepFn(1000);
                        continue;
                    }
                    throw keelError('keel/wecom-unavailable');
                }
                finally {
                    clearTimeout(timeoutId);
                }
                let data;
                let errcode;
                if (res.status < 200 || res.status >= 300) {
                    // 非 2xx：只有带非 0 errcode 时才按 errcode 处理（含 40014 重取和 45009 重试），否则视为不可用
                    const code = await errcodeOf(res);
                    this.logFn(`POST ${path} ${res.status} errcode=${code ?? '-'}`);
                    if (code === null)
                        throw keelError('keel/wecom-unavailable');
                    data = null;
                    errcode = code;
                }
                else {
                    try {
                        data = await res.json();
                    }
                    catch {
                        this.logFn(`POST ${path} ${res.status} errcode=-`);
                        throw keelError('keel/wecom-unavailable');
                    }
                    const payload = typeof data === 'object' && data !== null ? data : null;
                    errcode = typeof payload?.errcode === 'number' ? payload.errcode : 0;
                    this.logFn(`POST ${path} ${res.status} errcode=${errcode}`);
                }
                if (errcode === 45009) {
                    if (isRetryable && !rateRetried) {
                        rateRetried = true;
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
            throw mapErrcode(responseErrcode);
        }
    }
}
