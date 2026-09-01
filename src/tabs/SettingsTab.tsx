import { useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { useAdmin } from '../store/adminStore'
import { useAuth } from '../store/authStore'
import { exportCsv, exportHandicapCsv, exportJson, exportMemberCsv, importHandicapCsv, importJson, importMemberCsv, importGameCsv } from '../lib/backup'
import { uploadToCloud, downloadFromCloud, markSynced, UploadCancelledError } from '../lib/cloudSync'
import { saveToServer } from '../lib/autoSave'
import { USE_SPLIT_FIRESTORE, syncSplitChanges, deleteSplitSession } from '../lib/splitFirestore'
import { DeviceLinkCard } from '../components/memberLink/DeviceLinkCard'
import { DeviceLinkAdminCard } from '../components/memberLink/DeviceLinkAdminCard'
import { SplitMigrationCard } from '../components/admin/SplitMigrationCard'
import { MemberIndexBackfillCard } from '../components/admin/MemberIndexBackfillCard'
import { TournamentApr18ImportCard } from '../components/admin/TournamentApr18ImportCard'
import { TournamentNov29ImportCard } from '../components/admin/TournamentNov29ImportCard'
import { todayStr } from '../lib/date'
import { winnerId } from '../logic/game'
import { fmtScore } from '../lib/format'
import type { Game, Member, Session } from '../types'

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAdmin()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  const try_ = () => {
    if (login(pin)) { onSuccess() }
    else { setError(true); setPin('') }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>🔑 관리자 로그인</span>
      <input
        type="password"
        placeholder="PIN 입력"
        value={pin}
        onChange={(e) => { setPin(e.target.value); setError(false) }}
        onKeyDown={(e) => e.key === 'Enter' && try_()}
        style={{ width: '100%' }}
      />
      {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>PIN이 틀렸습니다.</span>}
      <button className="primary block" onClick={try_}>로그인</button>
      <span className="muted" style={{ fontSize: 11 }}>초기 PIN: 1234 (로그인 후 변경하세요)</span>
    </div>
  )
}

function ChangePinCard() {
  const { changePin } = useAdmin()
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [msg, setMsg] = useState('')

  const doChange = () => {
    if (newPin !== newPin2) { setMsg('새 PIN이 일치하지 않습니다.'); return }
    if (newPin.length < 4) { setMsg('PIN은 4자리 이상이어야 합니다.'); return }
    if (changePin(oldPin, newPin)) setMsg('PIN이 변경되었습니다.')
    else setMsg('현재 PIN이 틀렸습니다.')
    setOldPin(''); setNewPin(''); setNewPin2('')
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>PIN 변경</span>
      <input type="password" placeholder="현재 PIN" value={oldPin} onChange={(e) => setOldPin(e.target.value)} style={{ width: '100%' }} />
      <input type="password" placeholder="새 PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} style={{ width: '100%' }} />
      <input type="password" placeholder="새 PIN 확인" value={newPin2} onChange={(e) => setNewPin2(e.target.value)} style={{ width: '100%' }} />
      {msg && <span style={{ fontSize: 13, color: msg.includes('변경') ? '#1d9e75' : 'var(--danger)' }}>{msg}</span>}
      <button className="block" onClick={doChange}>PIN 변경</button>
    </div>
  )
}

