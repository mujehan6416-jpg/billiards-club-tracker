import { forwardRef, useRef, useState } from 'react'
import type { Tournament, TournamentMatch } from '../../types/tournament'
import {
  buildResultShareData, buildResultShareText,
  type ParticipantNameOf, type ResultSection, type TournamentResultShareData,
} from '../../logic/tournamentResultShare'
import { shareImage, shareText } from '../../lib/share'

export interface RestartResult {
  matches: TournamentMatch[]
  nameOf: ParticipantNameOf
}

/** "마스터즈 1위" → "1위" (부문 이름은 구역 제목에 이미 있다) */
const rankText = (label: string) => label.replace(/^(마스터즈|리스타트) /, '')

/**
 * 순위 칸 폭 — 카드 전체에서 하나로 정해, 모든 줄(하이런상 포함)의 이름 시작 위치가 세로로 같은 선에 오게 한다.
 * 보통은 "1위" 폭에 맞춰 좁게 두고, "공동 3위"가 있을 때만 넓힌다(라벨이 줄바꿈되지 않도록).
 */
export const RANK_WIDTH = 64
export const RANK_WIDTH_JOINT = 100
export const RANK_GAP = 14

/** 순위 + 이름이 같은 줄에 놓이는 한 행. 공동 순위는 이름을 같은 칸 안에서 한 줄에 한 명씩 쌓는다. */
function ResultRow({ label, value, rankWidth, testId = 'result-row' }: { label: string; value: string; rankWidth: number; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'baseline', gap: RANK_GAP, width: '100%' }}>
      <span data-testid="result-rank" style={{ fontSize: 21, fontWeight: 700, color: '#444', width: rankWidth, flexShrink: 0, whiteSpace: 'nowrap' }}>{label}</span>
      <span data-testid="result-names" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        {value.split(', ').map((name) => (
          <span key={name} style={{ fontSize: 27, fontWeight: 800, color: '#111', overflowWrap: 'anywhere', textAlign: 'left' }}>{name}</span>
        ))}
      </span>
    </div>
  )
}

/** 한 부문(마스터즈/리스타트)의 결과: 구역 제목 아래에 "1위  이름" 줄이 순서대로 이어진다. */
function CardSection({ section, rankWidth }: { section: ResultSection; rankWidth: number }) {
  return (
    <div data-testid="result-section" style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0f6e56' }}>🏆 {section.title}</div>
      {section.lines.map((l) => <ResultRow key={l.label} label={rankText(l.label)} value={l.value} rankWidth={rankWidth} />)}
      {section.notice && (
        <div style={{ fontSize: 18, fontWeight: 600, color: section.status === 'pending' ? '#856404' : '#555' }}>{section.notice}</div>
      )}
    </div>
  )
}

const divider = <div aria-hidden="true" style={{ height: 1, background: '#e3e3e3', width: '100%' }} />

/**
 * 결과 이미지 카드 — 스마트폰 카카오톡용 세로형, 흰 배경, 큰 글씨. 이 DOM 그대로를 이미지로 만든다
 * (기존 정기모임 공유와 같은 shareImage). 위쪽 제목만 가운데 정렬하고, 결과는 "1위  이름"처럼 순위와 이름을 같은 줄에
 * 왼쪽부터 가지런히 놓는다. 이름이 길어도 줄바꿈되어 잘리지 않는다.
 */
export const TournamentResultCard = forwardRef<HTMLDivElement, { tournament: Tournament; data: TournamentResultShareData }>(
  function TournamentResultCard({ tournament, data }, ref) {
    const labels = [...data.masters.lines, ...data.restart.lines].map((l) => rankText(l.label))
    const rankWidth = labels.some((l) => l.length > 3) ? RANK_WIDTH_JOINT : RANK_WIDTH
    return (
      <div
        ref={ref}
        data-testid="result-card"
        style={{
          width: 340, boxSizing: 'border-box', margin: '0 auto', padding: '24px 22px', background: '#fff',
          border: '1px solid #ddd', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 18, wordBreak: 'keep-all',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center', width: '100%' }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#0f6e56' }}>당신회</span>
          <span style={{ fontSize: 30, fontWeight: 800, color: '#111' }}>대회 경기결과</span>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#333', overflowWrap: 'anywhere' }}>{tournament.name}</span>
          <span style={{ fontSize: 16, color: '#555' }}>{tournament.date}</span>
        </div>
        {divider}
        <CardSection section={data.masters} rankWidth={rankWidth} />
        {divider}
        <CardSection section={data.restart} rankWidth={rankWidth} />
        {data.highRun && (
          <>
            {divider}
            <div data-testid="result-highrun" style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f6e56' }}>🎯 하이런상</div>
              {/* 순위 칸 자리를 비워 두고 이름을 위 결과 이름들과 같은 시작선에 놓는다 */}
              <ResultRow label="" value={data.highRun} rankWidth={rankWidth} testId="result-highrun-row" />
            </div>
          </>
        )}
      </div>
    )
  },
)

