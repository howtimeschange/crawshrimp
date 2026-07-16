export function isAiVideoWorkflowJob(job = {}) {
  const params = job?.params && typeof job.params === 'object' ? job.params : {}
  const summary = job?.summary && typeof job.summary === 'object' ? job.summary : {}
  return params.surface === 'ai-video-workflow'
    || summary.surface === 'ai-video-workflow'
    || params.workflow === 'bala_ai_face_background_generate'
    || summary.workflow === 'bala_ai_face_background_generate'
}

export function selectRestorableAiImageJob({
  persistedActiveJobUid = '',
  jobs = [],
  currentJob = null,
} = {}) {
  const persistedUid = String(persistedActiveJobUid || '').trim()
  const records = Array.isArray(jobs) ? jobs : []
  const persisted = persistedUid
    ? (records.find(job => String(job?.job_uid || '') === persistedUid) || currentJob)
    : null
  const rejectedPersistedJob = Boolean(persisted && isAiVideoWorkflowJob(persisted))
  const primary = persisted && !rejectedPersistedJob ? persisted : null
  const fallback = records.find(job => job?.job_uid && !isAiVideoWorkflowJob(job)) || null
  return {
    job: primary || fallback,
    clearPersistedActiveJob: rejectedPersistedJob,
  }
}
