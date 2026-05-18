import { useCallback, useEffect, useState } from 'react'
import { type Theme, applyTheme, cycleTheme, getStoredTheme, storeTheme } from './theme'

export type { Theme }

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  // Apply and persist whenever theme changes
  useEffect(() => {
    applyTheme(theme)
    storeTheme(theme)
  }, [theme])

  // Re-apply when the OS preference changes while in system mode
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => { applyTheme('system') }
    mq.addEventListener('change', handler)
    return () => { mq.removeEventListener('change', handler) }
  }, [theme])

  const cycleNext = useCallback(() => {
    setThemeState((current) => cycleTheme(current))
  }, [])

  return { theme, cycleNext }
}
