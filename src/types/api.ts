export interface ReadOptions {
  signal: AbortSignal
  beforeStart?: () => Promise<void>
}
