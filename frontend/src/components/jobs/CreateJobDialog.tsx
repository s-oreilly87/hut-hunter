import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { WatchJob } from '@/lib/api'
import { Button } from '../ui/Button'
import {
  Dialog, DialogContent,
} from '../ui/Dialog'
import { JobFormGrid } from '@/components/jobs/form/JobFormGrid'
import { JobFormWizard } from '@/components/jobs/form/JobFormWizard'
import { useJobForm } from '@/components/jobs/form/useJobForm'
import type { FormMode, WizardStep } from '@/components/jobs/form/wizardSteps'
import { cn } from '@/lib/utils'

/**
 * Mounts a single useJobForm instance and routes it to the right
 * presentation. Both the page wizard and the dialog grid share the same
 * form state — they only differ in layout.
 */
function JobFormBody({
  mode,
  initialJob,
  onDone,
  presentation,
  onBack,
  backLabel,
  initialStep,
  onOpenOccupants,
  onOpenCredentials,
}: {
  mode: FormMode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  presentation: 'dialog' | 'page'
  onBack?: () => void
  backLabel?: string
  initialStep?: WizardStep
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  const form = useJobForm({ mode, initialJob, onDone })

  if (presentation === 'page') {
    return (
      <JobFormWizard
        form={form}
        initialJob={initialJob}
        initialStep={initialStep}
        onBack={onBack}
        backLabel={backLabel}
        onOpenOccupants={onOpenOccupants}
        onOpenCredentials={onOpenCredentials}
      />
    )
  }

  return (
    <JobFormGrid
      form={form}
      onOpenOccupants={onOpenOccupants}
      onOpenCredentials={onOpenCredentials}
    />
  )
}

// ─── Page shell ───────────────────────────────────────────────────────────────

function JobFormPage({
  mode,
  initialJob,
  onDone,
  onBack,
  backLabel = 'Back',
  initialStep,
  onOpenOccupants,
  onOpenCredentials,
}: {
  mode: FormMode
  initialJob?: WatchJob
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
  initialStep?: WizardStep
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  return (
    <section className="app-panel app-panel-frame flex-1">
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

// ─── Dialog shell ─────────────────────────────────────────────────────────────

function JobFormDialog({
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

// ─── Public exports ───────────────────────────────────────────────────────────

export function CreateJobDialog({
  open: controlledOpen,
  onOpenChange,
  onDone,
  hideTrigger = false,
  onOpenOccupants,
  onOpenCredentials,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onDone?: (job: WatchJob) => void
  hideTrigger?: boolean
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen == null) {
      setUncontrolledOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  return (
    <>
      {!hideTrigger && (
        <Button onClick={() => handleOpenChange(true)} className="sm:min-w-40">
          <Plus className="size-4" />
          New Hunt
        </Button>
      )}
      <JobFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        mode="create"
        onDone={onDone}
        onOpenOccupants={onOpenOccupants}
        onOpenCredentials={onOpenCredentials}
      />
    </>
  )
}

export function CreateJobPage({
  onDone,
  onBack,
  backLabel,
  onOpenOccupants,
  onOpenCredentials,
}: {
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  return (
    <JobFormPage
      mode="create"
      onDone={onDone}
      onBack={onBack}
      backLabel={backLabel}
      onOpenOccupants={onOpenOccupants}
      onOpenCredentials={onOpenCredentials}
    />
  )
}

export function EditJobDialog({
  open,
  onOpenChange,
  job,
  step,
  onOpenOccupants,
  onOpenCredentials,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  job: WatchJob
  step?: number
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  return (
    <JobFormDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="edit"
      initialJob={job}
      initialStep={step as WizardStep}
      onOpenOccupants={onOpenOccupants}
      onOpenCredentials={onOpenCredentials}
    />
  )
}

export function EditJobPage({
  job,
  onDone,
  onBack,
  backLabel,
  step,
  onOpenOccupants,
  onOpenCredentials,
}: {
  job: WatchJob
  onDone: (job: WatchJob) => void
  onBack?: () => void
  backLabel?: string
  step?: number
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  return (
    <JobFormPage
      mode="edit"
      initialJob={job}
      onDone={onDone}
      onBack={onBack}
      backLabel={backLabel}
      initialStep={step !== undefined ? (step as WizardStep) : 1}
      onOpenOccupants={onOpenOccupants}
      onOpenCredentials={onOpenCredentials}
    />
  )
}
