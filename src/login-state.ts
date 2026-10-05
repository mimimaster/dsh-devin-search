/** Safe, attempt-scoped projection shared by the authenticated Host API and client. */
export type LoginMode = 'code' | 'loopback';
export type LoginPhase = 'pending' | 'exchanging' | 'authorized' | 'cancelled' | 'error';
export interface LoginState {
  attemptId: string;
  mode: LoginMode;
  phase: LoginPhase;
  detail?: string;
}
export const LOGIN_STATE_PATH = '/api/devin-search/login/state';
export const LOGIN_CODE_PATH = '/api/devin-search/login/code';
export const ATTEMPT_ID = /^[A-Za-z0-9_-]{32}$/;
