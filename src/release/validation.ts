export const STABLE_RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function validateReleaseTag(tag: string, packageVersion: string): void {
  const match = STABLE_RELEASE_TAG_PATTERN.exec(tag)
  if (!match) {
    throw new Error(`Release tag must be a stable SemVer in vX.Y.Z format: ${tag}`)
  }

  const tagVersion = tag.slice(1)
  if (tagVersion !== packageVersion) {
    throw new Error(
      `Release tag version ${tagVersion} does not match package.json version ${packageVersion}`,
    )
  }
}
