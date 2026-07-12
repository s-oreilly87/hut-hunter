import type { WatchJob } from '@/lib/api'
import { JobFormGrid } from '@/components/jobs/form/JobFormGrid'
import { JobFormWizard } from '@/components/jobs/form/JobFormWizard'
import { useJobForm } from '@/components/jobs/form/useJobForm'
import type { FormMode, WizardStep } from '@/components/jobs/form/wizardSteps'

/**
 * Mounts a single useJobForm instance and routes it to the right
 * presentation. Both the page wizard and the dialog grid share the same
 * form state — they only differ in layout.
 */
export function JobFormBody({
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
