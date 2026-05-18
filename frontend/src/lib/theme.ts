export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'hut-hunter-theme'

const CYCLE: Theme[] = ['system', 'light', 'dark']

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage unavailable
  }
  return 'system'
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // localStorage unavailable
  }
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark')
}

export function cycleTheme(current: Theme): Theme {
  return CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
}
