export function createDebounce(wait, schedule) {
    let cancel = () => { };
    return (fn) => {
        cancel();
        cancel = schedule(fn, wait);
    };
}
export function shortcutAction(key, context) {
    if (key === 'Escape') {
        if (context.helpOpen || context.typing || context.drawer !== 'none')
            return { type: 'escape' };
        return { type: 'ignore' };
    }
    if (context.typing)
        return { type: 'ignore' };
    if (key === 'c')
        return { type: 'create' };
    if (key === '/')
        return { type: 'search' };
    if (key === '?')
        return { type: 'help' };
    if (key === 'ArrowUp')
        return { type: 'move-focus', direction: 'up' };
    if (key === 'ArrowDown')
        return { type: 'move-focus', direction: 'down' };
    if (key === 'ArrowLeft')
        return { type: 'move-focus', direction: 'left' };
    if (key === 'ArrowRight')
        return { type: 'move-focus', direction: 'right' };
    if (key === 'Enter' && context.hasCard)
        return { type: 'open' };
    if (context.drawer === 'create')
        return { type: 'ignore' };
    if (!context.hasCard && context.drawer !== 'issue')
        return { type: 'ignore' };
    if (key === '1')
        return { type: 'status', status: 'todo' };
    if (key === '2')
        return { type: 'status', status: 'doing' };
    if (key === '3')
        return { type: 'status', status: 'blocked' };
    if (key === '4')
        return { type: 'status', status: 'done' };
    return { type: 'ignore' };
}
