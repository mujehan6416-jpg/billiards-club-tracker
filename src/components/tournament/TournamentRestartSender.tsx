import { useEffect, useRef, useState } from 'react'
import type { Tournament, TournamentParticipant } from '../../types/tournament'
import {
  findRestartTarget, isAlreadyInTarget, normalizeTournamentName, planRestartTransfer, restartTargetState,
  restartTournamentName, type RestartCandidate,
} from '../../logic/tournamentRestart'
import type { RestartFirstRoundStatus, RestartJoinStatus } from '../../logic/tournamentRestartBracket'

/** 리스타트 대진 자동 생성 가능 여부 안내. ok:false면 이유를 그대로 보여준다. */
export type RestartBracketPlan =
  | {
    ok: true
    status: RestartFirstRoundStatus
    w: number
    entrants: number
    joinLabel: string
    /** 본선 1차 탈락자(최종 승인된 실제 패자) 이름 — 리스타트 1차전 대상자. 부전승 선수는 없다. */
    firstRoundLosers: { memberId: string; name: string }[]
    /** 본선 2차(예: 8강) 탈락자 합류 현황 — 1차전 대상자와 섞지 않고 따로 보여준다. */
    joinRows: { key: string; matchNumber: number; name: string | null; status: RestartJoinStatus }[]
  }
  | { ok: false; message: string }

export interface RestartSendResult {
  added: number
  alreadyIn: number
  failed: number
}

// ── 관리자 진단용: 지금 이 폰이 실행 중인 앱 버전과 서버의 최신 버전 비교 ──
// 홈 화면 앱(PWA)은 서비스워커가 옛 화면을 먼저 보여 주고 새 버전은 백그라운드에서 받아 두었다가 앱을 다시 열어야
// 적용된다. 그래서 새로 배포했는데도 폰이 옛 버전을 쓰고 있는 일이 생길 수 있다. 번들 파일 이름의 해시가 버전이다.
function runningBuildId(): string {
  try {
    const src = Array.from(document.scripts).map((s) => s.src).find((s) => /\/assets\/index-.+\.js/.test(s))
    return src?.match(/index-(.+?)\.js/)?.[1] ?? '개발 실행'
  } catch {
    return '알 수 없음'
  }
}

async function fetchLatestBuildId(): Promise<string | null> {
  try {
    if (typeof fetch !== 'function') return null
    // 주소에 값을 붙여 서비스워커·브라우저 캐시를 거치지 않고 서버의 index.html을 읽는다.
    const res = await fetch(new URL(`index.html?check=${Date.now()}`, document.baseURI).toString(), { cache: 'no-store' })
    const html = await res.text()
    return html.match(/assets\/index-(.+?)\.js/)?.[1] ?? null
  } catch {
    return null
  }
}

const JOIN_STATUS_TEXT: Record<RestartJoinStatus, { text: string; color: string }> = {
  pending: { text: '승인 대기', color: '#856404' },
  waiting: { text: '합류 대기', color: '#1a56db' },
  joined: { text: '합류 완료', color: '#0f6e56' },
}

/**
 * [리스타트 참가자 보내기] — 관리자 전용.
 *
 * 리스타트 대회는 운영진이 고르지 않는다. 현재 본선 대회 이름 + " 리스타트전"과 이름이 정확히 같은
 * 대회를 자동으로 찾는다(logic/tournamentRestart.ts findRestartTarget). 없거나 같은 이름이 여러 개면
 * 안내만 보여주고 아무것도 하지 않는다.
 *
 * - 자동 대진이 가능한 본선(bracketPlan.ok): 본선 1차 탈락자 = 리스타트 1차전 대상자, 본선 2차(8강) 탈락자 =
 *   "합류" 영역(이름과 합류 상태만 표시, 슬롯 배치는 프로그램이 최종 승인 시 자동으로 한다).
 * - 그 밖의 인원: 최종 승인된 탈락자 중 직접 체크한 사람만 리스타트 대회 참가자로 보낸다(수동 방식).
 *
 * 화면 흐름만 맡는다. 판정은 logic/*, 저장은 상위(TournamentTab)가 기존 함수로 한다.
 * 이미 보낸 뒤 본선 결과를 정정해도 리스타트 쪽 참가자는 자동으로 바뀌지 않는다.
 */