// 경기결과 승인 대기 — 일반회원이 제출한 게임 (날짜 검색 + 수정 + 저장 + 수정요청)
export function PendingGameRow({ game, sessionId, sessionDate, name }: {
  game: Game
  sessionId: string
  sessionDate: string
  name: (id: string) => string
}) {
  const confirmGame = useApp((s) => s.confirmGame)
  const updateGameResult = useApp((s) => s.updateGameResult)
  const requestGameRevision = useApp((s) => s.requestGameRevision)
  const deleteGame = useApp((s) => s.deleteGame)
  const [scoreA, setScoreA] = useState(String(game.scoreA))
  const [scoreB, setScoreB] = useState(String(game.scoreB))
  const [hA, setHA] = useState(game.handicapA)
  const [hB, setHB] = useState(game.handicapB)
  const [saving, setSaving] = useState(false)
  const [requesting, setRequesting] = useState(false)

  // previous(관리자 행동 직전 상태)를 넘기면 split 모드에서 바뀐 문서만 골라 반영한다.
  const syncAfter = async (previous?: import('../types').AppState) => {
    try {
      const s = useApp.getState()
      if (USE_SPLIT_FIRESTORE && previous) {
        await syncSplitChanges(previous, s)
      } else {
        await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
      }
    } catch { /* ignore */ }
  }

  const doSave = async () => {
    const sA = Math.max(0, parseInt(scoreA || '0', 10) || 0)
    const sB = Math.max(0, parseInt(scoreB || '0', 10) || 0)
    const previous = useApp.getState()
    setSaving(true)
    updateGameResult(sessionId, game.id, { scoreA: sA, scoreB: sB, handicapA: hA, handicapB: hB })
    confirmGame(sessionId, game.id)
    await syncAfter(previous)
    setSaving(false)
  }

  // 확인완료(저장)와 달리 점수는 그대로 두고 상태만 "수정 요청"으로 바꾼다 — 참가자가 다시 입력해야 한다.
  const doRequestRevision = async () => {
    const previous = useApp.getState()
    setRequesting(true)
    requestGameRevision(sessionId, game.id)
    await syncAfter(previous)
    setRequesting(false)
  }

  // 삭제도 다른 행동과 동일하게 저장 직후 서버에 반영한다(이전에는 여기서 반영하지 않고
  // 다음 행동의 전체 저장에 묻어가는 방식이었는데, split 모드에서는 행동별로 정확히 반영해야
  // 하므로 이 삭제도 명시적으로 반영한다).
  const doDelete = async () => {
    if (!window.confirm('이 경기 결과를 삭제할까요?')) return
    const previous = useApp.getState()
    deleteGame(sessionId, game.id)
    await syncAfter(previous)
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
        📅 {sessionDate} — {name(game.playerAId)} vs {name(game.playerBId)}
        {game.revisionRequested && (
          <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 3, background: '#fdeceb', color: '#c0392b', fontWeight: 600 }}>
            수정 요청됨 — 참가자 재제출 대기
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 110 }}>
          <span style={{ fontSize: 11, color: '#888' }}>{name(game.playerAId)} 득점 / 핸디</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="number" min={0} value={scoreA} onChange={(e) => setScoreA(e.target.value)}
              style={{ width: 52 }} inputMode="numeric" />
            <input type="number" min={1} value={hA} onChange={(e) => setHA(Math.max(1, +e.target.value))}
              style={{ width: 52 }} />
          </div>
        </div>
        <span className="vs" style={{ paddingBottom: 4 }}>vs</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 110 }}>
          <span style={{ fontSize: 11, color: '#888' }}>{name(game.playerBId)} 득점 / 핸디</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="number" min={0} value={scoreB} onChange={(e) => setScoreB(e.target.value)}
              style={{ width: 52 }} inputMode="numeric" />
            <input type="number" min={1} value={hB} onChange={(e) => setHB(Math.max(1, +e.target.value))}
              style={{ width: 52 }} />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="primary" style={{ fontSize: 12 }} disabled={saving} onClick={doSave}>
          {saving ? '저장 중...' : '확인 완료'}
        </button>
        <button style={{ fontSize: 12 }} disabled={requesting || game.revisionRequested} onClick={doRequestRevision}>
          {requesting ? '요청 중...' : game.revisionRequested ? '수정 요청됨' : '수정 요청'}
        </button>
        <button style={{ fontSize: 12, color: '#c0392b', borderColor: '#e0a0a0' }} onClick={doDelete}>
          삭제
        </button>
      </div>
    </div>
  )
}

