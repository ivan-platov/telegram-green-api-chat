import axios from 'axios'

import { ApiErrorService } from './api-error.service.ts'

import type { Credentials } from '../../types/connection.ts'
import type { AxiosResponseTransformer } from 'axios'

export class HttpClientService {
  static create(credentials: Credentials) {
    const transforms: AxiosResponseTransformer[] = [
      (data: unknown) => (typeof data === 'string' && !data.trim() ? null : data),
    ]
    const client = axios.create({
      baseURL: `${credentials.apiUrl.replace(/\/+$/, '')}/waInstance${credentials.idInstance}/`,
      timeout: 20000,
      adapter: 'fetch',
      responseType: 'json',
      transitional: { silentJSONParsing: false },
      withCredentials: false,
      fetchOptions: { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' },
      transformResponse: transforms.concat(axios.defaults.transformResponse ?? []),
    })

    client.interceptors.response.use(undefined, (error: unknown) => {
      if (axios.isAxiosError(error) && error.config?.signal?.aborted) {
        const signal = error.config.signal

        return Promise.reject(
          'reason' in signal ? signal.reason : new DOMException('Запрос отменён', 'AbortError'),
        )
      }

      // Axios errors contain request config, including the token in the URL.
      // Only the application error crosses this boundary.
      return Promise.reject(ApiErrorService.fromAxios(error))
    })

    return client
  }
}
