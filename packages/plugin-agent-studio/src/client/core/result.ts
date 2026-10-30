import type { RemoteResult } from './remote.ts'

export function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

export function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(errorText(result.error))
}
