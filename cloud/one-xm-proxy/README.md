# Crawshrimp 1XM Cloudflare Proxy

Cloudflare Worker proxy for Crawshrimp AI image generation when local direct access to `https://api.1xm.ai/v1` times out.

## What It Proxies

- `POST /v1/images/tasks`
- `GET /v1/images/tasks/{task_id}`
- `HEAD /v1/images/tasks/{task_id}`
- `GET /v1/proxy-image?url=<encoded img.1xm.ai URL>`
- WebSocket upgrade requests on the same allowed paths, for future compatibility.

The Worker rewrites small JSON responses so upstream absolute `poll_url` values like `https://api.1xm.ai/v1/images/tasks/...` come back as your Worker URL. It also rewrites `img.1xm.ai` result URLs to the image proxy endpoint above. This keeps Crawshrimp polling and downloading through the proxy.

## Recommended Setup

Use pass-through auth first: keep the 1XM key in Crawshrimp settings and only change `1XM Base URL`.

```bash
cd cloud/one-xm-proxy
npm test
npx wrangler deploy
```

After deployment, set Crawshrimp `1XM Base URL` to:

```text
https://one-xm-proxy.crawshrimp.com/v1
```

## Optional Proxy Token

To avoid exposing a public unauthenticated relay, set a separate proxy token:

```bash
openssl rand -hex 24
printf '%s' '<proxy-token>' | npx wrangler secret put ONE_XM_PROXY_TOKEN
npx wrangler deploy
```

Then set Crawshrimp `1XM Base URL` to:

```text
https://one-xm-proxy.crawshrimp.com/t/<proxy-token>/v1
```

## Optional Worker-Held 1XM Key

If you want Cloudflare to inject the upstream 1XM key, set it as a Worker secret:

```bash
printf '%s' '<1xm-api-key>' | npx wrangler secret put ONE_XM_API_KEY
npx wrangler deploy
```

In that mode, Crawshrimp still needs a non-empty local key value to select the model tier, but the Worker overwrites the outgoing `Authorization` header with the secret above.

## Connectivity Probe

Use an invalid key for connectivity tests. Expected result is an upstream `401`, not a TCP timeout.

```bash
curl --noproxy '*' -i \
  -X POST 'https://one-xm-proxy.crawshrimp.com/v1/images/tasks' \
  -H 'Authorization: Bearer sk-probe-invalid' \
  -H 'Content-Type: application/json' \
  --data '{"model":"gpt-image-2","prompt":"connectivity probe","size":"1024x1024","quality":"low","n":1}'
```
