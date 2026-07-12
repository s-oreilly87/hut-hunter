import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { WatchJob } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import type { WizardStep } from '@/components/jobs/form/wizardSteps'
import { JobFormDialog, JobFormPage } from './JobFormShells'

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
