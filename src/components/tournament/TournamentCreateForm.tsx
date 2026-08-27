import { useState } from 'react'

const TIME_LIMIT_PRESETS = [40, 50, 60]

/**
 * 관리자 전용 대회 생성 폼. 이번 4A는 단식 고정이라 종목 선택 UI를 만들지 않는다
 * (Tournament 타입 자체에 단식/복식 구분 필드가 없다).
 */
export function TournamentCreateForm({ onCreate, onCancel, submitting }: {
  onCreate: (input: { name: string; date: string; timeLimitMinutes: number }) => void
  onCancel: () => void
  submitting?: boolean
}) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(50)
  const [customMinutes, setCustomMinutes] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    if (!name.trim()) { setError('대회명을 입력해 주세요.'); return }
    if (!date) { setError('대회 날짜를 선택해 주세요.'); return }
    if (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1) {
      setError('경기 제한시간을 올바르게 입력해 주세요.')
      return
    }
    setError('')
    onCreate({ name: name.trim(), date, timeLimitMinutes })
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 700, fontSize: 16 }}>🏆 새 대회 만들기</span>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>대회명</span>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          placeholder="예: 추석맞이 대회"
          style={{ width: '100%' }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>대회 날짜</span>
        <input
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); setError('') }}
          style={{ width: '100%' }}
        />
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>경기 제한시간</span>
        <div className="chip-grid">
          {TIME_LIMIT_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip${timeLimitMinutes === m && customMinutes === '' ? ' on' : ''}`}
              onClick={() => { setTimeLimitMinutes(m); setCustomMinutes(''); setError('') }}
            >
              {m}분
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>직접 입력(분)</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={customMinutes}
            placeholder="예: 45"
            onChange={(e) => {
              const v = e.target.value
              setCustomMinutes(v)
              setError('')
              const n = parseInt(v, 10)
              if (Number.isInteger(n) && n >= 1) setTimeLimitMinutes(n)
            }}
            style={{ width: 90 }}
          />
        </label>
      </div>

      {error && <span style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</span>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" style={{ flex: 1 }} disabled={submitting} onClick={submit}>
          {submitting ? '만드는 중...' : '대회 만들기'}
        </button>
        <button style={{ flex: 1 }} disabled={submitting} onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}
