import { describe, expect, it } from 'vitest'

import { recordAudit } from '../worker/audit'

describe('audit logging', () => {
  it('redacts sensitive payload fields before persisting audit logs', async () => {
    let payloadJson = ''
    const env = {
      DB: {
        prepare() {
          return {
            bind(...params: unknown[]) {
              payloadJson = String(params[5])
              return this
            },
            async run() {
              return { success: true, meta: {} } as D1Result
            },
          }
        },
      } as unknown as D1Database,
    }

    await recordAudit(
      env as Parameters<typeof recordAudit>[0],
      { userId: 1 },
      'test.audit',
      'test',
      'resource-1',
      {
        Authorization: 'Bearer seller-secret',
        nested: {
          access_token: 'access-secret',
          local_path: '/Users/xingyicheng/raw/source.jpg',
        },
        safe: 'keep-me',
      },
      new Request('https://example.test/audit'),
    )

    expect(JSON.parse(payloadJson)).toEqual({
      Authorization: '[redacted]',
      nested: {
        access_token: '[redacted]',
        local_path: '[redacted]',
      },
      safe: 'keep-me',
    })
    expect(payloadJson).not.toMatch(/seller-secret|access-secret|xingyicheng/)
  })
})
