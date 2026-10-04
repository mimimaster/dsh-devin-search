import { createElement } from 'react';
/** Test-only stand-in. Production keeps the DSH module external and uses its real Switch. */
export function Switch(props: { checked: boolean; label: string; disabled?: boolean; onChange(value: boolean): void }) {
  return createElement('button', { role: 'switch', 'aria-label': props.label, 'aria-checked': props.checked, disabled: props.disabled, onClick: () => props.onChange(!props.checked) });
}
