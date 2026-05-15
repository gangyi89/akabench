export default function EngineBadge({ engine }: { engine: string }) {
  const isTrt = engine === 'trt-llm'
  const isSglang = engine === 'sglang'
  return (
    <span
      className="inline-block rounded px-1.5 py-px text-[11px] font-bold"
      style={
        isTrt
          ? { background: 'rgba(0,155,222,0.12)', color: 'var(--aka-blue)' }
          : isSglang
          ? { background: 'rgba(251,191,36,0.15)', color: '#92400e' }
          : { background: '#dcfce7', color: '#166534' }
      }
    >
      {isTrt ? 'TensorRT-LLM' : isSglang ? 'SGLang' : 'vLLM'}
    </span>
  )
}
