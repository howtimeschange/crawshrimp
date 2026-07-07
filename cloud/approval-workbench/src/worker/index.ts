import { sessionTtlSeconds, type Env } from './env'

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  })
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'crawshrimp-cloud-approval-workbench',
        sessionTtlSeconds: sessionTtlSeconds(env),
      })
    }

    return new Response('Crawshrimp cloud approval workbench scaffold', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
