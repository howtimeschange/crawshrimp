import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

test('desktop build workflow runs on pull requests before merge', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /^  pull_request:/m)
})

test('desktop build workflow keeps default token permissions read-only', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /^permissions:\n  contents: read$/m)
  assert.doesNotMatch(workflow, /^permissions:\n  contents: write$/m)
})

test('desktop build release jobs request write permissions explicitly', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(
    workflow,
    /publish-release:[\s\S]*?permissions:\n      contents: write[\s\S]*?steps:/m,
  )
  assert.match(
    workflow,
    /publish-version-release:[\s\S]*?permissions:\n      contents: write[\s\S]*?steps:/m,
  )
})

test('desktop build workflow keeps rolling release out of GitHub latest', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /gh release create desktop-latest[\s\S]*--latest=false/)
})

test('desktop build workflow marks the validated version release as GitHub latest', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /TAG_VERSION="\$\{GITHUB_REF_NAME#v\}"[\s\S]*APP_VERSION[\s\S]*TAG_VERSION/)
  assert.match(workflow, /gh release edit "\$\{GITHUB_REF_NAME\}"[\s\S]*--latest/)
  assert.match(workflow, /gh release create "\$\{GITHUB_REF_NAME\}"[\s\S]*--latest[\s\S]*--verify-tag/)
})
