import { describe, expect, it } from 'bun:test'
import { validateReleaseTag } from './validation.js'

describe('release tag validation', () => {
  it.each([
    'v0.0.0',
    'v0.1.0',
    'v1.2.3',
    'v10.20.30',
  ])('accepts a matching stable SemVer tag: %s', (tag) => {
    expect(() => validateReleaseTag(tag, tag.slice(1))).not.toThrow()
  })

  it.each([
    '1.2.3',
    'v1.2',
    'v1.2.3.4',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3-alpha.1',
    'v1.2.3+build.1',
    'v1.2.3\n',
    'release-v1.2.3',
  ])('rejects a non-stable or malformed tag: %s', (tag) => {
    expect(() => validateReleaseTag(tag, '1.2.3')).toThrow(
      'Release tag must be a stable SemVer in vX.Y.Z format',
    )
  })

  it('rejects a tag that does not exactly match package.json version', () => {
    expect(() => validateReleaseTag('v1.2.3', '1.2.4')).toThrow(
      'Release tag version 1.2.3 does not match package.json version 1.2.4',
    )
  })
})
