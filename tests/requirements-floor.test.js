import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

test('websockets dependency floor supports proxy option used by js_runner', () => {
  const requirements = fs.readFileSync(path.join(repoRoot, 'core/requirements.txt'), 'utf8')

  assert.match(requirements, /^websockets>=14\.0$/m)
})
