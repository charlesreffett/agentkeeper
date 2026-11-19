import { describe, expectTypeOf, it } from 'vitest'
import type { PluginRendererApi, PluginRendererTheme, PluginWorkItemSession } from './index'

describe('PluginRendererApi', () => {
  it('types theme access', () => {
    expectTypeOf<ReturnType<PluginRendererApi['getTheme']>>().toEqualTypeOf<PluginRendererTheme>()
    expectTypeOf<Parameters<PluginRendererApi['onThemeChanged']>[0]>().toEqualTypeOf<(theme: PluginRendererTheme) => void>()
    expectTypeOf<PluginRendererTheme['variant']>().toEqualTypeOf<'light' | 'dark'>()
  })

  it('returns unsubscribe functions from listeners', () => {
    expectTypeOf<ReturnType<PluginRendererApi['onRouteChanged']>>().toEqualTypeOf<() => void>()
    expectTypeOf<ReturnType<PluginRendererApi['onThemeChanged']>>().toEqualTypeOf<() => void>()
  })

  it('types invoke results and session history', () => {
    expectTypeOf<PluginRendererApi['invoke']>().returns.toEqualTypeOf<Promise<unknown>>()
    expectTypeOf<ReturnType<PluginRendererApi['getWorkItemSessions']>>().toEqualTypeOf<Promise<PluginWorkItemSession[]>>()
  })
})
