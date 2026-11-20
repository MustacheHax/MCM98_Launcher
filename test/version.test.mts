import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareVersions, isUpdateAvailable, versionFromRelease } from '../shared/version'

describe('version helpers', () => {
  it('offers a numbered release over a build installed from a rolling tag', () => {
    // Older launchers wrote the raw tag into install.json, and a lexical
    // comparison made "main-brain" and "prerelease" look newer than numbers.
    assert.equal(isUpdateAvailable('main-brain', '0.2.0'), true)
    assert.equal(isUpdateAvailable('prerelease', '0.8.0'), true)
  })

  it('still updates an ordinary older version', () => {
    assert.equal(isUpdateAvailable('0.1.2', '0.2.0'), true)
    assert.equal(isUpdateAvailable('0.3.0', '0.2.0'), false)
    assert.equal(isUpdateAvailable('0.2.0', '0.2.0'), false)
  })

  it('never offers a release with no comparable version', () => {
    assert.equal(isUpdateAvailable('0.1.2', 'main-brain'), false)
    assert.equal(isUpdateAvailable('main-brain', 'main-brain'), false)
  })

  it('reads the release tag before the title or asset name', () => {
    assert.equal(
      versionFromRelease({
        tag: 'v0.2.0',
        name: 'WienerStream v0.9.0',
        asset: { name: 'WienerStream-0.9.0.exe' }
      }),
      '0.2.0'
    )
    assert.equal(
      versionFromRelease({
        tag: 'main-brain',
        name: 'WienerStream v0.9.0',
        asset: { name: 'WienerStream-0.9.0.exe' }
      }),
      '0.9.0'
    )
  })

  it('sorts a prerelease below its final release', () => {
    assert.ok(compareVersions('1.0.0', '1.0.0-beta.2') > 0)
  })
})
