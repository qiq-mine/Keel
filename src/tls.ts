import tls from 'node:tls'

export interface TlsConnectOptions {
  rejectUnauthorized: boolean
  checkServerIdentity?: typeof tls.checkServerIdentity
}

/** GitLab HTTPS options. Self-signed mode still checks the certificate hostname. */
export function gitlabConnectOptions(allowSelfSigned: boolean): TlsConnectOptions {
  if (!allowSelfSigned) return { rejectUnauthorized: true }
  return { rejectUnauthorized: false, checkServerIdentity: tls.checkServerIdentity }
}

/** Enterprise WeChat always uses the system trust store. It never reads allowSelfSigned. */
export function wecomConnectOptions(): TlsConnectOptions {
  return { rejectUnauthorized: true }
}
