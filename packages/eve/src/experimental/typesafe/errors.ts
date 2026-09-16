export type DecisionErrorCode =
  | "configuration"
  | "input"
  | "authentication"
  | "request"
  | "unavailable"
  | "timeout"
  | "response"
  | "routing";

/**
 * Safe error metadata. Provider response bodies and request state are never
 * included in `message`; the underlying transport failure, when one exists, is
 * available as `cause` for server-side logging.
 */
export class DecisionError extends Error {
  override readonly name = "DecisionError";
  readonly code: DecisionErrorCode;
  readonly status?: number;

  constructor(
    code: DecisionErrorCode,
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options.status;
  }
}
