/**
 * Launcher text size. The renderer turns the choice into a `--text-scale`
 * multiplier, so only type scales; window size and control bounds stay put.
 */
export type TextSize = 'small' | 'default' | 'large' | 'xlarge'

export interface TextSizeOption {
  id: TextSize
  label: string
  hint: string
}

export const TEXT_SIZE_OPTIONS: TextSizeOption[] = [
  { id: 'small', label: 'Small', hint: 'The original 0.2 type scale.' },
  { id: 'default', label: 'Default', hint: 'A little larger for everyday reading.' },
  { id: 'large', label: 'Large', hint: 'Comfortable on high-resolution screens.' },
  { id: 'xlarge', label: 'Extra large', hint: 'Maximum legibility in both layouts.' }
]

export const DEFAULT_TEXT_SIZE: TextSize = 'default'

const TEXT_SIZES = new Set<string>(TEXT_SIZE_OPTIONS.map((option) => option.id))

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && TEXT_SIZES.has(value)
}
