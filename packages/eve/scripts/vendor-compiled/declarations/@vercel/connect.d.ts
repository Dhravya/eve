// Minimal declaration for the vendored slice of `@vercel/connect` used by
// self-modification. Keep this surface limited to the token exchange inputs
// eve owns.

export interface ConnectTokenParams {
  subject: { type: "app" };
  scopes?: string[];
  authorizationDetails?: Array<{
    type: "github_app_installation";
    repositories?: string | string[];
  }>;
}

export interface ConnectOptions {
  vercelToken?: string;
  forceRefresh?: boolean;
  region?: string;
}

export declare function getToken(
  connector: string,
  params: ConnectTokenParams,
  options?: ConnectOptions,
): Promise<string>;
