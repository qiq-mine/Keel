import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as KeelConfig } from './config.js'
import { KeelService } from './service.js'
import { bindPreExecute, registerKeelTools } from './tools.js'
import { armSchedule } from './report/schedule.js'

export const name = 'keel'
export const inject = ['tools', 'credentials', 'agents']
export { Config }

export function apply(ctx: Context, config: KeelConfig): void {
  const service = new KeelService(ctx, config)
  ctx.effect(() => {
    const disposeTools = registerKeelTools(ctx, () => service.operationContext())
    const disposeGate = bindPreExecute(ctx)
    const disposeSchedule = armSchedule(service.operationContext())
    return () => {
      disposeTools()
      disposeGate()
      disposeSchedule()
    }
  })
}
