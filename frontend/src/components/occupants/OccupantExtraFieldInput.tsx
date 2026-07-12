import type { ParamField } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { cn } from '@/lib/utils'

export function OccupantExtraFieldInput({
  field,
  value,
  onChange,
  className,
}: {
  field: ParamField
  value: unknown
  onChange: (value: string | number) => void
  className?: string
}) {
  if (field.type === 'select') {
    return (
      <Select value={String(value ?? '')} onValueChange={onChange}>
        <SelectTrigger className={cn(className)}>
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map(option => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        className={cn(className)}
        value={String(value ?? '')}
        onChange={event => onChange(parseInt(event.target.value, 10) || 0)}
      />
    )
  }

  return (
    <Input
      className={cn(className)}
      value={String(value ?? '')}
      onChange={event => onChange(event.target.value)}
    />
  )
}
