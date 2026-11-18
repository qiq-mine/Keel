import tls from 'node:tls';
/** GitLab HTTPS options. Self-signed mode still checks the certificate hostname. */
export function gitlabConnectOptions(allowSelfSigned) {
    if (!allowSelfSigned)
        return { rejectUnauthorized: true };
    return { rejectUnauthorized: false, checkServerIdentity: tls.checkServerIdentity };
}
/** Enterprise WeChat always uses the system trust store. It never reads allowSelfSigned. */
export function wecomConnectOptions() {
    return { rejectUnauthorized: true };
}
