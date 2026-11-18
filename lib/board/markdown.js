export function renderIssueMarkdown(source, baseUrl) {
    const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    let html = '';
    let cursor = 0;
    for (const match of source.matchAll(pattern)) {
        const index = match.index ?? 0;
        html += escapeHtml(source.slice(cursor, index)).replaceAll('\n', '<br>');
        html += renderImage(match[1] ?? '', match[2] ?? '', baseUrl);
        cursor = index + match[0].length;
    }
    html += escapeHtml(source.slice(cursor)).replaceAll('\n', '<br>');
    return html;
}
function renderImage(alt, rawUrl, baseUrl) {
    const safeAlt = escapeHtml(alt);
    if (rawUrl.startsWith('data:'))
        return safeAlt;
    let absolute;
    try {
        absolute = new URL(rawUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    }
    catch {
        return safeAlt;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:')
        return safeAlt;
    let origin = '';
    try {
        origin = new URL(baseUrl).origin;
    }
    catch {
        origin = '';
    }
    const sameHost = absolute.origin === origin || !/^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
    if (sameHost || rawUrl.startsWith('/')) {
        const href = escapeHtml(absolute.toString());
        return `<a href="${href}" target="_blank" rel="noopener">图片：${safeAlt || '图片'}（在 GitLab 中打开）</a>`;
    }
    const href = escapeHtml(absolute.toString());
    return `<img alt="${safeAlt}" src="${href}">`;
}
function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
