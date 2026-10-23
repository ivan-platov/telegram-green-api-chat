export class DateService {
  static fromUnix(value: unknown): number | undefined {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 8640000000000
      ? value * 1000
      : undefined
  }

  static getBrowserZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }
}
