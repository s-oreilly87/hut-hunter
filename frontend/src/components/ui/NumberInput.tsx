import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Stepper-style numeric input that matches the app's input design language.
 *
 * Renders as  [ − | value | + ]  with custom buttons instead of native
 * browser spinners (which can't be styled cross-browser consistently).
 *
 * - min / max clamp both button steps and committed typed values.
 * - Arrow-up / Arrow-down keys work while the input is focused.
 * - The user can type freely; the value is clamped on blur.
 * - The − button is dimmed (but not disabled at the DOM level) when at min,
 *   and likewise for + at max, so the user still gets hover feedback.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // While the user is typing we keep a local draft; we only commit on blur.
  const [draft, setDraft] = useState<string | null>(null)
  const displayed = draft ?? value

  const parsed = parseInt(value, 10)
  const current = Number.isFinite(parsed) ? parsed : null

  const clamp = (n: number): number => {
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    return n
  }

  const step = (delta: number) => {
    // If there's no valid current value, snap to the nearer bound.
    const base = current ?? (delta > 0 ? (min ?? 1) - 1 : (max ?? 1) + 1)
    onChange(String(clamp(base + delta)))
  }

  const commitDraft = () => {
    if (draft === null) return
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) {
      onChange(String(clamp(n)))
    } else if (draft === '') {
      // Let the parent decide what an empty value means; don't force a number.
      onChange('')
    } else {
      // Non-numeric garbage: revert to last valid value.
      onChange(value)
    }
    setDraft(null)
  }

  const atMin = min !== undefined && current !== null && current <= min
  const atMax = max !== undefined && current !== null && current >= max

  return (
    <div
      className={cn(
        'flex h-9 w-full items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    >
      {/* Decrement */}
      <button
        type="button"
        aria-label="Decrease"
        tabIndex={-1}
        className={cn(
          'flex h-full items-center justify-center px-2.5 text-muted-foreground transition-colors hover:text-foreground',
          atMin && 'opacity-30',
        )}
        onClick={() => step(-1)}
      >
        <Minus className="size-3.5" />
      </button>

      {/* Divider */}
      <div className="h-4 w-px shrink-0 bg-border/70" />

      {/* Value input */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={displayed}
        aria-label="Value"
        className="min-w-0 flex-1 bg-transparent text-center text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        onChange={(e) => {
          // Strip anything that isn't a digit (allow leading minus only if min < 0).
          const raw = e.target.value.replace(min !== undefined && min < 0 ? /[^\d-]/g : /[^\d]/g, '')
          setDraft(raw)
        }}
        onFocus={() => setDraft(value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commitDraft(); inputRef.current?.blur() }
          if (e.key === 'ArrowUp')   { e.preventDefault(); step(1) }
          if (e.key === 'ArrowDown') { e.preventDefault(); step(-1) }
        }}
      />

      {/* Divider */}
      <div className="h-4 w-px shrink-0 bg-border/70" />

      {/* Increment */}
      <button
        type="button"
        aria-label="Increase"
        tabIndex={-1}
        className={cn(
          'flex h-full items-center justify-center px-2.5 text-muted-foreground transition-colors hover:text-foreground',
          atMax && 'opacity-30',
        )}
        onClick={() => step(1)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
