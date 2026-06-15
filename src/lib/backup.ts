import type { AppState, Member, Session } from '../types'
import { rate, winnerId } from '../logic/game'

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportJson(state: AppState, dateStr: string) {
  download(`billiards-backup-${dateStr}.json`, JSON.stringify(state, null, 2), 'application/json')
}

export function isAppState(v: unknown): v is AppState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.members) && Array.isArray(o.sessions) && typeof o.settings === 'object' && o.settings !== null
}

export async function importJson(file: File): Promise<AppState> {
  const text = await file.text()
  const parsed: unknown = JSON.parse(text)
  if (!isAppState(parsed)) throw new Error('올바른 백업 파일이 아닙니다.')
  return parsed
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const pct = (n: number) => (n * 100).toFixed(1) + '%'
const BOM = String.fromCharCode(0xfeff) // 구글 시트 한글 인코딩용

export function exportCsv(sessions: Session[], members: Member[], dateStr: string) {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id
  const header = ['날짜', '선수A', '핸디A', '득점A', '선수B', '핸디B', '득점B', '달성률A', '달성률B', '승자']
  const lines: string[] = [header.map(csvCell).join(',')]
  for (const s of sessions) {
    for (const g of s.games) {
      const win = winnerId(g)
      const cells: (string | number)[] = [
        s.date,
        name(g.playerAId),
        g.handicapA,
        g.scoreA,
        name(g.playerBId),
        g.handicapB,
        g.scoreB,
        pct(rate(g.scoreA, g.handicapA)),
        pct(rate(g.scoreB, g.handicapB)),
        win === null ? '무승부' : name(win),
      ]
      lines.push(cells.map(csvCell).join(','))
    }
  }
  download(`billiards-${dateStr}.csv`, BOM + lines.join('\n'), 'text/csv;charset=utf-8')
}


export function exportHandicapCsv(members: Member[], dateStr: string) {
  const header = ['이름', '날짜', '핸디']
  const lines: string[] = [header.map(csvCell).join(',')]
  for (const m of members) {
    const sorted = [...m.handicapHistory].sort((a, b) => a.changedAt.localeCompare(b.changedAt))
    for (const h of sorted) {
      lines.push([m.name, h.changedAt.slice(0, 10), h.value].map(csvCell).join(','))
    }
  }
  download(`billiards-handicap-${dateStr}.csv`, BOM + lines.join('\n'), 'text/csv;charset=utf-8')
}

export interface HandicapRow {
  name: string
  date: string
  handicap: number
}

export async function importHandicapCsv(file: File): Promise<HandicapRow[]> {
  const text = await file.text()
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('데이터가 없습니다.')
  const rows: HandicapRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const [name, date, handicapStr] = cols
    const handicap = parseInt(handicapStr, 10)
    if (!name || !date || isNaN(handicap)) throw new Error(`${i + 1}행 형식 오류: "${lines[i]}"`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${i + 1}행 날짜 형식 오류 (YYYY-MM-DD 필요): "${date}"`)
    rows.push({ name, date, handicap })
  }
  return rows
}