export function TournamentRestartSender({
  currentTournament, candidates, tournaments, loadTargetParticipants, onSend, bracketPlan, onCreateBracket,
  onPrepareTarget,
}: {
  currentTournament: Tournament
  candidates: RestartCandidate[]
  tournaments: Tournament[]
  loadTargetParticipants: (targetId: string) => Promise<TournamentParticipant[]>
  onSend: (targetId: string, memberIds: string[]) => Promise<RestartSendResult>
  /** 리스타트 대진 자동 생성 안내(없으면 수동 방식만 쓴다). */
  bracketPlan?: RestartBracketPlan
  /** 대상 대회의 리스타트 대진을 자동 생성하고 완료 안내 문구를 돌려준다. 실패하면 Error를 던진다. */
  onCreateBracket?: (targetId: string) => Promise<string>
  /**
   * 리스타트 대회를 준비한다 — 대회 목록을 서버에서 새로 읽어 `본선 이름 + " 리스타트전"` 대회가 있으면 그대로
   * 쓰고, 없으면 자동으로 만든다(없을 때만 생성하는 트랜잭션이라 여러 번·여러 기기에서 열어도 한 개뿐이다).
   * 이 패널을 열 때와 "리스타트 대회 다시 준비"를 누를 때 부른다. 대상 대회를 고르는 기능이 아니다.
   * 실패하면 Error(화면에 그대로 보여줄 문장)를 던진다.
   */
  onPrepareTarget?: () => Promise<{ created: boolean }>
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [targetParticipants, setTargetParticipants] = useState<TournamentParticipant[] | null>(null)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [prepareError, setPrepareError] = useState('')
  const [autoCreated, setAutoCreated] = useState(false)
  const prepareInFlight = useRef(false)
  const [latestBuildId, setLatestBuildId] = useState<string | null>(null)

  const lookup = findRestartTarget(currentTournament, tournaments)
  const others = tournaments.filter((t) => t.id !== currentTournament.id)
  const buildId = runningBuildId()
  const target = lookup.kind === 'found' ? lookup.tournament : null
  const targetState = target ? restartTargetState(target, currentTournament.id) : null
  const created = !!target && target.status === 'bracketFixed' && target.restartSourceTournamentId === currentTournament.id
  const canAdd = !!targetState?.selectable
  const plan = planRestartTransfer(selected, targetParticipants ?? [])
  const auto = !!bracketPlan && bracketPlan.ok

  // 대상 대회가 자동으로 정해지면 그 대회의 참가자를 바로 읽어 "이미 참가 중" 표시에 쓴다.
  const targetId = target?.id ?? null
  useEffect(() => {
    if (!open || !targetId || !canAdd) { setTargetParticipants(null); return }
    let cancelled = false
    loadTargetParticipants(targetId)
      .then((list) => {
        if (cancelled) return
        setTargetParticipants(list)
        setSelected((prev) => prev.filter((id) => !isAlreadyInTarget(id, list)))
      })
      .catch(() => { if (!cancelled) setMessage('리스타트 대회 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.') })
    return () => { cancelled = true }
    // loadTargetParticipants는 매 렌더마다 새로 만들어지므로 의존성에서 뺀다(대회가 바뀔 때만 다시 읽는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId, canAdd])

  const prepareTarget = async () => {
    if (!onPrepareTarget || prepareInFlight.current) return // 같은 화면에서 여러 번 눌러도 한 번만 처리한다
    prepareInFlight.current = true
    setPreparing(true)
    setPrepareError('')
    try {
      const result = await onPrepareTarget()
      if (result.created) setAutoCreated(true)
    } catch (e) {
      setPrepareError(e instanceof Error && e.message ? e.message : '리스타트 대회를 자동으로 만들지 못했습니다. 다시 시도해 주세요.')
    } finally {
      prepareInFlight.current = false
      setPreparing(false)
    }
  }

  // 패널을 열면 리스타트 대회를 준비한다(있으면 연결, 없으면 자동 생성 후 연결).
  useEffect(() => {
    if (open) {
      void prepareTarget()
      void fetchLatestBuildId().then(setLatestBuildId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  const createBracket = async () => {
    if (!target || !onCreateBracket || working) return
    if (!window.confirm(
      [
        `'${target.name}' 대회의 리스타트 대진을 자동으로 만듭니다.`,
        '',
        '본선 1차 탈락자로 1차전을 만들고, 다음 단계에 본선 탈락자가 들어올 자리를 미리 만듭니다.',
        '한 번 만들면 다시 섞이지 않습니다. 진행하시겠습니까?',
      ].join('\n'),
    )) return
    setWorking(true)
    setMessage('')
    try {
      setMessage(await onCreateBracket(target.id))
      setSelected([])
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : '대진을 만들지 못했습니다. 인터넷 연결과 관리자 로그인 상태를 확인해 주세요.')
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

  const heading = (text: string) => <div style={{ fontWeight: 700, fontSize: 16 }}>{text}</div>

  return (
    <div className="card col-card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 17 }}>리스타트 참가자 보내기</span>
        <button type="button" style={{ fontSize: 15, padding: '10px 14px', minHeight: 44 }} onClick={() => setOpen(false)}>닫기</button>
      </div>

      {/* ── 리스타트 대회(자동 연결): 찾는 이름과 연결 결과를 항상 보여준다 ── */}
      {heading('리스타트 대회 (자동 연결)')}
      <span className="muted" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
        리스타트 대회 이름: {restartTournamentName(currentTournament.name)}
      </span>
      {/* 진단 정보(관리자 전용): 연결이 안 될 때 원인(구버전·이름 불일치)을 바로 구분하기 위한 최소 정보 */}
      <div className="muted" style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 2, overflowWrap: 'anywhere' }}>
        <span>
          앱 버전: {buildId}
          {latestBuildId && buildId !== '개발 실행' && (buildId === latestBuildId ? ' (최신 버전)' : ` — 새 버전(${latestBuildId})이 있습니다. 앱을 완전히 종료한 뒤 다시 열어 주세요.`)}
        </span>
        <span>읽은 대회 {tournaments.length}개</span>
        {lookup.kind === 'missing' && !preparing && prepareError && others.length > 0 && (
          <>
            <span>읽은 다른 대회 이름:</span>
            {others.slice(0, 10).map((t) => (
              <span key={t.id}>
                「{t.name}」{normalizeTournamentName(t.name) !== t.name ? ' ※ 앞뒤 공백·눈에 안 보이는 문자가 있어 정리해서 비교함' : ''}
              </span>
            ))}
          </>
        )}
      </div>
      {lookup.kind === 'ambiguous' ? (
        <>
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#c0392b' }}>같은 이름의 리스타트 대회가 여러 개 있습니다.</p>
          <span style={{ fontSize: 15 }}>불필요한 대회를 정리한 뒤 다시 시도해 주세요. (새 대회는 만들지 않았습니다)</span>
        </>
      ) : lookup.kind === 'missing' ? (
        // 없으면 앱이 자동으로 만든다. 운영자가 만들어야 한다는 안내는 하지 않는다.
        prepareError && !preparing ? (
          <>
            <p style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#c0392b' }}>{prepareError}</p>
            <button type="button" className="primary" style={{ fontSize: 16, padding: '12px 14px', minHeight: 48 }} onClick={() => void prepareTarget()}>
              리스타트 대회 다시 준비
            </button>
          </>
        ) : (
          <span style={{ fontSize: 16, fontWeight: 700 }}>리스타트 대회를 준비하고 있습니다.</span>
        )
      ) : (
        <>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0f6e56' }}>연결된 리스타트 대회{autoCreated ? ' (자동 생성됨)' : ''}</span>
          <span style={{ fontSize: 17, fontWeight: 700, overflowWrap: 'anywhere' }}>{lookup.tournament.name}</span>
          {created ? (
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0f6e56' }}>
              ✅ 리스타트 대진이 이미 만들어졌습니다. 본선 탈락자는 아래 합류 현황대로 자동 배치됩니다.
            </span>
          ) : (
            targetState && !targetState.selectable && <span className="muted" style={{ fontSize: 15 }}>{targetState.reason}</span>
          )}
        </>
      )}

      {lookup.kind === 'found' && auto && bracketPlan.ok && (
        <>
          {/* ── 본선 1차 탈락자 = 리스타트 1차전 대상자 ── */}
          {!created && (
            <>
              {heading(`리스타트 1차전 대상자 (${bracketPlan.firstRoundLosers.length}명)`)}
              <span className="muted" style={{ fontSize: 15 }}>
                본선 1차 경기 {bracketPlan.status.officialCount} / {bracketPlan.status.total} 최종 승인
                {bracketPlan.status.ready ? '' : ' — 모두 승인되면 대진을 만들 수 있습니다.'}
              </span>
              {bracketPlan.firstRoundLosers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {bracketPlan.firstRoundLosers.map((c) => {
                    const already = !!targetParticipants && isAlreadyInTarget(c.memberId, targetParticipants)
                    return (
                      <div key={c.memberId} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                        <span style={{ fontSize: 17, fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{c.name}</span>
                        {already && <span style={{ fontSize: 15, fontWeight: 700, color: '#0f6e56' }}>참가 중</span>}
                      </div>
                    )
                  })}
                </div>
              )}
              {bracketPlan.status.ready && (
                <span className="muted" style={{ fontSize: 15 }}>
                  {`이 ${bracketPlan.entrants}명으로 1차전을 자동으로 만들고`}
                  {bracketPlan.w * 2 > bracketPlan.entrants ? `(부전승 ${bracketPlan.w * 2 - bracketPlan.entrants}명은 추첨으로 자동 배정)` : ''}
                  {`, 다음 단계에 ${bracketPlan.joinLabel.replace(' 합류 예정', '')} 자리 ${bracketPlan.w}개를 미리 만듭니다.`}
                </span>
              )}
              {onCreateBracket && (
                <button
                  className="primary block" style={{ fontSize: 17, padding: 14, minHeight: 48 }}
                  disabled={!bracketPlan.status.ready || !canAdd || working}
                  onClick={() => void createBracket()}
                >
                  {working ? '처리 중...' : '리스타트 대진 자동 생성'}
                </button>
              )}
            </>
          )}

          {/* ── 본선 2차(8강) 탈락자 합류 — 1차전 대상자와 섞지 않는다 ── */}
          {heading(`${bracketPlan.joinLabel.replace(' 합류 예정', '')} → 리스타트 합류`)}
          <span className="muted" style={{ fontSize: 15 }}>
            최종 승인되면 프로그램이 예약된 자리에 자동으로 배치합니다. 직접 고르지 않습니다.
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bracketPlan.joinRows.map((row) => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {row.name ?? `경기 ${row.matchNumber} 결과 대기`}
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: JOIN_STATUS_TEXT[row.status].color }}>
                  {JOIN_STATUS_TEXT[row.status].text}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── 자동 대진이 불가능한 인원: 직접 체크해서 보내는 수동 방식 ── */}
      {lookup.kind === 'found' && !auto && (
        <>
          {bracketPlan && !bracketPlan.ok && <span className="muted" style={{ fontSize: 15 }}>{bracketPlan.message}</span>}
          <span className="muted" style={{ fontSize: 15 }}>
            최종 승인된 탈락자 중에서 직접 고른 사람만 리스타트 대회의 참가자로 추가됩니다.
          </span>
          {candidates.length === 0 ? (
            <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>아직 리스타트 대상이 되는 확정 탈락자가 없습니다.</p>
          ) : (
            <>
              {heading('보낼 사람 (최종 승인된 탈락자)')}
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
                        checked={selected.includes(c.memberId)} disabled={already || working || !canAdd}
                        onChange={() => toggle(c.memberId)}
                      />
                      <span style={{ fontSize: 17, fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{c.name}</span>
                      {already && <span style={{ fontSize: 15, fontWeight: 700, color: '#0f6e56' }}>이미 참가 중</span>}
                    </label>
                  )
                })}
              </div>
              <button
                className="primary block" style={{ fontSize: 17, padding: 14, minHeight: 48 }}
                disabled={!canAdd || plan.toAdd.length === 0 || working}
                onClick={() => void send()}
              >
                {working ? '처리 중...' : plan.toAdd.length > 0 ? `선택한 ${plan.toAdd.length}명 보내기` : '보낼 사람을 선택해 주세요'}
              </button>
            </>
          )}
        </>
      )}

      {message && <p className="info-msg" style={{ fontSize: 16, margin: 0 }}>{message}</p>}
    </div>
  )
}
