import { reportDeps } from '../operations.js';
import { writeReport } from './run.js';
import { catchUpTarget, nextScheduled } from './clock.js';
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const SIXTY_SECONDS_MS = 60 * 1000;
export function armSchedule(ctx, options) {
    const now = options?.now ?? (() => Date.now());
    const setTimer = options?.setTimeout ?? setTimeout;
    const clearTimer = options?.clearTimeout ?? clearTimeout;
    const maxSleep = options?.maxSleepMs ?? ONE_HOUR_MS;
    let disposed = false;
    let activeTimerId = undefined;
    // 1. Startup catch-up check
    const startupNow = now();
    const catchUpAt = catchUpTarget(startupNow);
    if (catchUpAt !== null && ctx.jobs) {
        ctx.jobs.start(onProgress => writeReport({ ...reportDeps(ctx), onProgress }, 'catch-up', catchUpAt).then(result => ({ result })));
    }
    // 2. Schedule loop
    function scheduleNext() {
        if (disposed)
            return;
        const current = now();
        const target = nextScheduled(current);
        const remaining = target - current;
        const sleep = Math.max(0, Math.min(remaining, maxSleep));
        activeTimerId = setTimer(() => {
            activeTimerId = undefined;
            if (disposed)
                return;
            onWake(target);
        }, sleep);
    }
    function onWake(target) {
        if (disposed)
            return;
        const current = now();
        // If woken up before target, continue sleeping
        if (current < target) {
            scheduleNext();
            return;
        }
        const diff = current - target;
        if (diff <= SIXTY_SECONDS_MS) {
            // Within 60 seconds: run scheduled
            if (ctx.jobs) {
                ctx.jobs.start(onProgress => writeReport({ ...reportDeps(ctx), onProgress }, 'scheduled', target).then(result => ({ result })));
            }
        }
        else {
            // Over 60 seconds: run catch-up if still in catch-up window
            const catchUpAt = catchUpTarget(current);
            if (catchUpAt !== null && ctx.jobs) {
                ctx.jobs.start(onProgress => writeReport({ ...reportDeps(ctx), onProgress }, 'catch-up', catchUpAt).then(result => ({ result })));
            }
        }
        scheduleNext();
    }
    scheduleNext();
    return () => {
        disposed = true;
        if (activeTimerId !== undefined) {
            clearTimer(activeTimerId);
            activeTimerId = undefined;
        }
    };
}
