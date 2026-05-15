'use client'

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import type { SweepPoint } from '@/lib/catalogue/types'

type Props = {
  points:  SweepPoint[]
  xKey:    keyof SweepPoint
  xLabel:  string
  title:   string
}

type TooltipPayload = {
  payload: SweepPoint
}

function CustomTooltip({ active, payload, xKey, xLabel }: {
  active?: boolean
  payload?: TooltipPayload[]
  xKey: keyof SweepPoint
  xLabel: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const xVal = p[xKey] as number
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--aka-gray-200)',
        borderRadius: '6px',
        padding: '8px 12px',
        fontSize: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,.1)',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--aka-blue)', marginBottom: '4px' }}>
        Concurrency {p.concurrency}
      </div>
      <div style={{ color: 'var(--aka-gray-700)' }}>{xLabel}: <strong>{xVal.toFixed(1)}</strong></div>
      <div style={{ color: 'var(--aka-gray-700)' }}>Throughput: <strong>{p.throughputAvg.toFixed(0)} tok/s</strong></div>
    </div>
  )
}

export default function LatencyThroughputChart({ points, xKey, xLabel, title }: Props) {
  if (points.length < 2) return null

  const sorted = [...points].sort((a, b) => (a[xKey] as number) - (b[xKey] as number))

  return (
    <div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--aka-gray-800)', marginBottom: '12px' }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={sorted} margin={{ top: 20, right: 24, bottom: 32, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--aka-gray-200)" />
          <XAxis
            type="number"
            dataKey={xKey as string}
            name={xLabel}
            domain={['auto', 'auto']}
            tickCount={5}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--aka-gray-600)' }}
            tickLine={false}
            label={{ value: xLabel, position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--aka-gray-500)' }}
          />
          <YAxis
            type="number"
            dataKey="throughputAvg"
            name="Throughput"
            domain={['auto', 'auto']}
            tickCount={5}
            allowDecimals={false}
            label={{ value: 'Throughput (tok/s)', angle: -90, position: 'insideLeft', offset: 16, dy: 60, fontSize: 11, fill: 'var(--aka-gray-500)' }}
            tick={{ fontSize: 11, fill: 'var(--aka-gray-600)' }}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip xKey={xKey} xLabel={xLabel} />} />
          <Line
            dataKey="throughputAvg"
            stroke="var(--aka-blue)"
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Scatter dataKey="throughputAvg" fill="var(--aka-blue)" opacity={0.85} name="Throughput">
            <LabelList
              dataKey="concurrency"
              position="top"
              formatter={(v: unknown) => (v as number) === 0 ? '' : v as number}
              style={{ fontSize: '10px', fill: 'var(--aka-gray-600)', fontWeight: 600 }}
            />
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
