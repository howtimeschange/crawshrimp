export function createUpdateActionRunner({
  setBusy,
  handleError,
  getLatestStatus,
} = {}) {
  let inFlight = null

  async function runAction(action) {
    try {
      return await action()
    } catch (error) {
      let latestStatus = null
      if (typeof getLatestStatus === 'function') {
        try {
          latestStatus = await getLatestStatus()
        } catch {
          latestStatus = null
        }
      }
      if (typeof handleError === 'function') {
        try {
          handleError(error, latestStatus)
        } catch {
          // Keep renderer event handlers settled even if UI error mapping fails.
        }
      }
      return null
    } finally {
      inFlight = null
      if (typeof setBusy === 'function') setBusy(false)
    }
  }

  return {
    run(action) {
      if (inFlight) return inFlight
      if (typeof setBusy === 'function') setBusy(true)
      inFlight = runAction(action)
      return inFlight
    },
  }
}
