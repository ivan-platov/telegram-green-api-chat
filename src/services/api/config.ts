export const defaultApiUrl = (
  import.meta.env?.VITE_GREEN_API_URL || 'https://4100.api.green-api.com'
).replace(/\/+$/, '')
