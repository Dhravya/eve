/** JSON data supplied as evidence, never as executable policy. */
export type DecisionJson =
  | string
  | number
  | boolean
  | null
  | readonly DecisionJson[]
  | { readonly [key: string]: DecisionJson };

/** A finite, mutually exclusive set of alternatives. */
export interface ChoiceQuestion {
  readonly type: "choice";
  readonly prompt: string;
  readonly options: Readonly<Record<string, string>>;
}

/** One dimension described by 2–10 ordered levels. */
export interface ScoreQuestion {
  readonly type: "score";
  readonly prompt: string;
  readonly levels: readonly string[];
}

/** A yes/no judgment returning the probability of yes, without thresholding. */
export interface ProbabilityQuestion {
  readonly type: "probability";
  readonly prompt: string;
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | ProbabilityQuestion;
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;

export interface ChoiceAnswer<TOption extends string = string> {
  readonly type: "choice";
  readonly value: TOption;
  readonly probabilities: Readonly<Record<TOption, number>>;
  /** Distribution concentration; not the probability that the workflow is correct. */
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: "score";
  readonly value: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly levels: Readonly<Record<string, string>>;
  readonly confidence: number;
}

export interface ProbabilityAnswer {
  readonly type: "probability";
  readonly value: number;
}

export type DecisionAnswer<T extends DecisionQuestion = DecisionQuestion> = T extends ChoiceQuestion
  ? ChoiceAnswer<Extract<keyof T["options"], string>>
  : T extends ScoreQuestion
    ? ScoreAnswer
    : ProbabilityAnswer;

export interface DecisionInput<Q extends DecisionQuestions = DecisionQuestions> {
  readonly state: string | readonly DecisionJson[] | { readonly [key: string]: DecisionJson };
  readonly questions: Q;
}

/** Author-controlled transport configuration. Credentials are resolved only at runtime. */
export interface DecisionConfig {
  /** Defaults to TYPESAFE_API_KEY. A function supports runtime secret lookup. */
  readonly apiKey?: string | (() => string | Promise<string>);
  /** Defaults to jev-latest. Pin an account-supported version for reproducible evaluations. */
  readonly model?: string;
  /** Total deadline, including credential lookup, retries, and response body. Default: 5000 ms. */
  readonly timeoutMs?: number;
  /** Retries after the initial attempt, within the total deadline. Default: 1; maximum: 2. */
  readonly maxRetries?: number;
  /** Trusted server-side transport override, useful for deterministic tests. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface DecisionRequest<Q extends DecisionQuestions = DecisionQuestions>
  extends DecisionInput<Q>, DecisionConfig {
  /** Aborts all work, including retries and response reads. */
  readonly signal?: AbortSignal;
}

export interface DecisionResult<Q extends DecisionQuestions = DecisionQuestions> {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: DecisionAnswer<Q[K]> };
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly durationMs: number;
}
