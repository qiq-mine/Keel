import { createHash } from 'node:crypto';
import { keelError, KeelError } from '../errors.js';
export function docName(pathWithNamespace) {
    const replaced = pathWithNamespace.replaceAll('/', ' - ');
    const codePoints = [...replaced];
    if (codePoints.length <= 255) {
        return replaced;
    }
    const hash = createHash('sha256')
        .update(pathWithNamespace, 'utf8')
        .digest('hex')
        .slice(0, 14)
        .toLowerCase();
    return codePoints.slice(0, 240).join('') + '-' + hash;
}
export function docidFromUrl(url) {
    const base = url.split(/[?#]/)[0];
    const marker = '/doc/';
    const idx = base.indexOf(marker);
    if (idx === -1) {
        return null;
    }
    const rest = base.slice(idx + marker.length);
    let endIdx = rest.length;
    for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === '?' || ch === '#' || ch === '/') {
            endIdx = i;
            break;
        }
    }
    const segment = rest.slice(0, endIdx);
    return segment.length > 0 ? segment : null;
}
export function joinText(nodes) {
    if (nodes.length === 0) {
        return { text: '', offset: 0 };
    }
    let text = '';
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.end - node.begin !== node.text.length) {
            throw keelError('keel/wecom-doc-index');
        }
        if (i > 0 && node.begin !== nodes[i - 1].end) {
            throw keelError('keel/wecom-doc-index');
        }
        text += node.text;
    }
    return { text, offset: nodes[0].begin };
}
const WEEKLY_SECTION_RE = /^周报 \d{4}-\d{2}-\d{2}$/;
const MONTHLY_SECTION_RE = /^月报 \d{4}-\d{2}$/;
export function sectionRange(text, title) {
    const lines = text.split('\n');
    const lineIndices = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        lineIndices.push(offset);
        offset += lines[i].length + 1;
    }
    let titleIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === title) {
            titleIndex = i;
            break;
        }
    }
    if (titleIndex === -1) {
        return null;
    }
    const begin = lineIndices[titleIndex];
    let end = text.length;
    for (let i = titleIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (WEEKLY_SECTION_RE.test(line) || MONTHLY_SECTION_RE.test(line)) {
            end = lineIndices[i];
            break;
        }
    }
    return { begin, end };
}
export function docHeader(pathWithNamespace) {
    return 'Keel 周报\n' + pathWithNamespace + '\n';
}
export async function listDocsByName(http, target, name) {
    let start = 0;
    const results = [];
    let page = 1;
    while (page <= 20) {
        const res = await http.call('/cgi-bin/wedrive/file_list', {
            spaceid: target.spaceid,
            fatherid: target.fatherid,
            sort_type: 1,
            start,
            limit: 1000
        });
        const items = res.file_list?.item ?? [];
        for (const item of items) {
            if (item.file_status === 1 && item.file_type === 3 && item.file_name === name) {
                results.push({ fileid: item.fileid, url: item.url ?? '' });
            }
        }
        if (!res.has_more) {
            return results;
        }
        if (page === 20) {
            throw keelError('keel/wecom-ambiguous-doc');
        }
        start = typeof res.next_start === 'number' ? res.next_start : start + 1000;
        page++;
    }
    return results;
}
export async function createDoc(http, target, name) {
    try {
        const res = await http.call('/cgi-bin/wedoc/create_doc', {
            spaceid: target.spaceid,
            fatherid: target.fatherid,
            doc_type: 3,
            doc_name: name
        });
        return { docid: res.docid, url: res.url };
    }
    catch (err) {
        if (err instanceof KeelError && err.code === 'keel/wecom-unavailable') {
            const matches = await listDocsByName(http, target, name);
            if (matches.length === 1) {
                return { docid: matches[0].fileid, url: matches[0].url };
            }
            if (matches.length === 0) {
                throw err;
            }
            throw keelError('keel/wecom-ambiguous-doc');
        }
        throw err;
    }
}
export async function resolveDocid(http, file) {
    try {
        await http.call('/cgi-bin/wedoc/document/get', { docid: file.fileid });
        return file.fileid;
    }
    catch (err) {
        if (!(err instanceof KeelError &&
            (err.code === 'keel/wecom-rejected' || err.code === 'keel/wecom-forbidden'))) {
            throw err;
        }
    }
    const urlDocid = docidFromUrl(file.url);
    if (urlDocid !== null) {
        try {
            await http.call('/cgi-bin/wedoc/document/get', { docid: urlDocid });
            return urlDocid;
        }
        catch (err) {
            if (!(err instanceof KeelError &&
                (err.code === 'keel/wecom-rejected' || err.code === 'keel/wecom-forbidden'))) {
                throw err;
            }
        }
    }
    throw keelError('keel/wecom-docid-unreadable');
}
function isTextNode(val) {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        return false;
    }
    const obj = val;
    return (typeof obj.begin === 'number' &&
        typeof obj.end === 'number' &&
        typeof obj.text === 'string');
}
function collectTextNodes(root) {
    const nodes = [];
    function walk(val) {
        if (typeof val !== 'object' || val === null) {
            return;
        }
        if (isTextNode(val)) {
            nodes.push(val);
            return;
        }
        if (Array.isArray(val)) {
            for (const item of val) {
                walk(item);
            }
            return;
        }
        for (const key of Object.keys(val)) {
            walk(val[key]);
        }
    }
    walk(root);
    return nodes;
}
export async function readDoc(http, docid) {
    const res = await http.call('/cgi-bin/wedoc/document/get', { docid });
    const nodes = collectTextNodes(res.document);
    const { text, offset } = joinText(nodes);
    return { version: res.version, text, offset };
}
export async function replaceSection(http, docid, title, sectionText, policy, same = (a, b) => a === b) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const doc = await readDoc(http, docid);
        const range = sectionRange(doc.text, title);
        if (range !== null) {
            if (policy === 'if-missing') {
                return 'skipped';
            }
            if (same(doc.text.slice(range.begin, range.end), sectionText)) {
                return 'skipped';
            }
        }
        let requests;
        if (range !== null) {
            requests = [
                {
                    delete_content: {
                        range: {
                            start_index: doc.offset + range.begin,
                            length: range.end - range.begin
                        }
                    }
                },
                {
                    insert_text: {
                        text: sectionText,
                        location: {
                            index: doc.offset + range.begin
                        }
                    }
                }
            ];
        }
        else {
            let textToInsert = sectionText;
            if (doc.text.length > 0 && !doc.text.endsWith('\n')) {
                textToInsert = '\n' + sectionText;
            }
            requests = [
                {
                    insert_text: {
                        text: textToInsert,
                        location: {
                            index: doc.offset + doc.text.length
                        }
                    }
                }
            ];
        }
        try {
            await http.call('/cgi-bin/wedoc/document/batch_update', {
                docid,
                version: doc.version,
                requests
            });
            return 'written';
        }
        catch (err) {
            if (attempt === 1) {
                throw err;
            }
        }
    }
    return 'written';
}
