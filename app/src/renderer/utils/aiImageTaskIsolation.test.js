import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isAiVideoWorkflowJob,
  selectRestorableAiImageJob,
} from './aiImageTaskIsolation.js'

test('AI image restore skips a persisted AI-video task and falls back to a normal image task', () => {
  const videoJob = {
    job_uid: 'video-job',
    params: { surface: 'ai-video-workflow', workflow: 'bala_ai_face_background_generate' },
  }
  const imageJob = { job_uid: 'image-job', params: {} }

  assert.equal(isAiVideoWorkflowJob(videoJob), true)
  assert.deepEqual(
    selectRestorableAiImageJob({
      persistedActiveJobUid: 'video-job',
      jobs: [videoJob, imageJob],
      currentJob: videoJob,
    }),
    { job: imageJob, clearPersistedActiveJob: true },
  )
})

test('AI image restore clears a persisted AI-video task instead of reopening it when no image task remains', () => {
  const videoJob = { job_uid: 'video-job', summary: { surface: 'ai-video-workflow' } }

  assert.deepEqual(
    selectRestorableAiImageJob({
      persistedActiveJobUid: 'video-job',
      jobs: [videoJob],
      currentJob: videoJob,
    }),
    { job: null, clearPersistedActiveJob: true },
  )
})
