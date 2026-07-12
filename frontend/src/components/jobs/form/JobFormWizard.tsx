import { useState } from 'react'
import { ArrowLeft, ChevronRight, Pencil, Settings2, TentTree, X } from 'lucide-react'
import type { WatchJob } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { FormErrorAlert } from '@/components/ui/FormErrorAlert'
import { AutomationFields } from './AutomationFields'
import { BookingInputsFields } from './BookingInputsFields'
import { HuntSetupFields } from './HuntSetupFields'
import { isBlankValue, shouldHideBookingInputField } from './paramHelpers'
import type { JobFormController } from './useJobForm'
import { WIZARD_STEPS, type WizardStep } from './wizardSteps'
import { cn } from '@/lib/utils'

/**
 * Page-presentation form: a focused multi-step wizard. Used by the mobile
 * Create/Edit pages where the form takes the whole screen.
 *
 * Step gates:
 *  - Step 0 → name + adapter both filled.
 *  - Step 1 → every required booking input has a value (with adapter-specific
 *    quirks like inferring people from selected campers, hidden dependent
 *    fields, etc.).
 *  - Step 2 → no gate; submitting from step 2 is the final action.
 *
 * When `mode === 'edit'` the wizard skips the dot indicator + back-by-step
 * behaviour and shows a close (×) affordance instead, since edit lands
 * directly on a specific step.
 */
