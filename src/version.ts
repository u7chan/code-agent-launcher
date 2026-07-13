declare const __CAGENT_VERSION__: string

// Build scripts replace this identifier with the package version. The fallback keeps
// source-level development and tests usable without making built artifacts depend on
// a package.json file at runtime.
export const VERSION =
  typeof __CAGENT_VERSION__ === 'string' ? __CAGENT_VERSION__ : '0.0.0-development'
