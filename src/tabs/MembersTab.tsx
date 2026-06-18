import { useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import { memberStats } from '../logic/stats'
import type { Member } from '../types'
import { useAdmin } from '../store/adminStore'
import { useAuth } from '../store/authStore'

function calcRanks(members: Member[]): Map<string, number> {
  const active = members.filter((m) => m.active)
  const sorted = [...active].sort((a, b) => b.handicap - a.handicap)
  const rankMap = new Map<string, number>()
  let rank = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].handicap < sorted[i - 1].handicap) rank = i + 1
    rankMap.set(sorted[i].id, rank)
  }
  return rankMap
}

function MemberDetail({ member, rank, total, onClose }: {
  member: Member
  rank: number | undefined
  total: number
  onClose: () => void
}) {
  const history = [...member.handicapHistory].reverse()
  return (
    <div className="card" style={{ marginBottom: 12, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{member.name} 상세</span>
        <button onClick={onClose}>닫기</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div className="metric" style={{ flex: 1 }}>
          <span className="metric-label">현재 핸디</span>
          <span className="metric-value">{member.handicap}</span>
        </div>
        {rank !== undefined && (
          <div className="metric" style={{ flex: 1 }}>
            <span className="metric-label">핸디 순위</span>
            <span className="metric-value">{rank}위 <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>/ {total}명</span></span>
          </div>
        )}
      </div>
      <div className="muted" style={{ marginBottom: 6 }}>핸디 변화 이력</div>
      {history.length === 0 ? (
        <p className="muted">기록 없음</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {history.map((h, i) => {
            const prev = history[i + 1]
            const diff = prev ? h.value - prev.value : null
            const date = h.changedAt.slice(0, 10)
            const time = h.changedAt.slice(11, 16)
            return (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 80 }}>{date} {time}</span>
                <span style={{ fontWeight: 600, fontSize: 15, minWidth: 24 }}>{h.value}</span>
                {diff !== null && (
                  <span style={{ fontSize: 12, color: diff > 0 ? '#1d9e75' : diff < 0 ? '#c0392b' : 'var(--muted)' }}>
                    {diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${diff}` : '─'}
                  </span>
                )}
                {i === 0 && <span style={{ fontSize: 11, background: '#e1f5ee', color: '#0f6e56', borderRadius: 4, padding: '2px 6px' }}>현재</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function MembersTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const addMember = useApp((s) => s.addMember)
  const updateMember = useApp((s) => s.updateMember)
  const setHandicap = useApp((s) => s.setHandicap)
  const setActive = useApp((s) => s.setActive)

  const [name, setName] = useState('')
  const [hcap, setHcap] = useState(20)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editHcap, setEditHcap] = useState(20)
  const [detailId, setDetailId] = useState<string | null>(null)
  const { isAdmin } = useAdmin()
  const { isGuest } = useAuth()
  const blind = (n: string) => isGuest ? '●●●' : n

  const stats = useMemo(() => memberStats(sessions), [sessions])
  const statOf = (id: string) => stats.find((s) => s.memberId === id)

  const rankMap = useMemo(() => calcRanks(members), [members])
  const activeCount = members.filter((m) => m.active).length

  const ROLES: Record<string, string> = {
    '엄재익': '당신회 회장',
    '이제한': '당신회 총무',
    '임진홍': '고문',
    '현응렬': '고문',
    '조영일': '고문',
  }

  const PINNED_TOP = ['엄재익', '이제한']
  const sorted = [...members].sort((a, b) => {
    if (Number(b.active) !== Number(a.active)) return Number(b.active) - Number(a.active)
    const aPinned = PINNED_TOP.indexOf(a.name)
    const bPinned = PINNED_TOP.indexOf(b.name)
    if (aPinned !== -1 || bPinned !== -1) {
      if (aPinned === -1) return 1
      if (bPinned === -1) return -1
      return aPinned - bPinned
    }
    const aHasRecord = !!statOf(a.id)
    const bHasRecord = !!statOf(b.id)
    if (aHasRecord !== bHasRecord) return Number(bHasRecord) - Number(aHasRecord)
    return a.name.localeCompare(b.name)
  })

  const startEdit = (id: string, curName: string, curHcap: number) => {
    setEditId(id)
    setEditName(curName)
    setEditHcap(curHcap)
    setDetailId(null)
  }

  const saveEdit = (id: string) => {
    const trimmed = editName.trim()
    if (!trimmed) return
    updateMember(id, { name: trimmed })
    const cur = members.find((m) => m.id === id)
    if (cur && editHcap !== cur.handicap) setHandicap(id, editHcap)
    setEditId(null)
  }

  const toggleDetail = (id: string) => {
    setDetailId((prev) => (prev === id ? null : id))
    setEditId(null)
  }

  return (
    <div className="tab">
      <h2 className="tab-title">회원</h2>

      {isAdmin && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            value={name}
            placeholder="이름"
            style={{ width: '100%' }}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                addMember(name.trim(), hcap)
                setName('')
              }
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="hcap-label" style={{ flex: 1 }}>
              핸디
              <input
                type="number"
                min={1}
                value={hcap}
                style={{ width: 70 }}
                onChange={(e) => setHcap(Math.max(1, +e.target.value))}
              />
            </label>
            <button
              className="primary"
              disabled={!name.trim()}
              style={{ flex: 1 }}
              onClick={() => {
                addMember(name.trim(), hcap)
                setName('')
              }}
            >
              추가
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && <p className="muted">아직 회원이 없습니다. 위에서 추가하세요.</p>}

      <ul className="member-list">
        {sorted.map((m) => {
          const st = statOf(m.id)
          const isEditing = editId === m.id
          const isDetail = detailId === m.id
          return (
            <li key={m.id} className={isDetail ? 'expanded' : ''}>
              <div className={`card member-row${m.active ? '' : ' inactive'}`} style={{
                marginBottom: isDetail ? 0 : undefined,
                borderBottomLeftRadius: isDetail ? 0 : undefined,
                borderBottomRightRadius: isDetail ? 0 : undefined,
                borderBottom: isDetail ? 'none' : undefined,
              }}>
                {isEditing ? (
                  <>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        style={{ width: '100%' }}
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m.id) }}
                      />
                      <label className="hcap-label">
                        핸디
                        <input
                          type="number"
                          min={1}
                          value={editHcap}
                          style={{ width: 64 }}
                          onChange={(e) => setEditHcap(Math.max(1, +e.target.value))}
                        />
                      </label>
                    </div>
                    <button className="primary" disabled={!editName.trim()} onClick={() => saveEdit(m.id)}>저장</button>
                    <button onClick={() => setEditId(null)}>취소</button>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', cursor: isGuest ? 'default' : 'pointer' }} onClick={() => !isGuest && toggleDetail(m.id)}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span className="member-name" style={{ textDecoration: isGuest ? undefined : 'underline dotted', textUnderlineOffset: 3 }}>{blind(m.name)}</span>
                          {!isGuest && ROLES[m.name] && (
                            <span style={{ fontSize: 10, background: '#e1f5ee', color: '#0f6e56', borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }}>
                              {ROLES[m.name]}
                            </span>
                          )}
                        </div>
                        <span className="member-stat">
                          {st ? `${st.wins}승 ${st.losses}패 · ${Math.round(st.winRate * 100)}%` : '기록 없음'}
                        </span>
                      </div>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 6 }}>핸디 {m.handicap}</span>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ flex: 1, fontSize: 12 }} onClick={() => startEdit(m.id, m.name, m.handicap)}>수정</button>
                        <button style={{ flex: 1, fontSize: 12 }} onClick={() => setActive(m.id, !m.active)}>{m.active ? '비활성' : '활성'}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {isDetail && (
                <MemberDetail
                  member={m}
                  rank={rankMap.get(m.id)}
                  total={activeCount}
                  onClose={() => setDetailId(null)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

