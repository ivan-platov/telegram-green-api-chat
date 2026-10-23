export type PhoneResult =
  | {
      ok: true
      digits: string
    }
  | {
      ok: false
      error: string
    }
