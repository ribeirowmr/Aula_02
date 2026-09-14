export const AUDIT_EVENTS = {
  AUTH_SUCCESS: "AUTH_SUCCESS",
  AUTH_FAILURE: "AUTH_FAILURE",
  LOGOUT: "LOGOUT",
  AUTHORIZATION: "AUTHORIZATION",
  ACCESS_CHANGE: "ACCESS_CHANGE",
  TOKEN_ISSUED: "TOKEN_ISSUED",
  TOKEN_REFRESH: "TOKEN_REFRESH",
  TOKEN_REVOKED: "TOKEN_REVOKED"
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

export type IdentityGroup = {
  id?: string;
  name: string;
};

export type IdentityAttributes = {
  department?: string | null;
  company?: string | null;
  country?: string | null;
  officeLocation?: string | null;
  preferredLanguage?: string | null;
};

export type IdentityProfile = {
  entraId: string;
  email: string;
  name: string;
  displayName?: string | null;
  groups: IdentityGroup[];
  attributes: IdentityAttributes;
};

export type AuthStartParams = {
  applicationId: string;
  redirectUri: string;
  appState?: string;
};

export type AuthorizationUrlResult = {
  url: string;
  state: string;
};

export type CallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

export interface IdentityProvider {
  readonly mode: "mock" | "entra";
  getAuthorizationUrl(params: AuthStartParams): Promise<AuthorizationUrlResult>;
  handleCallback(query: CallbackQuery): Promise<IdentityProfile>;
}

export type AccessTokenClaims = {
  sub: string;
  entra_id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  uo: string | null;
  department: string | null;
  company: string | null;
  preferred_language: string | null;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
};