/**
 * [경기결과 공유] — 관리자 전용. 마스터즈(본선)·리스타트 최종 순위와 직접 입력한 하이런상, 그리고 본선 경기 상세로
 * ① 카카오톡에 붙여넣을 문구 ② 결과 이미지 카드를 만든다. 아무것도 저장하지 않는다
 * (하이런상 이름은 새로고침하면 사라져도 된다). 순위는 호출하는 쪽이 넘긴 경기 결과로 앱의 기존 순위 계산을 그대로 쓴다.
 */
export function TournamentResultShare({
  tournament, mastersMatches, mastersNameOf, loadRestartResult,
}: {
  tournament: Tournament
  mastersMatches: TournamentMatch[] | null
  mastersNameOf: ParticipantNameOf
  /** 리스타트 대회의 경기와 선수 이름을 읽는다(없으면 null). */
  loadRestartResult?: () => Promise<RestartResult | null>
}) {
  const [open, setOpen] = useState(false)
  const [restart, setRestart] = useState<RestartResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [highRun, setHighRun] = useState('')
  const [msg, setMsg] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    if (!loadRestartResult || loading) return
    setLoading(true)
    setLoadError(false)
    try {
      setRestart(await loadRestartResult())
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const openPanel = () => {
    setOpen(true)
    void load()
  }

  const data = buildResultShareData({
    mastersMatches, mastersNameOf,
    restartMatches: restart?.matches ?? null, restartNameOf: restart?.nameOf ?? (() => ''),
    highRun,
  })
  const text = buildResultShareText(data)

  const copyText = async () => {
    try {
      const copied = await shareText(text)
      setMsg(copied ? '복사했습니다. 카톡에 붙여넣어 주세요.' : '공유 창을 열었습니다. 카카오톡을 선택해 주세요.')
    } catch {
      setMsg('복사하지 못했습니다. 아래 문구 미리보기를 길게 눌러 직접 복사해 주세요.')
    }
  }

  const makeImage = async () => {
    if (!cardRef.current) return
    setMsg('이미지를 만드는 중입니다...')
    try {
      await shareImage(cardRef.current, `대회결과_${tournament.date}.png`, '당신회 대회 경기결과')
      setMsg('이미지를 만들었습니다. 공유 창이 안 열리면 저장된 이미지를 카톡에 보내 주세요.')
    } catch {
      setMsg('이미지를 만들지 못했습니다. 다시 시도해 주세요.')
    }
  }

  if (!open) {
    return (
      <button className="block" style={{ fontSize: 16, padding: 14, minHeight: 48 }} onClick={openPanel}>
        경기결과 공유
      </button>
    )
  }

  return (
    <div className="card col-card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 17 }}>경기결과 공유</span>
        <button type="button" style={{ fontSize: 15, padding: '10px 14px', minHeight: 44 }} onClick={() => setOpen(false)}>닫기</button>
      </div>

      {loadError && (
        <p className="info-msg" style={{ fontSize: 15, margin: 0 }}>리스타트 결과를 읽지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러와 주세요.</p>
      )}
      {loading && <span className="muted" style={{ fontSize: 15 }}>리스타트 결과를 불러오는 중입니다...</span>}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>하이런상 이름 (직접 입력)</span>
        <input
          type="text" value={highRun} placeholder="하이런상 이름"
          onChange={(e) => { setHighRun(e.target.value); setMsg('') }}
          style={{ fontSize: 18, padding: '10px 12px', minHeight: 48 }}
        />
        <span className="muted" style={{ fontSize: 14 }}>
          {data.highRun ? '이 이름은 저장되지 않고, 이번 공유 문구와 이미지에만 쓰입니다.' : '비워 두면 하이런상 줄은 빼고 만듭니다.'}
        </span>
      </label>

      <TournamentResultCard ref={cardRef} tournament={tournament} data={data} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="primary grow" style={{ fontSize: 16, minHeight: 48 }} onClick={() => void copyText()}>
          카톡용 결과 복사
        </button>
        <button type="button" className="grow" style={{ fontSize: 16, minHeight: 48 }} onClick={() => void makeImage()}>
          결과 이미지 만들기
        </button>
      </div>
      {loadRestartResult && (
        <button type="button" style={{ fontSize: 15, minHeight: 44 }} disabled={loading} onClick={() => void load()}>
          리스타트 결과 다시 불러오기
        </button>
      )}
      {msg && <p className="info-msg" style={{ fontSize: 15, margin: 0 }}>{msg}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>카톡 문구 미리보기</span>
        <pre
          data-testid="result-text-preview"
          style={{
            margin: 0, padding: 12, background: '#fafafa', border: '1px solid #e3e3e3', borderRadius: 8,
            fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit',
          }}
        >
          {text}
        </pre>
      </div>
    </div>
  )
}
