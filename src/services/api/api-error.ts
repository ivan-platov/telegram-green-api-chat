export class ApiError extends Error {
  retryable: boolean
  uncertain: boolean
  httpStatus?: number
  serviceKind?: 'not-found' | 'account-changed'
  constructor(message: string, retryable = false, uncertain = false) {
    super(message)
    this.name = 'ApiError'
    this.retryable = retryable
    this.uncertain = uncertain
  }
}
