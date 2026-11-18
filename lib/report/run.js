import { docName, docHeader, listDocsByName, createDoc, resolveDocid, readDoc, replaceSection } from '../wecom/docs.js';
import { isLastFriday, monthTitle } from './clock.js';
import { comparableText } from './render.js';
import { parseWeeks, renderMonthly } from './monthly.js';
import { KeelError, keelError, KEEL_MESSAGES } from '../errors.js';
function errorMessage(err) {
    if (err instanceof KeelError) {
        return err.message;
    }
    return KEEL_MESSAGES['keel/wecom-unavailable'];
}
export async function writeProject(http, input) {
    let docUrl = null;
    let weekly;
    let docid;
    let policy;
    try {
        const name = docName(input.projectPath);
        const matches = await listDocsByName(http, input.target, name);
        if (matches.length > 1) {
            throw keelError('keel/wecom-ambiguous-doc');
        }
        let file;
        let created = false;
        if (matches.length === 1) {
            file = matches[0];
            created = false;
        }
        else {
            const c = await createDoc(http, input.target, name);
            file = { fileid: c.docid, url: c.url };
            created = true;
        }
        docid = await resolveDocid(http, file);
        docUrl = file.url === '' || !file.url ? null : file.url;
        policy = input.kind === 'catch-up' ? 'if-missing' : 'if-different';
        const text = created ? docHeader(input.projectPath) + input.sectionText : input.sectionText;
        weekly = await replaceSection(http, docid, input.weekTitle, text, policy, (a, b) => comparableText(a) === comparableText(b));
    }
    catch (err) {
        return {
            weekly: 'failed',
            monthly: 'failed',
            message: errorMessage(err),
            docUrl
        };
    }
    if (!isLastFriday(input.F)) {
        return {
            weekly,
            monthly: 'not-due',
            message: null,
            docUrl
        };
    }
    try {
        const month = input.F.slice(0, 7);
        const doc = await readDoc(http, docid);
        const monthText = renderMonthly(month, parseWeeks(doc.text, month));
        const monthly = await replaceSection(http, docid, monthTitle(input.F), monthText, policy, (a, b) => a.replace(/\n$/, '') === b.replace(/\n$/, ''));
        return {
            weekly,
            monthly,
            message: null,
            docUrl
        };
    }
    catch (err) {
        return {
            weekly,
            monthly: 'failed',
            message: errorMessage(err),
            docUrl
        };
    }
}
