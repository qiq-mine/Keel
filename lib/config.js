import Schema from '@deepseek-ai/schemastery';
import { keelError } from './errors.js';
export function normalizeBaseUrl(value) {
    if (value === '')
        return '';
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw keelError('keel/invalid-input');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw keelError('keel/invalid-input');
    if (url.username !== '' || url.password !== '')
        throw keelError('keel/invalid-input');
    if (url.search !== '' || url.hash !== '')
        throw keelError('keel/invalid-input');
    if (url.pathname !== '' && url.pathname !== '/')
        throw keelError('keel/invalid-input');
    if (url.host === '')
        throw keelError('keel/invalid-input');
    return `${url.protocol}//${url.host}`;
}
export function normalizeGroupPath(value) {
    if (value === '')
        return '';
    if (value.includes('://') || value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
        throw keelError('keel/invalid-input');
    }
    if (/\s/.test(value) || value.includes('?') || value.includes('#'))
        throw keelError('keel/invalid-input');
    return value;
}
export function normalizeTokenRef(value) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
        throw keelError('keel/invalid-input');
    return value;
}
export function normalizeWecomCorpId(value) {
    if (value === '')
        return '';
    if (!/^[A-Za-z0-9-]{1,64}$/.test(value))
        throw keelError('keel/invalid-input');
    return value;
}
export function normalizeWecomLocator(value) {
    if (value === '')
        return '';
    if (value.length > 128 || /\s/.test(value))
        throw keelError('keel/invalid-input');
    return value;
}
function volatileString(fallback, normalize) {
    return Schema.transform(Schema.string(), (value) => normalize(value ?? fallback)).default(fallback).volatile();
}
export const Config = Schema.object({
    baseUrl: volatileString('', normalizeBaseUrl).description('GitLab 源站，例如 https://gitlab.example.com。只填源站，不带路径。'),
    groupPath: volatileString('', normalizeGroupPath).description('GitLab 组路径，例如 acme/platform。只填路径，不填整段网址。'),
    tokenRef: volatileString('KEEL_GITLAB_TOKEN', normalizeTokenRef).description('DSH 凭据引用名。这里保存引用，不保存令牌。'),
    allowSelfSigned: Schema.boolean().default(false).volatile().description('只放宽这个 GitLab 源站的证书信任库校验，主机名仍然要匹配。'),
    wecomCorpId: volatileString('', normalizeWecomCorpId).description('企业微信企业 ID。留空表示不启用周报。'),
    wecomSecretRef: volatileString('KEEL_WECOM_SECRET', normalizeTokenRef).description('企业微信应用 Secret 的凭据引用名。'),
    wecomSpaceId: volatileString('', normalizeWecomLocator).description('企业微信文档空间 spaceid。'),
    wecomFatherId: volatileString('', normalizeWecomLocator).description('存放项目文档的目录 fileid。放在空间根上时与 spaceid 相同。'),
});
export function readConnection(config) {
    return {
        baseUrl: normalizeBaseUrl(config.baseUrl.get()),
        groupPath: normalizeGroupPath(config.groupPath.get()),
        tokenRef: normalizeTokenRef(config.tokenRef.get()),
        allowSelfSigned: config.allowSelfSigned.get(),
        wecomCorpId: normalizeWecomCorpId(config.wecomCorpId.get()),
        wecomSecretRef: normalizeTokenRef(config.wecomSecretRef.get()),
        wecomSpaceId: normalizeWecomLocator(config.wecomSpaceId.get()),
        wecomFatherId: normalizeWecomLocator(config.wecomFatherId.get()),
    };
}
export function assertConfigured(connection) {
    if (connection.baseUrl === '' || connection.groupPath === '')
        throw keelError('keel/not-configured');
}
