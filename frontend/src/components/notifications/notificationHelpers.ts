export function getErrorMessage(error: Error) {
  return error.message || 'Unable to save notification settings.'
}
