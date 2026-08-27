import type { ComputedRef } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

export function useSettingsLeavePrompt(isDirty: ComputedRef<boolean>, save: () => Promise<void>) {
  onBeforeRouteLeave(async () => {
    if (!isDirty.value) return true
    const shouldSave = window.confirm(
      'Save your changes before leaving?\n\nChoose OK to save or Cancel to discard.',
    )
    if (shouldSave) await save()
    return true
  })
}
