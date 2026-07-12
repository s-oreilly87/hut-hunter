import type { WatchJob } from '@/lib/api'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/Dialog'
import type { FormMode, WizardStep } from '@/components/jobs/form/wizardSteps'
import { JobFormBody } from './JobFormBody'
import { cn } from '@/lib/utils'

export function JobFormPage({
  mode,
  initialJob,
  onDone,
  onBack,
  backLabel = 'Back',
  initialStep,
  onOpenOccupants,
  onOpenCredentials,
  className,
}: {
  mode: FormMode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
  initialStep?: WizardStep
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
  className?: string
}) {
  return (
    <section className={cn('app-panel app-panel-frame flex-1', className)}>
      <JobFormBody
        // Force a remount so each open gets fresh local form state.
        key={`${mode}:${initialJob?.id ?? 'new'}:page:${initialStep ?? 'default'}`}
        mode={mode}
        initialJob={initialJob}
        onDone={onDone}
        presentation="page"
        onBack={onBack}
        backLabel={backLabel}
        initialStep={initialStep}
        onOpenOccupants={onOpenOccupants}
        onOpenCredentials={onOpenCredentials}
      />
    </section>
  )
}

export function JobFormDialog({
  open,
  onOpenChange,
  mode,
  initialJob,
  onDone,
  initialStep,
  onOpenOccupants,
  onOpenCredentials,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: FormMode
  initialJob?: WatchJob
  onDone?: (job: WatchJob) => void
  initialStep?: WizardStep
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  // Edit uses the wizard inside the modal so the layout stays narrow on
  // existing hunts; create uses the wider grid since all three sections
  // are likely to need attention on a new hunt.
  const presentation = mode === 'edit' ? 'page' : 'dialog'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[92vh] flex flex-col gap-0 overflow-hidden p-0',
          presentation === 'dialog' ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
        showCloseButton={presentation === 'dialog'}
      >
        <JobFormBody
          // Force a remount so each open gets fresh local form state.
          key={`${mode}:${initialJob?.id ?? 'new'}:${initialStep ?? 'default'}`}
          mode={mode}
          initialJob={initialJob}
          onDone={(job) => {
            onDone?.(job)
            onOpenChange(false)
          }}
          onBack={() => onOpenChange(false)}
          presentation={presentation}
          initialStep={initialStep}
          onOpenOccupants={onOpenOccupants}
          onOpenCredentials={onOpenCredentials}
        />
      </DialogContent>
    </Dialog>
  )
}
