import type { QuantType } from '@/lib/catalogue/types'

const QUANT_LABELS: Record<QuantType, string> = {
  fp16: 'FP16',
  bf16: 'BF16',
  fp8: 'FP8',
  nvfp4: 'NVFP4 ★',
  smoothquant: 'SmoothQuant',
  w4a8: 'W4A8',
  w4a16: 'W4A16',
}

interface QuantChipProps {
  quant: QuantType
  selected: boolean
  disabled: boolean
  onClick: () => void
}

export default function QuantChip({ quant, selected, disabled, onClick }: QuantChipProps) {
  const isNvfp4 = quant === 'nvfp4'

  const base = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold transition-colors cursor-pointer select-none'

  let classes = base
  if (disabled) {
    classes += ' opacity-35 cursor-not-allowed border-border text-muted-foreground bg-transparent'
  } else if (selected && isNvfp4) {
    classes += ' border-[#7c3aed] bg-[#7c3aed] text-white'
  } else if (selected) {
    classes += ' border-[#009bde] bg-[#009bde] text-white'
  } else if (isNvfp4) {
    classes += ' border-[#7c3aed] text-[#7c3aed] bg-[#f5f3ff] hover:bg-[#ede9fe]'
  } else {
    classes += ' border-border text-foreground bg-background hover:bg-muted'
  }

  return (
    <button
      className={classes}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      type="button"
    >
      {QUANT_LABELS[quant]}
    </button>
  )
}
