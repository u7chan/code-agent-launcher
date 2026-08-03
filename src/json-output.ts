export const JSON_SCHEMA_VERSION = 1

export interface JsonWarning {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface JsonSuccess<T> {
  schema_version: number
  ok: true
  operation: string
  data: T
  warnings: JsonWarning[]
}

export interface JsonFailure {
  schema_version: number
  ok: false
  operation: string
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    suggestion?: string
  }
}

export function outputJsonSuccess<T>(
  operation: string,
  data: T,
  warnings: JsonWarning[] = [],
): void {
  const output: JsonSuccess<T> = {
    schema_version: JSON_SCHEMA_VERSION,
    ok: true,
    operation,
    data,
    warnings,
  }
  console.log(JSON.stringify(output))
}

export function outputJsonFailure(
  operation: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  suggestion?: string,
): void {
  const output: JsonFailure = {
    schema_version: JSON_SCHEMA_VERSION,
    ok: false,
    operation,
    error: {
      code,
      message,
      details,
      suggestion,
    },
  }
  console.log(JSON.stringify(output))
}

export function isJsonMode(options: { json?: boolean }): boolean {
  return options.json === true
}
