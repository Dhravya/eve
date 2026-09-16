export type DecisionErrorCode =
  | "configuration"
  | "input"
  | "authentication"
  | "request"
  | "unavailable"
  | "timeout"
  | "response"
  | "routing";

/** Safe error metadata. Provider response bodies and request state are never included. */
export class DecisionError extends Error {
  override readonly name = "DecisionError";
  readonly code: DecisionErrorCode;
  readonly status?: number;

  constructor(code: DecisionErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
