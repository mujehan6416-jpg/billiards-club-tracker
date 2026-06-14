import { useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import { memberStats } from '../logic/stats'

export function MembersTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const addMember = useApp((s) => s.addMember)
  const setHandicap = useApp((s) => s.setHandicap)
  const setActive = useApp((s) => s.setActive)

  const [name, setName] = useState('')
  const [hcap, setHcap] = useState(20)

  const stats = useMemo(() => memberStats(sessions), [sessions])
  const statOf = (id: string) => stats.find((s) => s.memberId === id)

  const sorted = [...members].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return (
    <div className="tab">
      <h2 className="tab-title">회원</h2>

      <div className="card add-row">
        <input className="grow" value={name} placeholder="이름" onChange={(e) => setName(e.target.value)} />
        <label className="hcap-label">
          핸디
          <input type="number" min={1} value={hcap} onChange={(e) => setHcap(Math.max(1, +e.target.value))} />
        </label>
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => {
            addMember(name.trim(), hcap)
            setName('')
          }}
        >
          추가
        </button>
      </div>

      {sorted.length === 0 && <p className="muted">아직 회원이 없습니다. 위에서 추가하세요.</p>}

      <ul className="member-list">
        {sorted.map((m) => {
          const st = statOf(m.id)
          return (
            <li key={m.id} className={`card member-row${m.active ? '' : ' inactive'}`}>
              <div className="member-main">
                <span className="member-name">{m.name}</span>
                <span className="member-stat">
                  {st ? `${st.wins}승 ${st.losses}패 ${st.draws}무 · ${Math.round(st.winRate * 100)}%` : '기록 없음'}
                </span>
              </div>
              <label className="hcap-label">
                핸디
                <input
                  type="number"
                  min={1}
                  value={m.handicap}
                  onChange={(e) => setHandicap(m.id, Math.max(1, +e.target.value))}
                />
              </label>
              <button onClick={() => setActive(m.id, !m.active)}>{m.active ? '휴면' : '활성'}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
