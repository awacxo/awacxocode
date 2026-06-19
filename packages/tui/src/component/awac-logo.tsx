import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "../context/theme"

// Static block wordmark for awacxocode (Pagga half-block style).
const lines = [
  "░█▀█░█░█░█▀█░█▀▀░█░█░█▀█░█▀▀░█▀█░█▀▄░█▀▀",
  "░█▀█░█▄█░█▀█░█░░░▄▀▄░█░█░█░░░█░█░█░█░█▀▀",
  "░▀░▀░▀░▀░▀░▀░▀▀▀░▀░▀░▀▀▀░▀▀▀░▀▀▀░▀▀░░▀▀▀",
]

export function Logo() {
  const { theme } = useTheme()
  return (
    <box flexDirection="column">
      <For each={lines}>
        {(line) => (
          <text fg={theme.primary} attributes={TextAttributes.BOLD} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
