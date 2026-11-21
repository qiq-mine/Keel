import { HarnessError } from '@deepseek-ai/dsh-llm';
import { KEEL_MESSAGES } from './messages.js';
export const KEEL_CODES = [
    'keel/gitlab-unavailable',
    'keel/unauthorized',
    'keel/forbidden',
    'keel/not-found',
    'keel/rate-limited',
    'keel/not-configured',
    'keel/outside-group',
    'keel/labels-missing',
    'keel/invalid-input',
    'keel/gitlab-tls',
    'keel/session-unavailable',
    'keel/wecom-not-configured',
    'keel/wecom-unavailable',
    'keel/wecom-unauthorized',
    'keel/wecom-forbidden',
    'keel/wecom-ambiguous-doc',
    'keel/wecom-docid-unreadable',
    'keel/wecom-doc-index',
    'keel/wecom-rejected',
    'keel/report-stale',
];
export { CLOSED_CAP_MESSAGE, CLOSED_PAGE_MESSAGE, GITLAB_DOWN_MESSAGE, KEEL_MESSAGES, LABEL_CAP_MESSAGE, MEMBER_CAP_MESSAGE, OPENED_CAP_MESSAGE, OVERDUE_PARTIAL_MESSAGE, PROJECT_CAP_MESSAGE, REDIRECT_MESSAGE, } from './messages.js';
export class KeelError extends HarnessError {
    code;
    constructor(code, message = KEEL_MESSAGES[code]) {
        super(message, code);
        this.name = 'KeelError';
        this.code = code;
    }
}
export function keelError(code, message) {
    return new KeelError(code, message);
}
