import React, { useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import { memberStats } from '../logic/stats'
import type { MemberStat } from '../logic/stats'
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

// 핸디 구간별 아바타 색상 (UI 표시 전용, 데이터는 변경하지 않음)
function getHandicapColor(handicap: number): string {
  const h = typeof handicap === 'number' && Number.isFinite(handicap) ? handicap : -1
  if (h < 10) return '#9CA3AF' // 입문/초급 (핸디 없음/0~9 포함)
  if (h < 15) return '#2563EB' // 기본 실력
  if (h < 20) return '#22C55E' // 중급
  if (h < 25) return '#FACC15' // 상급 진입
  if (h < 30) return '#F97316' // 상급
  if (h < 35) return '#EF4444' // 고수
  return '#8B5CF6' // 35점 이상: 최상급
}
// 사용자가 제공한 당구 자세 아이콘(public/billiards_player.png)을 CSS mask로 사용 —
// 원본은 배경이 불투명한 흰색(RGB, 알파 채널 없음)이라 CSS mask가 실루엣을 인식하지 못해,
// 흰 배경을 투명 알파로 변환한 마스크 전용 파생 파일(billiards_player_icon.png)을 사용한다.
// PNG를 색상별로 여러 장 복제하지 않고, 실루엣 형태(mask)만 가져와 배경색으로 핸디별 색을 입힌다.
const BILLIARDS_ICON_URL = `${(import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL}billiards_player_icon.png`

// 카드에 연하게 깔리는 배경 아이콘 (텍스트 뒤 워터마크) — 핸디별 색상 유지.
// 위치/크기는 호출부에서 style로 지정 (내 실적 카드=중앙, 일반 카드=좌측).
function CardIconBackground({ handicap, opacity, style }: { handicap: number; opacity: number; style: React.CSSProperties }) {
  const color = getHandicapColor(handicap)
  const maskStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 0,
    backgroundColor: color,
    opacity,
    pointerEvents: 'none',
    WebkitMaskImage: `url("${BILLIARDS_ICON_URL}")`,
    maskImage: `url("${BILLIARDS_ICON_URL}")`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    ...style,
  }
  return <div aria-hidden="true" style={maskStyle} />
}

// 직책별 배지 색상: 회장(초록) / 총무(파랑) / 그 외(회색)
function roleBadgeStyle(role: string): { background: string; color: string } {
  if (role.includes('회장')) return { background: '#DCFCE7', color: '#15803D' }
  if (role.includes('총무')) return { background: '#DBEAFE', color: '#1D4ED8' }
  return { background: '#F1F5F9', color: '#475569' }
}

// 승패 / 승률 표기 — 대시보드(stats.ts memberStats)와 동일한 값을 그대로 사용
function winLossText(st: MemberStat | undefined): string {
  if (!st || st.games === 0) return '0승 0패'
  return `${st.wins}승 ${st.losses}패${st.draws ? ` ${st.draws}무` : ''}`
}
function winRateText(st: MemberStat | undefined): string {
  if (!st || st.games === 0) return '승률 0%'
  return `승률 ${Math.round(st.winRate * 100)}%`
}

type CardSize = 'hero' | 'list'

function MemberCardBody({ displayName, roleLabel, handicap, stat, size }: {
  displayName: string
  roleLabel?: string
  handicap: number
  stat: MemberStat | undefined
  size: CardSize
}) {
  const badge = roleLabel ? roleBadgeStyle(roleLabel) : null

  if (size === 'hero') {
    return (
      <div className="member-card-inner">
        <CardIconBackground
          handicap={handicap}
          opacity={0.15}
          style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 120, height: 120 }}
        />
        <div className="member-lines">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="member-name" style={{ fontSize: 30 }}>{displayName}</span>
            {roleLabel && badge && (
              <span className="role-badge" style={{ fontSize: 16, background: badge.background, color: badge.color }}>
                {roleLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span className="muted" style={{ fontSize: 16 }}>핸디</span>
            <span style={{ fontSize: 30, fontWeight: 800 }}>{handicap}</span>
          </div>
          <span style={{ fontSize: 23, color: 'var(--muted)' }}>{winLossText(stat)}</span>
          <span style={{ fontSize: 21, fontWeight: 700, color: '#2563EB' }}>{winRateText(stat)}</span>
        </div>
      </div>
    )
  }

  // 일반 회원 카드: 왼쪽에 연한 아이콘, 오른쪽 위주로 정보를 작고 촘촘하게 배치
  return (
    <div className="member-card-inner list-card">
      <CardIconBackground
        handicap={handicap}
        opacity={0.2}
        style={{ left: 6, top: 10, width: 88, height: 62 }}
      />
      <div className="member-lines list-card-lines">
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
          <span className="member-name" style={{ fontSize: 19 }}>{displayName}</span>
          {roleLabel && badge && (
            <span className="role-badge" style={{ fontSize: 11.5, background: badge.background, color: badge.color }}>
              {roleLabel}
            </span>
          )}
        </div>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>핸디 {handicap}</span>
        <div className="list-card-bottom-row">
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{winLossText(stat)}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#2563EB' }}>{winRateText(stat)}</span>
        </div>
      </div>
    </div>
  )
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
  const [search, setSearch] = useState('')
  const { isAdmin } = useAdmin()
  const { isGuest, memberId } = useAuth()
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
  // 카드에는 "당신회" 접두어 없이 짧게 표시 (예: [회장])
  const shortRole = (role: string) => role.replace(/^당신회\s*/, '')
  const roleOf = (m: Member) => (!isGuest && ROLES[m.name]) ? shortRole(ROLES[m.name]) : undefined

  const me = !isGuest ? members.find((m) => m.id === memberId) : undefined

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

  // 내 실적 카드에 이미 나온 로그인 회원은 목록에서 제외
  const listSource = me ? sorted.filter((m) => m.id !== me.id) : sorted
  const searchTerm = search.trim()
  const filtered = searchTerm
    ? listSource.filter((m) => m.name.includes(searchTerm) || (ROLES[m.name] ?? '').includes(searchTerm))
    : listSource

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

      {!isGuest && (
        <input
          value={search}
          placeholder="회원 이름 검색"
          className="block member-search"
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {me ? (
        <div className="card member-hero">
          <span className="hero-badge">내 실적</span>
          <MemberCardBody
            displayName={me.name}
            roleLabel={roleOf(me)}
            handicap={me.handicap}
            stat={statOf(me.id)}
            size="hero"
          />
        </div>
      ) : (
        <p className="muted" style={{ textAlign: 'center', padding: '10px 0' }}>
          회원 로그인 시 내 실적이 표시됩니다.
        </p>
      )}

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
      {sorted.length > 0 && filtered.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}

      <ul className="member-list">
        {filtered.map((m) => {
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
                  <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 10 }}>
                    <div
                      style={{ cursor: isGuest ? 'default' : 'pointer' }}
                      onClick={() => !isGuest && toggleDetail(m.id)}
                    >
                      <MemberCardBody
                        displayName={blind(m.name)}
                        roleLabel={roleOf(m)}
                        handicap={m.handicap}
                        stat={st}
                        size="list"
                      />
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