function PendingGamesCard({ sessions, members }: { sessions: Session[]; members: Member[] }) {
  const [filterDate, setFilterDate] = useState('')

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id

  const allPending = sessions.flatMap((s) =>
    s.games.filter((g) => g.pending).map((g) => ({ game: g, sessionId: s.id, sessionDate: s.date }))
  )
  const filtered = allPending
    .filter((item) => !filterDate || item.sessionDate === filterDate)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))

  if (allPending.length === 0 && !filterDate) return null

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>📤 경기결과 승인 대기 ({allPending.length}건)</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>날짜 검색</span>
        <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} style={{ flex: 1 }} />
        {filterDate && (
          <button style={{ fontSize: 12 }} onClick={() => setFilterDate('')}>초기화</button>
        )}
      </div>
      {filtered.length === 0 && filterDate && (
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>해당 날짜의 대기 경기가 없습니다.</p>
      )}
      {filtered.map((item) => (
        <PendingGameRow
          key={item.game.id}
          game={item.game}
          sessionId={item.sessionId}
          sessionDate={item.sessionDate}
          name={name}
        />
      ))}
    </div>
  )
}

// 번개모임 승인 카드 (관리자 전용, 맨 위)
function PendingFlashCard({ sessions, members }: { sessions: Session[]; members: Member[] }) {
  const approveSession = useApp((s) => s.approveSession)
  const deleteSession = useApp((s) => s.deleteSession)
  const [expanding, setExpanding] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const pending = sessions.filter((s) => s.type === 'flash' && s.approved === false)
  if (pending.length === 0) return null

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id

  /**
   * 승인 대기 중인 번개모임을 기록째 삭제한다.
   *
   * 안전장치:
   *  1. 누르는 순간의 최신 상태를 다시 읽어 "아직 승인 대기 중인 번개모임"인지 재확인한다 —
   *     다른 기기에서 그 사이 승인됐다면 여기서 멈춘다(이미 승인된 정상 모임 오삭제 방지).
   *  2. 날짜·참석 인원·경기 수를 보여주고 확인받는다.
   *  3. 서버를 먼저 지우고 성공했을 때만 이 기기 목록에서 지운다 — 권한 문제 등으로 서버 삭제가
   *     실패하면 아무것도 지워지지 않은 상태로 남는다.
   *  4. 서버 삭제는 deleteSplitSession()을 그대로 쓴다 — 이 함수가 하위 games를 먼저 배치로
   *     지운 뒤 session 문서를 지우므로 경기 기록이 고아로 남지 않는다. 지우는 대상은 이
   *     세션과 그 하위 경기뿐이고 다른 날짜·다른 모임은 건드리지 않는다.
   */
  const removePendingFlash = async (sessionId: string) => {
    setError('')
    const current = useApp.getState().sessions.find((x) => x.id === sessionId)
    if (!current || current.type !== 'flash' || current.approved !== false) {
      setError('이미 승인되었거나 목록에서 사라진 모임입니다. 화면을 새로 고친 뒤 다시 확인해 주세요.')
      return
    }
    if (!window.confirm(
      `이 번개모임 기록을 완전히 삭제할까요?\n\n`
      + `날짜: ${current.date}\n참석: ${current.attendeeIds.length}명\n경기: ${current.games.length}건\n\n`
      + `이 모임의 경기 기록도 함께 삭제되며 되돌릴 수 없습니다.`,
    )) return

    setBusyId(sessionId)
    try {
      if (USE_SPLIT_FIRESTORE) {
        await deleteSplitSession(current.id)
        deleteSession(current.id)
      } else {
        deleteSession(current.id)
        const st = useApp.getState()
        await uploadToCloud({ members: st.members, sessions: st.sessions, settings: st.settings, ledger: st.ledger })
      }
    } catch {
      setError('삭제하지 못했습니다. 인터넷 연결과 관리자 로그인을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>⚡ 번개모임 승인 대기 ({pending.length}건)</span>
      {pending.map((s) => (
        <div key={s.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{s.date}</span>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                참석 {s.attendeeIds.length}명 · {s.games.length}경기
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ fontSize: 12 }} disabled={busyId === s.id} onClick={() => setExpanding(expanding === s.id ? null : s.id)}>
                {expanding === s.id ? '닫기' : '내용 보기'}
              </button>
              {/* 삭제는 되돌릴 수 없는 위험 동작이라 승인 버튼과 색으로 구분한다. */}
              <button
                style={{ fontSize: 12, color: '#c0392b', borderColor: '#e0a0a0' }}
                disabled={busyId === s.id}
                onClick={() => void removePendingFlash(s.id)}
              >
                {busyId === s.id ? '삭제 중...' : '삭제'}
              </button>
              <button className="primary" style={{ fontSize: 12 }} disabled={busyId === s.id} onClick={async () => {
                if (!window.confirm(`${s.date} 번개모임 기록을 승인할까요?\n정규 통계에 반영됩니다.`)) return
                const previous = useApp.getState()
                approveSession(s.id)
                const st = useApp.getState()
                try {
                  if (USE_SPLIT_FIRESTORE) await syncSplitChanges(previous, st)
                  else await uploadToCloud({ members: st.members, sessions: st.sessions, settings: st.settings, ledger: st.ledger })
                } catch { /* ignore */ }
              }}>승인</button>
            </div>
          </div>
          {expanding === s.id && s.games.length > 0 && (
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {s.games.map((g) => {
                const win = winnerId(g)
                return (
                  <li key={g.id} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'center' }}>
                    <span className={win === g.playerAId ? 'win' : ''}>{name(g.playerAId)} {fmtScore(g.scoreA, g.handicapA)}</span>
                    <span className="vs">vs</span>
                    <span className={win === g.playerBId ? 'win' : ''}>{name(g.playerBId)} {fmtScore(g.scoreB, g.handicapB)}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {expanding === s.id && s.games.length === 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>경기 기록 없음</p>
          )}
        </div>
      ))}
      {error && <span style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.5 }}>{error}</span>}
    </div>
  )
}

// 에버리지(핸디) 직접 수정 카드
function HandicapEditCard({ members }: { members: Member[] }) {
  const updateMember = useApp((s) => s.updateMember)
  const PINNED = ['엄재익', '이제한']
  const sorted = [...members.filter((m) => m.active)].sort((a, b) => {
    const ai = PINNED.indexOf(a.name), bi = PINNED.indexOf(b.name)
    if (ai !== -1 || bi !== -1) { if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi }
    return a.name.localeCompare(b.name, 'ko')
  })
  const [memberId, setMemberId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [handicap, setHandicap] = useState('')
  const [msg, setMsg] = useState('')

  const save = async () => {
    const m = members.find((x) => x.id === memberId)
    if (!m) { setMsg('회원을 선택하세요.'); return }
    const hv = parseInt(handicap)
    if (!hv || hv < 1) { setMsg('유효한 에버리지를 입력하세요.'); return }
    // 같은 날짜 기존 항목은 덮어쓰기 (applyHandicapCsv는 중복 날짜 건너뜀)
    const changedAt = date + 'T00:00:00.000Z'
    const filtered = m.handicapHistory.filter((h) => h.changedAt.slice(0, 10) !== date)
    // 지정한 날짜 바로 앞 이력의 값이 이 변경의 "변경 전" 핸디다(과거 날짜로도 넣을 수 있으므로
    // 현재 핸디가 아니라 날짜 순서를 기준으로 찾는다). 앞 이력이 없으면 첫 등록이라 prev를 비운다.
    const before = [...filtered]
      .filter((h) => h.changedAt < changedAt)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
      .pop()
    const entry = { value: hv, changedAt, source: 'admin' as const, ...(before ? { prev: before.value } : {}) }
    const newHistory = [...filtered, entry]
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
    // 이력 중 가장 최신 날짜의 값이 현재 핸디
    const latestHandicap = newHistory[newHistory.length - 1].value
    const previous = useApp.getState()
    updateMember(m.id, { handicap: latestHandicap, handicapHistory: newHistory })
    try {
      const s = useApp.getState()
      if (USE_SPLIT_FIRESTORE) await syncSplitChanges(previous, s)
      else await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
      setMsg(`${m.name} 에버리지 ${latestHandicap} 반영 완료`)
    } catch {
      setMsg(`${m.name} 에버리지 ${latestHandicap} 반영 완료 (서버 저장 실패)`)
    }
    setHandicap('')
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>🎯 에버리지(핸디) 수정</span>
      <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ width: '100%' }}>
        <option value="">회원 선택</option>
        {sorted.map((m) => (
          <option key={m.id} value={m.id}>{m.name} (현재: {m.handicap})</option>
        ))}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: '100%' }} />
      <input type="number" min={1} placeholder="새 에버리지(핸디)" value={handicap}
        onChange={(e) => { setHandicap(e.target.value); setMsg('') }}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={{ width: '100%' }} />
      {msg && <span style={{ fontSize: 13, color: msg.includes('완료') ? '#1d9e75' : 'var(--danger)' }}>{msg}</span>}
      <button className="primary block" onClick={save}>저장</button>
    </div>
  )
}


