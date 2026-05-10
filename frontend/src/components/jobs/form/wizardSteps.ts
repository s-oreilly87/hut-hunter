/**
 * The job-form wizard has three steps. Step indices are also used as the
 * `initialStep` prop on the public Edit/Create entrypoints so deep links
 * can land on a specific section.
 */
export const WIZARD_STEPS = ['Hunt Setup', 'Booking Inputs', 'Automation'] as const
export type WizardStep = 0 | 1 | 2

export type FormMode = 'create' | 'edit'
