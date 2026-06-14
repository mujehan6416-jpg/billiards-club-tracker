import { toPng } from 'html-to-image'
import type { Member, Session } from '../types'
import { rate, winnerId } from '../logic/game'

interface ShareNav {
  share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>
  canShare?: (data: { files?: File[] }) => boolean
}

/** DOM 노드를 PNG로 만들어 공유(가능 시) 또는 다운로드. */
export async function shareImage(node: HTMLElement, filename: string) {
  const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2 })
  const nav = navigator as Navigator & ShareNav
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const file = new File([blob], filename, { type: 'image/png' })
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: '당구 모임 결과' })
      return
    }
  } catch {
    // 공유 실패 시 다운로드로 폴백
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

const pct = (n: number) => (n * 100).toFixed(0) + '%'

/** 모임 결과를 카톡 등에 붙일 텍스트로 변환. */
export function buildResultText(session: Session, members: Member[]): string {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id
  const lines = [`[${session.date} 당구 모임 결과]`, '']
  if (session.games.length === 0) {
    lines.push('아직 경기 없음')
  } else {
    session.games.forEach((g, i) => {
      const win = winnerId(g)
      const mark = (id: string) => (win === id ? ' (승)' : '')
      lines.push(
        `${i + 1}. ${name(g.playerAId)} ${g.scoreA}/${g.handicapA}(${pct(rate(g.scoreA, g.handicapA))})${mark(g.playerAId)}` +
          ` vs ${name(g.playerBId)} ${g.scoreB}/${g.handicapB}(${pct(rate(g.scoreB, g.handicapB))})${mark(g.playerBId)}`,
      )
    })
  }
  return lines.join('\n')
}

/** 텍스트 공유(가능 시) 또는 클립보드 복사. 복사면 true 반환. */
export async function shareText(text: string): Promise<boolean> {
  const nav = navigator as Navigator & ShareNav
  try {
    if (nav.share) {
      await nav.share({ text })
      return false
    }
  } catch {
    // 폴백
  }
  await navigator.clipboard.writeText(text)
  return true
}
