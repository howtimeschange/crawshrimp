const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const { Arch } = require('builder-util')
const { Platform } = require('app-builder-lib/out/core')
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory')

for (const arch of ['x64', 'arm64']) {
  test(`electron-builder resolves Windows ${arch} to only that NSIS architecture`, () => {
    const config = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'build.yml'), 'utf8'))
    const result = computeArchToTargetNamesMap(new Map([[Arch[arch], []]]), {
      platformSpecificBuildOptions: config.win,
      defaultTarget: ['nsis'],
    }, Platform.WINDOWS)
    assert.deepEqual([...result], [[Arch[arch], ['nsis']]])
  })
}
