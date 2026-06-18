import { useEffect, useState } from 'react'
import { todayStr } from '../lib/date'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const pad = (n: number) => String(n).padStart(2, '0')

export function CalendarPicker({ value, onChange, markedDates }: {
  value: string
  onChange: (d: string) => void
  markedDates?: Set<string>
}) {
  const today = todayStr()
  const [year, setYear] = useState(() => parseInt(value.slice(0, 4)))
  const [month, setMonth] = useState(() => parseInt(value.slice(5, 7)))

  useEffect(() => {
    setYear(parseInt(value.slice(0, 4)))
    setMonth(parseInt(value.slice(5, 7)))
  }, [value])

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button
          onClick={prevMonth}
          style={{ fontSize: 20, padding: '4px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg)' }}
        >‹</button>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{year}년 {month}월</span>
        <button
          onClick={nextMonth}
          style={{ fontSize: 20, padding: '4px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg)' }}
        >›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 4 }}>
        {WEEK.map((d, i) => (
          <span key={i} style={{ fontSize: 11, color: i === 0 ? '#e74c3c' : i === 6 ? '#3498db' : '#888' }}>{d}</span>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} style={{ height: 38 }} />
          const ds = `${year}-${pad(month)}-${pad(d)}`
          const isSelected = ds === value
          const isToday = ds === today
          const hasResult = markedDates?.has(ds) ?? false
          const col = i % 7
          const textColor = isSelected ? '#fff' : col === 0 ? '#e74c3c' : col === 6 ? '#3498db' : 'var(--fg)'
          return (
            <div
              key={i}
              onClick={() => onChange(ds)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: 38,
                cursor: 'pointer',
                borderRadius: 8,
                background: isSelected ? '#072B61' : 'none',
                border: isToday && !isSelected ? '2px solid #072B61' : '2px solid transparent',
                color: textColor,
                userSelect: 'none',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>{d}</span>
              {hasResult && (
                <span style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: isSelected ? 'rgba(255,255,255,0.7)' : '#072B61',
                  marginTop: 2,
                }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
