/**
 * network: offline, DNS or TLS failure. timeout: no answer in time.
 * http: the server answered with an error status. content: the response itself
 * can't be used (too large, unreadable encoding), so retrying won't help.
 */
export type FetchErrorKind = 'network' | 'timeout' | 'http' | 'content';

export class FetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly status?: number;
  /** Seconds the server asked us to wait (Retry-After on 429/503). */
  readonly retryAfter?: number;

  constructor(message: string, opts: { kind: FetchErrorKind; status?: number; retryAfter?: number }) {
    super(message);
    this.kind = opts.kind;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }
}

/** Retrying later can help: the connection failed, not the site or its content. */
export function isTransient(error: unknown): boolean {
  return error instanceof FetchError && (error.kind === 'network' || error.kind === 'timeout');
}