export function SettingsTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const ledger = useApp((s) => s.ledger)
  const replaceAll = useApp((s) => s.replaceAll)
  const applyHandicapCsv = useApp((s) => s.applyHandicapCsv)
  const applyMemberCsv = useApp((s) => s.applyMemberCsv)
  const applyGameCsv = useApp((s) => s.applyGameCsv)
  const touchBackup = useApp((s) => s.touchBackup)
  const { isAdmin } = useAdmin()
  const { isGuest } = useAuth()

  const fileRef = useRef<HTMLInputElement>(null)
  const hcapFileRef = useRef<HTMLInputElement>(null)
  const memberFileRef = useRef<HTMLInputElement>(null)
  const gameFileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  const onExportJson = () => {
    exportJson({ members, sessions, settings, ledger }, todayStr())
    touchBackup()
    setMsg('전체 데이터를 파일로 보관했습니다. (JSON)')
  }

  const onExportCsv = () => {
    exportCsv(sessions, members, todayStr())
    touchBackup()
    setMsg('경기기록을 엑셀 파일로 받았습니다. (CSV)')
  }

  const onExportHandicapCsv = () => {
    exportHandicapCsv(members, todayStr())
    setMsg('핸디 이력 CSV를 다운로드했습니다.')
  }

  const onImport = async (file: File) => {
    try {
      const state = await importJson(file)
      if (!confirm('보관한 파일의 내용으로 이 기기의 현재 내용을 전부 바꿉니다. 계속할까요?')) return
      replaceAll(state)
      // 전체 복원은 일부러 서버에 자동 저장하지 않는다 — 서버의 기존 내용을 되돌리기 어렵게
      // 덮어쓸 수 있으므로, 사용자가 이 기기에서 내용을 확인한 뒤 직접 올리도록 안내한다.
      // split 모드에서는 "이 기기 내용을 서버에 올리기" 자체를 막아 두었으므로(전체 재동기화가
      // 필요한 위험한 작업이라 안전하게 다시 만들기 전까지는 비활성화) 안내 문구도 다르게 준다.
      setMsg(USE_SPLIT_FIRESTORE
        ? '보관한 파일로 이 기기 내용만 되돌렸습니다. 서버에는 반영되지 않았습니다(현재 서버 반영 기능은 막혀 있습니다) — 서버 내용도 되돌려야 하면 관리자에게 문의해 주세요.'
        : '보관한 파일로 되돌렸습니다. 내용을 확인한 뒤, 서버에도 반영하려면 아래 "이 기기 내용을 서버에 올리기"를 눌러 주세요.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일을 불러오지 못했습니다.')
    }
  }

  const onExportMemberCsv = () => {
    exportMemberCsv(members, todayStr())
    setMsg('회원명부 CSV를 다운로드했습니다.')
  }

  const onImportMemberCsv = async (file: File) => {
    try {
      const rows = await importMemberCsv(file)
      const existing = rows.filter((r) => members.some((m) => m.name === r.name))
      const newOnes = rows.filter((r) => !members.some((m) => m.name === r.name))
      let msg = `신규 회원 ${newOnes.length}명`
      if (existing.length > 0) msg += `, 에버리지 업데이트 ${existing.length}명`
      if (!confirm(`${msg}\n\n계속할까요?`)) return
      const previous = useApp.getState()
      applyMemberCsv(rows)
      // 파일을 제대로 불러와 반영한 경우에만 서버에 저장한다(파싱 실패는 위 catch로 빠진다).
      const failed = await saveToServer(previous)
      setMsg(failed ?? `회원명부 반영 완료: ${msg}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일 처리에 실패했습니다.')
    }
  }

  const onImportHandicap = async (file: File) => {
    try {
      const rows = await importHandicapCsv(file)
      const unknownNames = rows.map((r) => r.name).filter((n, i, a) => a.indexOf(n) === i).filter((n) => !members.some((m) => m.name === n))
      let confirmMsg = `${rows.length}개 행을 불러옵니다.`
      if (unknownNames.length > 0) confirmMsg += `\n\n※ 무시되는 이름: ${unknownNames.join(', ')}`
      if (!confirm(confirmMsg + '\n\n계속할까요?')) return
      const previous = useApp.getState()
      applyHandicapCsv(rows)
      const failed = await saveToServer(previous)
      setMsg(failed ?? `핸디 이력 ${rows.length}개 행을 반영했습니다.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일 처리에 실패했습니다.')
    }
  }

  const onUploadCloud = async () => {
    if (!confirm('이 기기의 내용을 서버에 올립니다. 계속할까요?')) return
    setSyncing(true)
    try {
      await uploadToCloud({ members, sessions, settings, ledger })
      setMsg('서버에 올렸습니다.')
    } catch (e) {
      if (e instanceof UploadCancelledError) setMsg('서버에 올리기를 취소했습니다.')
      else setMsg('서버에 올리지 못했습니다: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSyncing(false) }
  }

  const onDownloadCloud = async () => {
    if (!confirm('서버에 저장된 내용으로 이 기기의 현재 내용을 바꿉니다. 계속할까요?')) return
    setSyncing(true)
    try {
      const cloud = await downloadFromCloud()
      if (!cloud) { setMsg('서버에 저장된 내용이 없습니다.'); return }
      replaceAll(cloud.state)
      markSynced(cloud.updatedAt)
      setMsg('서버 내용을 이 기기로 받았습니다.')
    } catch (e) {
      setMsg('서버 내용을 받지 못했습니다: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSyncing(false) }
  }

  return (
    <div className="tab">
      <h2 className="tab-title">설정</h2>

      {isGuest && (
        <div className="card col-card">
          <span className="muted" style={{ textAlign: 'center' }}>GUEST 모드에서는 설정을 변경할 수 없습니다.</span>
        </div>
      )}

      {!isGuest && !isAdmin && !showLogin && (
        <div className="card col-card">
          <span className="muted">관리자 기능을 사용하려면 PIN을 입력하세요.</span>
          <button className="block" onClick={() => setShowLogin(true)}>🔑 관리자 로그인</button>
        </div>
      )}

      {!isGuest && !isAdmin && showLogin && <AdminLogin onSuccess={() => setShowLogin(false)} />}

      {/* 이 기기 연결 (일반회원) — 관리자 승인이 실제 로그인 기준이 된 뒤로는 부가 기능이
          아니라 핵심 기능이다. 아직 연결 안 됐으면 앱 부팅 화면(DeviceConnectScreen)에서
          이미 요청했을 가능성이 높지만, 연결 상태 확인·해제 후 재요청은 여기서도 가능하다. */}
      {!isGuest && <DeviceLinkCard />}

      {!isGuest && isAdmin && (
        <>
          {/* 1. 번개모임 세션 승인 대기 (맨 위) */}
          <PendingFlashCard sessions={sessions} members={members} />

          {/* 2. 경기결과 승인 대기 (일반회원 제출 게임) */}
          <PendingGamesCard sessions={sessions} members={members} />

          {/* 3. 회원 관리 — 에버리지 직접 수정 */}
          <HandicapEditCard members={members} />

          {/* 3-1. 회원 관리 — 기기 연결 승인 (Firebase 관리자 인증 필요) */}
          <DeviceLinkAdminCard />

          {/* 3-2. 새 기기가 이름을 고를 수 있게 하는 이름 목록 만들기 (Firebase 관리자 인증 필요).
              바로 아래 "전체 복사"와 달리 이름 목록만 만든다 — 회원·모임·경기·회계는 안 건드린다. */}
          <MemberIndexBackfillCard />

          {/* 4-2. 새 저장 구조로 데이터 복사 (Firebase 관리자 인증 필요).
              기존 데이터는 그대로 두고 같은 내용을 한 벌 더 복사만 한다. */}
          <SplitMigrationCard />

          {/* 4-3. 2026-04-18 과거 대회(제2회 회장배 당구대회·챌린전) 가져오기 (Firebase 관리자
              인증 필요). 이번 단계는 dry-run까지만 — 실제 적용 버튼은 비활성화돼 있다. */}
          <TournamentApr18ImportCard />

          {/* 4-4. 2025-11-29 과거 대회(제1회 성균관대학교 부산동문 회장배 당구대회·개인전)
              가져오기 (Firebase 관리자 인증 필요). 실제 적용은 관리자가 dry-run 확인 후
              직접 버튼을 눌러야만 실행된다. */}
          <TournamentNov29ImportCard />

          {/* 5. 데이터 관리 — 회원·경기·모임·회계 변경은 이제 자동으로 서버에 저장되므로,
              평소에 눌러야 하는 버튼은 "서버 내용 받기"뿐이다. 수동 올리기는 지우지 않고 남겨
              두되(전체 복원 후·저장 실패 후에는 여전히 필요하다) 언제 쓰는지 함께 설명한다. */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>💾 데이터 관리</span>
            <span className="muted" style={{ lineHeight: 1.5 }}>
              회원·모임·경기·회계 변경 내용은 자동으로 서버에 저장됩니다.
            </span>
            {USE_SPLIT_FIRESTORE ? (
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                지금은 앱을 새로고침하면 항상 서버의 최신 내용을 자동으로 받아오므로, 아래
                수동 받기/올리기 버튼은 막아 두었습니다(잘못 누르면 여러 기기의 최신 기록이
                한쪽으로 덮어써질 위험이 있어, 안전한 방식을 다시 만들기 전까지 비활성화).
              </span>
            ) : (
              <>
                <span className="muted" style={{ lineHeight: 1.5 }}>
                  PC와 휴대폰에서 같은 내용을 보려면 아래에서 서버 내용을 받아오세요.
                </span>
                <button className="primary block" disabled={syncing} onClick={onDownloadCloud}>
                  {syncing ? '처리 중...' : '서버 내용을 이 기기로 받기'}
                </button>
                <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  서버에 저장된 내용으로 이 기기의 현재 내용을 바꿉니다.
                </span>
                <button className="block" disabled={syncing} onClick={onUploadCloud}>
                  {syncing ? '처리 중...' : '이 기기 내용을 서버에 올리기'}
                </button>
                <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  평소에는 누르지 않아도 됩니다. 아래에서 "보관한 파일로 되돌리기"를 했거나,
                  저장하지 못했다는 안내를 봤을 때만 사용하세요.
                </span>
              </>
            )}
          </div>

          {/* 6. 파일로 보관/불러오기 — 핸디 이력 CSV */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>핸디 이력 파일</span>
            <span className="muted">파일 형식: <code>이름,날짜,핸디</code></span>
            <button className="block" onClick={onExportHandicapCsv}>핸디 이력 파일 받기 (CSV)</button>
            <button className="primary block" onClick={() => hcapFileRef.current?.click()}>핸디 이력 파일 올리기 (CSV)</button>
            <input ref={hcapFileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportHandicap(f); e.target.value = '' }} />
          </div>

          {/* 7. 파일로 보관/불러오기 — 회원명부 CSV */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>👥 회원명부 파일</span>
            <span className="muted">
              파일 형식: <code>이름,에버리지</code><br/>
              엑셀 파일을 CSV로 저장한 뒤 올려 주세요.<br/>
              새 회원은 추가되고, 기존 회원은 에버리지만 바뀝니다.<br/>
              ※ 직책·학과·학번·전화번호 칸이 있어도 앱에는 저장되지 않습니다.
            </span>
            <button className="block" onClick={onExportMemberCsv}>회원명부 양식 받기 (CSV)</button>
            <button className="primary block" onClick={() => memberFileRef.current?.click()}>회원명부 파일 올리기 (CSV)</button>
            <input ref={memberFileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportMemberCsv(f); e.target.value = '' }} />
          </div>

          {/* 8. 파일로 보관/불러오기 — 경기 기록 CSV */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>🎱 경기 기록 파일</span>
            <span className="muted">파일 형식: <code>날짜,선수1,선수2,승자,패자,승자점수,패자점수</code></span>
            <button className="primary block" onClick={() => gameFileRef.current?.click()}>경기 기록 파일 올리기 (CSV)</button>
            <input ref={gameFileRef} type="file" accept=".csv,text/csv" hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; e.target.value = ''
                try {
                  const rows = await importGameCsv(f)
                  if (!confirm(`${rows.length}개 경기를 불러옵니다. 계속할까요?`)) return
                  const previous = useApp.getState()
                  applyGameCsv(rows)
                  const failed = await saveToServer(previous)
                  setMsg(failed ?? `경기 기록 ${rows.length}개를 반영했습니다.`)
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : '오류가 발생했습니다.')
                }
              }} />
          </div>

          {/* 9. 파일로 보관/불러오기 — 전체 데이터(JSON) */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>🗄️ 전체 데이터 보관하기</span>
            <span className="muted">마지막으로 보관한 때: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ko-KR') : '없음'}</span>
            <button className="primary block" onClick={onExportJson}>전체 데이터 파일로 보관하기 (JSON)</button>
            <button className="block" onClick={onExportCsv}>경기기록 엑셀로 받기 (CSV)</button>
            <button className="block" onClick={() => fileRef.current?.click()}>보관한 파일로 되돌리기 (JSON)</button>
            <input ref={fileRef} type="file" accept="application/json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
          </div>

          {/* 10. 보안 — PIN 변경 */}
          <ChangePinCard />

          {/* 11. 위험 구역 — 모든 데이터 지우기 (맨 밑) */}
          <div className="card col-card">
            <span className="muted" style={{ lineHeight: 1.5 }}>
              데이터는 이 기기에 저장되며, 서버와도 맞춰서 다른 기기에서 사용할 수 있습니다.
            </span>
            <button className="block danger" onClick={() => {
              if (confirm('모든 회원·경기 기록이 삭제됩니다. 되돌릴 수 없습니다.')) {
                replaceAll({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
                setMsg('이 기기의 모든 데이터를 지웠습니다.')
              }
            }}>모든 데이터 지우기</button>
          </div>
        </>
      )}

      {msg && <p className="info-msg">{msg}</p>}
    </div>
  )
}
