import { useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { useAdmin } from '../store/adminStore'
import { useAuth } from '../store/authStore'
import { exportCsv, exportHandicapCsv, exportJson, exportMemberCsv, importHandicapCsv, importJson, importMemberCsv, importGameCsv } from '../lib/backup'
import { uploadToCloud, downloadFromCloud } from '../lib/cloudSync'
import { todayStr } from '../lib/date'
import { winnerId } from '../logic/game'
import { fmtScore } from '../lib/format'
import type { Member, Session } from '../types'

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

// 번개모임 승인 카드 (관리자 전용, 맨 위)
function PendingFlashCard({ sessions, members }: { sessions: Session[]; members: Member[] }) {
  const approveSession = useApp((s) => s.approveSession)
  const [expanding, setExpanding] = useState<string | null>(null)

  const pending = sessions.filter((s) => s.type === 'flash' && s.approved === false)
  if (pending.length === 0) return null

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id

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
              <button style={{ fontSize: 12 }} onClick={() => setExpanding(expanding === s.id ? null : s.id)}>
                {expanding === s.id ? '닫기' : '내용 보기'}
              </button>
              <button className="primary" style={{ fontSize: 12 }} onClick={async () => {
                if (!window.confirm(`${s.date} 번개모임 기록을 승인할까요?\n정규 통계에 반영됩니다.`)) return
                approveSession(s.id)
                const st = useApp.getState()
                try { await uploadToCloud({ members: st.members, sessions: st.sessions, settings: st.settings }) } catch { /* ignore */ }
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
    </div>
  )
}

// 에버리지(핸디) 직접 수정 카드
function HandicapEditCard({ members }: { members: Member[] }) {
  const applyHandicapCsv = useApp((s) => s.applyHandicapCsv)
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
    applyHandicapCsv([{ name: m.name, handicap: hv, date }])
    try {
      const s = useApp.getState()
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings })
      setMsg(`${m.name} 에버리지 ${hv} 반영 완료`)
    } catch {
      setMsg(`${m.name} 에버리지 ${hv} 반영 완료 (클라우드 저장 실패)`)
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

// 관리자용 회원 비밀번호 변경 카드
function AdminMemberPwCard({ members }: { members: Member[] }) {
  const setMemberPassword = useApp((s) => s.setMemberPassword)
  const PINNED = ['엄재익', '이제한']
  const sorted = [...members.filter((m) => m.active)].sort((a, b) => {
    const ai = PINNED.indexOf(a.name), bi = PINNED.indexOf(b.name)
    if (ai !== -1 || bi !== -1) { if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi }
    return a.name.localeCompare(b.name, 'ko')
  })
  const [memberId, setMemberId] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!memberId) { setMsg('회원을 선택하세요.'); return }
    if (pw.length < 4) { setMsg('비밀번호는 4자리 이상이어야 합니다.'); return }
    setSaving(true)
    setMemberPassword(memberId, pw)
    try {
      const s = useApp.getState()
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings })
      const m = members.find((x) => x.id === memberId)
      setMsg(`${m?.name ?? ''} 비밀번호 변경 완료`)
      setPw('')
    } catch {
      setMsg('변경했으나 클라우드 저장 실패')
    } finally { setSaving(false) }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>👤 회원 비밀번호 관리 (관리자)</span>
      <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setMsg('') }} style={{ width: '100%' }}>
        <option value="">회원 선택</option>
        {sorted.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <input type="text" placeholder="새 비밀번호 (4자리 이상)" value={pw}
        onChange={(e) => { setPw(e.target.value); setMsg('') }}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={{ width: '100%' }} />
      {msg && <span style={{ fontSize: 13, color: msg.includes('완료') ? '#1d9e75' : 'var(--danger)' }}>{msg}</span>}
      <button className="primary block" onClick={save} disabled={saving}>{saving ? '저장 중...' : '변경'}</button>
    </div>
  )
}

