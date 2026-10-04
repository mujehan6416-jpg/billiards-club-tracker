import { useState } from 'react'
import type { Tournament, TournamentParticipant } from '../../types/tournament'
import {
  isAlreadyInTarget, planRestartTransfer, restartTargetState,
  type RestartCandidate,
} from '../../logic/tournamentRestart'

export interface RestartSendResult {
  added: number
  alreadyIn: number
  failed: number
}

/**
 * [리스타트 참가자 보내기] — 관리자 전용. 본선 대회에서 최종 승인된 탈락자 중 운영진이 직접
 * 체크한 사람만 다른 대회(리스타트 대회)의 참가자로 보낸다. 자동으로 보내지 않는다.
 *
 * 이 컴포넌트는 화면 흐름만 맡는다. 후보·대상·중복 판정은 logic/tournamentRestart.ts,
 * 실제 저장은 상위(TournamentTab)가 기존 참가자 추가 함수로 한다.
 * 이미 보낸 뒤 본선 결과를 정정해도 리스타트 쪽 참가자는 자동으로 바뀌지 않는다.
 */
export function TournamentRestartSender({
  currentTournamentId, candidates, tournaments, loadTargetParticipants, onSend,
}: {
  currentTournamentId: string
  candidates: RestartCandidate[]
  tournaments: Tournament[]
  loadTargetParticipants: (targetId: string) => Promise<TournamentParticipant[]>
  onSend: (targetId: string, memberIds: string[]) => Promise<RestartSendResult>
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [targetId, setTargetId] = useState<string | null>(null)
  const [targetParticipants, setTargetParticipants] = useState<TournamentParticipant[] | null>(null)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  const others = tournaments.filter((t) => t.id !== currentTournamentId)
  const target = others.find((t) => t.id === targetId) ?? null
  const plan = planRestartTransfer(selected, targetParticipants ?? [])

  const pickTarget = async (t: Tournament) => {
    if (!restartTargetState(t, currentTournamentId).selectable) return
    setMessage('')
    setTargetId(t.id)
    setTargetParticipants(null)
    setWorking(true)
    try {
      const list = await loadTargetParticipants(t.id)
      setTargetParticipants(list)
      setSelected((prev) => prev.filter((id) => !isAlreadyInTarget(id, list)))
    } catch {
      setTargetId(null)
      setMessage('대상 대회 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')
    } finally {
      setWorking(false)
    }
  }

  const toggle = (memberId: string) => {
    setMessage('')
    setSelected((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]))
  }

  const send = async () => {
    if (!target || plan.toAdd.length === 0 || working) return
    if (!window.confirm(`선택한 ${plan.toAdd.length}명을\n'${target.name}'\n참가자로 추가하시겠습니까?`)) return
    setWorking(true)
    setMessage('')
    try {
      const result = await onSend(target.id, plan.toAdd)
      setSelected([])
      setTargetParticipants(await loadTargetParticipants(target.id))
      const parts = [`리스타트 대회에 ${result.added}명을 추가했습니다.`]
      if (result.alreadyIn > 0) parts.push(`${result.alreadyIn}명은 이미 참가 중이었습니다.`)
      if (result.failed > 0) parts.push(`${result.failed}명은 추가하지 못했습니다. 다시 시도해 주세요.`)
      setMessage(parts.join(' '))
    } catch {
      setMessage('처리하지 못했습니다. 인터넷 연결과 관리자 로그인 상태를 확인해 주세요.')
    } finally {
      setWorking(false)
    }
  }

  if (!open) {
    return (
      <button className="block" style={{ fontSize: 16, padding: 14, minHeight: 48 }} onClick={() => setOpen(true)}>
        리스타트 참가자 보내기
      </button>
    )
  }

  return (
    <div className="card col-card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 17 }}>리스타트 참가자 보내기</span>
        <button type="button" style={{ fontSize: 15, padding: '10px 14px', minHeight: 44 }} onClick={() => setOpen(false)}>닫기</button>
      </div>
      <span className="muted" style={{ fontSize: 15 }}>
        최종 승인된 탈락자 중에서 직접 고른 사람만 다른 대회의 참가자로 추가됩니다. 자동으로 보내지지 않습니다.
      </span>

      {candidates.length === 0 ? (
        <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>아직 리스타트 대상이 되는 확정 탈락자가 없습니다.</p>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontSize: 16 }}>1. 보낼 사람 (최종 승인된 탈락자)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map((c) => {
              const already = !!targetParticipants && isAlreadyInTarget(c.memberId, targetParticipants)
              return (
                <label
                  key={c.memberId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 12px',
                    border: '1px solid var(--border)', borderRadius: 8, opacity: already ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox" style={{ width: 26, height: 26, flexShrink: 0 }}
                    checked={selected.includes(c.memberId)} disabled={already || working}
                    onChange={() => toggle(c.memberId)}
                  />
                  <span style={{ fontSize: 17, fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{c.name}</span>
                  {already && <span style={{ fontSize: 15, fontWeight: 700, color: '#0f6e56' }}>이미 참가 중</span>}
                </label>
              )
            })}
          </div>

          <div style={{ fontWeight: 700, fontSize: 16 }}>2. 보낼 대회 (직접 선택)</div>
          {others.length === 0 ? (
            <p style={{ fontSize: 15, margin: 0 }}>보낼 수 있는 다른 대회가 없습니다. 리스타트 대회를 먼저 만들어 주세요.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {others.map((t) => {
                const state = restartTargetState(t, currentTournamentId)
                return (
                  <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button
                      type="button" className={t.id === targetId ? 'primary' : ''}
                      style={{ fontSize: 16, padding: '12px 14px', minHeight: 48, textAlign: 'left', overflowWrap: 'anywhere' }}
                      disabled={!state.selectable || working}
                      onClick={() => void pickTarget(t)}
                    >
                      {t.name}
                    </button>
                    {!state.selectable && <span className="muted" style={{ fontSize: 14 }}>{state.reason}</span>}
                  </div>
                )
              })}
            </div>
          )}

          <button
            className="primary block" style={{ fontSize: 17, padding: 14, minHeight: 48 }}
            disabled={!target || plan.toAdd.length === 0 || working}
            onClick={() => void send()}
          >
            {working ? '처리 중...' : plan.toAdd.length > 0 ? `선택한 ${plan.toAdd.length}명 보내기` : '보낼 사람과 대회를 선택해 주세요'}
          </button>
        </>
      )}

      {message && <p className="info-msg" style={{ fontSize: 16, margin: 0 }}>{message}</p>}
    </div>
  )
}
