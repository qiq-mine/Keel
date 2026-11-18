export function assigneeInitials(name, username) {
    const trimmed = name.trim();
    if (trimmed !== '') {
        const han = trimmed.match(/\p{Script=Han}/u);
        if (han?.[0] !== undefined)
            return han[0];
        const words = trimmed.split(/\s+/).filter(word => word !== '');
        const first = words[0] ?? '';
        const second = words[1];
        if (second !== undefined)
            return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
        return first.slice(0, 2).toUpperCase();
    }
    return username.slice(0, 2);
}
export function formatShanghai(iso, kind) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return iso;
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: kind === 'full' ? '2-digit' : undefined,
        hourCycle: 'h23',
    }).formatToParts(date);
    const pick = (type) => parts.find(part => part.type === type)?.value ?? '';
    if (kind === 'short')
        return `${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
    return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}
export function formatLocalTimestamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
