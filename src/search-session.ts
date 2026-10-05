/** Credential seam for search. Structurally satisfied by DSH Sessions; no DSH types. */
export interface SearchSession {
  available(): boolean;
  access(signal?: AbortSignal): Promise<{ token: string; signal: AbortSignal }>;
  revoke(token: string): Promise<void>;
}
