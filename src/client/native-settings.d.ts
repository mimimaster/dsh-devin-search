declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export const Switch: import('react').ComponentType<{
    checked: boolean; onChange(checked: boolean): void; label: string; disabled?: boolean;
  }>;
}