// 내 비밀번호 변경 (일반회원)
function MyPasswordCard({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { memberId } = useAuth()
  const members = useApp((s) => s.members)
  const setMemberPassword = useApp((s) => s.setMemberPassword)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const doChange = async () => {
    const me = members.find((m) => m.id === memberId)
    if (!me) return
    const curPw = me.password ?? '0000'
    if (cur !== curPw) { setMsg('현재 비밀번호가 틀렸습니다.'); return }
    if (next.length < 4) { setMsg('비밀번호는 4자리 이상이어야 합니다.'); return }
    if (next !== next2) { setMsg('새 비밀번호가 일치하지 않습니다.'); return }
    setMemberPassword(memberId!, next)
    setSaving(true); setMsg('저장 중...')
    try {
      const s = useApp.getState()
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings })
      setMsg('비밀번호가 변경되었습니다.')
      setCur(''); setNext(''); setNext2('')
    } catch {
      setMsg('변경했으나 저장에 실패했습니다. 인터넷 확인 후 다시 시도해 주세요.')
    } finally { setSaving(false) }
  }

  return (
    <div className="card col-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>🔒 내 비밀번호 변경</span>
        <button style={{ fontSize: 12 }} onClick={onToggle}>{open ? '닫기' : '변경하기'}</button>
      </div>
      {open && (
        <>
          <input type="password" placeholder="현재 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} style={{ width: '100%' }} />
          <input type="password" placeholder="새 비밀번호 (4자리 이상)" value={next} onChange={(e) => setNext(e.target.value)} style={{ width: '100%' }} />
          <input type="password" placeholder="새 비밀번호 확인" value={next2} onChange={(e) => setNext2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doChange()} style={{ width: '100%' }} />
          {msg && <span style={{ fontSize: 13, color: msg.includes('변경') ? '#1d9e75' : msg.includes('저장 중') ? 'var(--muted)' : 'var(--danger)' }}>{msg}</span>}
          <button className="primary block" onClick={doChange} disabled={saving}>{saving ? '저장 중...' : '변경'}</button>
        </>
      )}
    </div>
  )
}