export function JobFormWizard({
  form,
  initialJob,
  initialStep,
  onBack,
  backLabel = 'Back',
  onOpenOccupants,
  onOpenCredentials,
}: {
  form: JobFormController
  initialJob?: WatchJob
  initialStep?: WizardStep
  onBack?: () => void
  backLabel?: string
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  const {
    mode,
    name,
    setName,
    selectedAdapterId,
    selectedAdapter,
    adapters,
    handleAdapterChange,
    hasCredentialsForSelectedAdapter,
    credentialVerifiedForSelectedAdapter,
    params,
    roster,
    occupantsLoading,
    selectedOccupantIds,
    setSelectedOccupantIds,
    selectedRosterOccupants,
    permitHolderOccupantId,
    setPermitHolderOccupantId,
    effectivePeopleCount,
    selectedOccupantCount,
    selectedOccupantsPresent,
    selectedOccupantDetailsComplete,
    resolveOptions,
    handleParamChange,
    setAutoBook,
    enableMonitoring,
    setEnableMonitoring,
    intervalMinutes,
    setIntervalMinutes,
    error,
    windowCheck,
    windowAcknowledged,
    acknowledgeWindow,
    pending,
    submitLabel,
    submitBusyLabel,
    handleSubmit,
  } = form

  const [wizardStep, setWizardStep] = useState<WizardStep>(
    initialStep ?? (mode === 'edit' ? 1 : 0),
  )

  const bookingInputsComplete = selectedAdapter
    ? selectedAdapter.param_fields.every((field) => {
        if (field.key === 'occupants') return true

        const opts = resolveOptions(field, params)
        if (shouldHideBookingInputField(field, params, opts)) return true

        if (field.key === 'people' && selectedOccupantsPresent) {
          return selectedOccupantCount > 0
        }

        if (field.type === 'multiselect') {
          const hasChoices = opts ? opts.length > 0 : true
          if (!field.required && !hasChoices) return true
          const value = params[field.key]
          return Array.isArray(value) && value.length > 0
        }

        return !field.required || !isBlankValue(params[field.key])
      })
    : false

  const stepBackLabels = [backLabel, WIZARD_STEPS[0], 'Details']
  const wizardBackLabel = mode === 'edit' ? backLabel : (stepBackLabels[wizardStep] ?? backLabel)
  const isLastStep = wizardStep === ((WIZARD_STEPS.length - 1) as WizardStep)
  // THR-124: block advancing past Booking Inputs (and the final submit)
  // until the not-yet-released-date notice has been acknowledged.
  const windowBlocksSubmit = Boolean(windowCheck && !windowCheck.is_open && !windowAcknowledged)
  const canAdvance = wizardStep === 0
    ? Boolean(name.trim()) && Boolean(selectedAdapterId)
    : wizardStep === 1
      ? bookingInputsComplete && !windowBlocksSubmit
      : true

  const handleWizardBack = () => {
    if (mode === 'edit') {
      onBack?.()
      return
    }
    if (wizardStep > 0) {
      setWizardStep((s) => (s - 1) as WizardStep)
    } else {
      onBack?.()
    }
  }

  const handleWizardNext = () => {
    if (!isLastStep) {
      setWizardStep((s) => (s + 1) as WizardStep)
    }
  }

  return (
    <>
      {/* Step header */}
      <div className="shrink-0 border-b border-border/70 px-4 py-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            {mode !== 'edit' && (
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2 w-fit"
                onClick={handleWizardBack}
              >
                <ArrowLeft className="size-4" />
                {wizardBackLabel}
              </Button>
            )}
          </div>
          <div className="text-center">
            <p className="text-base font-semibold tracking-tight text-foreground">
              {wizardStep === 1 && selectedAdapter
                ? initialJob?.name ?? 'Untitled'
                : WIZARD_STEPS[wizardStep]}
            </p>
            {mode !== 'edit' && (
              <div className="mt-2 flex justify-center gap-1.5">
                {WIZARD_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'size-1.5 rounded-full transition-colors duration-200',
                      i === wizardStep
                        ? 'bg-primary'
                        : i < wizardStep
                          ? 'bg-primary/35'
                          : 'bg-border',
                    )}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            {mode === 'edit' && (
              <Button
                size="sm"
                variant="ghost"
                className="-mr-2 w-fit"
                onClick={onBack}
                title="Close"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="app-panel-body-scroll px-4 sm:px-5">
        <div className="space-y-5 pt-6 pb-8">

          {wizardStep === 0 && (
            <HuntSetupFields
              mode={mode}
              name={name}
              setName={setName}
              adapters={adapters}
              selectedAdapterId={selectedAdapterId}
              onAdapterChange={handleAdapterChange}
              selectedAdapter={selectedAdapter}
              hasCredentialsForSelectedAdapter={hasCredentialsForSelectedAdapter}
            />
          )}

          {wizardStep === 1 && selectedAdapter && (
            <>
              <div className="flex items-center gap-2">
                <TentTree className="size-4 text-primary" />
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
                  {selectedAdapter.name}
                </h3>
              </div>
              <BookingInputsFields
                selectedAdapter={selectedAdapter}
                params={params}
                roster={roster}
                occupantsLoading={occupantsLoading}
                selectedOccupantIds={selectedOccupantIds}
                setSelectedOccupantIds={setSelectedOccupantIds}
                selectedRosterOccupants={selectedRosterOccupants}
                permitHolderOccupantId={permitHolderOccupantId}
                setPermitHolderOccupantId={setPermitHolderOccupantId}
                effectivePeopleCount={effectivePeopleCount}
                selectedOccupantCount={selectedOccupantCount}
                selectedOccupantsPresent={selectedOccupantsPresent}
                resolveOptions={resolveOptions}
                handleParamChange={handleParamChange}
                onOpenOccupants={onOpenOccupants}
                windowCheck={windowCheck}
                windowAcknowledged={windowAcknowledged}
                acknowledgeWindow={acknowledgeWindow}
              />
            </>
          )}

          {wizardStep === 2 && (
            <AutomationFields
              selectedAdapter={selectedAdapter}
              autoBook={form.effectiveAutoBook}
              setAutoBook={setAutoBook}
              enableMonitoring={enableMonitoring}
              setEnableMonitoring={setEnableMonitoring}
              intervalMinutes={intervalMinutes}
              setIntervalMinutes={setIntervalMinutes}
              selectedOccupantsPresent={selectedOccupantsPresent}
              hasCredentialsForSelectedAdapter={hasCredentialsForSelectedAdapter}
              credentialVerifiedForSelectedAdapter={credentialVerifiedForSelectedAdapter}
              selectedOccupantDetailsComplete={selectedOccupantDetailsComplete}
              onOpenCredentials={onOpenCredentials}
            />
          )}

          {(isLastStep || mode === 'edit') ? (
            <>
              {error && (
                <FormErrorAlert className="px-4 py-3">{error}</FormErrorAlert>
              )}
              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={!name || !selectedAdapterId || pending || windowBlocksSubmit}
              >
                {mode === 'edit' ? <Pencil className="size-4" /> : <Settings2 className="size-4" />}
                {pending ? submitBusyLabel : (mode === 'edit' ? 'Save and Close' : submitLabel)}
              </Button>
            </>
          ) : (
            <Button
              className="w-full"
              onClick={handleWizardNext}
              disabled={!canAdvance}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
