import { memo } from 'react'
import type { DevinCommandInputData } from '../devin-command-input.js'

export interface DevinCommandInputViewProps {
  node: {
    readonly data: DevinCommandInputData
  }
}

/**
 * Native-looking command-input echo (mirrors dsh-client-ui-goal GoalCommandInputView).
 * Exists so blank sessions leave the hero; visual style stays DSH bubble tokens.
 */
export const DevinCommandInputView = memo(function DevinCommandInputView({
  node,
}: DevinCommandInputViewProps) {
  const text = node.data.text

  return (
    <div
      className="devin-command-input-row"
      data-command-input=""
      data-devin-command-input=""
      role="group"
      aria-label="Command input"
    >
      <div className="devin-command-input-stack">
        <div className="devin-command-input-bubble">{text}</div>
      </div>
    </div>
  )
})