export function SettingsTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const replaceAll = useApp((s) => s.replaceAll)
  const applyHandicapCsv = useApp((s) => s.applyHandicapCsv)
  const applyMemberCsv = useApp((s) => s.applyMemberCsv)
  const applyGameCsv = useApp((s) => s.applyGameCsv)
  const touchBackup = useApp((s) => s.touchBackup)
  const { isAdmin } = useAdmin()

  const fileRef = useRef<HTMLInputElement>(null)
  const hcapFileRef = useRef<HTMLInputElement>(null)
  const memberFileRef = useRef<HTMLInputElement>(null)
  const gameFileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [myPwOpen, setMyPwOpen] = useState(false)

  const onExportJson = () => {
    exportJson({ members, sessions, settings }, todayStr())
    touchBackup()
    setMsg('JSON 백업 파일을 다운로드했습니다.')
  }

  const onExportCsv = () => {
    exportCsv(sessions, members, todayStr())
    touchBackup()
    setMsg('CSV 파일을 다운로드했습니다.')
  }

  const onExportHandicapCsv = () => {
    exportHandicapCsv(members, todayStr())
    setMsg('핸디 이력 CSV를 다운로드했습니다.')
  }

  const onImport = async (file: File) => {
    try {
      const state = await importJson(file)
      if (!confirm('현재 데이터를 백업 파일로 전체 교체합니다. 계속할까요?')) return
      replaceAll(state)
      setMsg('백업을 복원했습니다.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '불러오기에 실패했습니다.')
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
      applyMemberCsv(rows)
      setMsg(`회원명부 반영 완료: ${msg}`)
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
      applyHandicapCsv(rows)
      setMsg(`핸디 이력 ${rows.length}개 행을 반영했습니다.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일 처리에 실패했습니다.')
    }
  }

  const onUploadCloud = async () => {
    if (!confirm('현재 데이터를 클라우드에 저장합니다. 계속할까요?')) return
    setSyncing(true)
    try {
      await uploadToCloud({ members, sessions, settings })
      setMsg('클라우드에 저장했습니다.')
    } catch (e) {
      setMsg('클라우드 저장 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSyncing(false) }
  }

  const onDownloadCloud = async () => {
    if (!confirm('클라우드 데이터를 불러옵니다. 현재 데이터가 교체됩니다. 계속할까요?')) return
    setSyncing(true)
    try {
      const state = await downloadFromCloud()
      if (!state) { setMsg('클라우드에 저장된 데이터가 없습니다.'); return }
      replaceAll(state)
      setMsg('클라우드에서 불러왔습니다.')
    } catch (e) {
      setMsg('클라우드 불러오기 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSyncing(false) }
  }

  return (
    <div className="tab">
      <h2 className="tab-title">설정</h2>

      {!isAdmin && !showLogin && (
        <div className="card col-card">
          <span className="muted">관리자 기능을 사용하려면 PIN을 입력하세요.</span>
          <button className="block" onClick={() => setShowLogin(true)}>🔑 관리자 로그인</button>
        </div>
      )}

      {!isAdmin && showLogin && <AdminLogin onSuccess={() => setShowLogin(false)} />}

      {/* 내 비밀번호 변경 (일반회원 항상 표시) */}
      <MyPasswordCard open={myPwOpen} onToggle={() => setMyPwOpen((v) => !v)} />

      {isAdmin && (
        <>
          {/* 1. 번개모임 승인 대기 (맨 위) */}
          <PendingFlashCard sessions={sessions} members={members} />

          {/* 2. 클라우드 동기화 */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>☁️ 클라우드 동기화</span>
            <span className="muted">PC와 휴대폰 간 데이터를 맞출 때 사용하세요.</span>
            <button className="primary block" disabled={syncing} onClick={onUploadCloud}>
              {syncing ? '처리 중...' : '클라우드에 저장 (업로드)'}
            </button>
            <button className="block" disabled={syncing} onClick={onDownloadCloud}>
              {syncing ? '처리 중...' : '클라우드에서 불러오기 (다운로드)'}
            </button>
          </div>

          {/* 3. 에버리지 직접 수정 */}
          <HandicapEditCard members={members} />

          {/* 4. 회원 비밀번호 관리 (관리자) */}
          <AdminMemberPwCard members={members} />

          {/* 5. 핸디 이력 CSV */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>핸디 이력 파일</span>
            <span className="muted">CSV 형식: <code>이름,날짜,핸디</code></span>
            <button className="block" onClick={onExportHandicapCsv}>핸디 이력 CSV 다운로드</button>
            <button className="primary block" onClick={() => hcapFileRef.current?.click()}>핸디 이력 CSV 업로드</button>
            <input ref={hcapFileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportHandicap(f); e.target.value = '' }} />
          </div>

          {/* 6. 회원명부 CSV */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>👥 회원명부 CSV</span>
            <span className="muted">
              형식: <code>이름,에버리지,직책,학과,학번,전화번호</code><br/>
              엑셀 파일을 CSV로 저장 후 업로드 하세요.<br/>
              신규 회원은 추가, 기존 회원은 에버리지만 업데이트됩니다.
            </span>
            <button className="block" onClick={onExportMemberCsv}>회원명부 CSV 양식 다운로드</button>
            <button className="primary block" onClick={() => memberFileRef.current?.click()}>회원명부 CSV 업로드</button>
            <input ref={memberFileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportMemberCsv(f); e.target.value = '' }} />
          </div>

          {/* 7. 경기 기록 CSV */}
          <div className="card col-card">
            <span style={{ fontWeight: 600, fontSize: 14 }}>🎱 경기 기록 CSV 업로드</span>
            <span className="muted">형식: <code>날짜,선수1,선수2,승자,패자,승자점수,패자점수</code></span>
            <button className="primary block" onClick={() => gameFileRef.current?.click()}>경기 기록 CSV 업로드</button>
            <input ref={gameFileRef} type="file" accept=".csv,text/csv" hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; e.target.value = ''
                try {
                  const rows = await importGameCsv(f)
                  if (!confirm(`${rows.length}개 경기를 불러옵니다. 계속할까요?`)) return
                  applyGameCsv(rows)
                  setMsg(`경기 기록 ${rows.length}개를 반영했습니다.`)
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : '오류가 발생했습니다.')
                }
              }} />
          </div>

          {/* 8. 백업/복원 */}
          <div className="card col-card">
            <span className="muted">마지막 백업: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ko-KR') : '없음'}</span>
            <button className="primary block" onClick={onExportJson}>JSON 백업 다운로드</button>
            <button className="block" onClick={onExportCsv}>CSV 다운로드 (엑셀용)</button>
            <button className="block" onClick={() => fileRef.current?.click()}>백업 불러오기 (JSON)</button>
            <input ref={fileRef} type="file" accept="application/json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
          </div>

          {/* 9. PIN 변경 */}
          <ChangePinCard />

          {/* 10. 전체 초기화 (맨 밑) */}
          <div className="card col-card">
            <span className="muted">데이터는 이 기기(브라우저)에만 저장됩니다.</span>
            <button className="block danger" onClick={() => {
              if (confirm('모든 회원·경기 기록이 삭제됩니다. 되돌릴 수 없습니다.')) {
                replaceAll({ members: [], sessions: [], settings: { lastBackupAt: null } })
                setMsg('전체 데이터를 초기화했습니다.')
              }
            }}>전체 초기화</button>
          </div>
        </>
      )}

      {msg && <p className="info-msg">{msg}</p>}
    </div>
  )
}
