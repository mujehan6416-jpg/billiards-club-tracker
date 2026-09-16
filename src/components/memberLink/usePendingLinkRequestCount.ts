import { useEffect } from 'react'
import { create } from 'zustand'
import { fetchPendingRequests } from '../../lib/memberLink'
import { useAdminAuthStore } from '../../store/adminAuthStore'

/**
 * 관리자에게 보여줄 "기기등록 요청 대기 건수"를 여러 화면이 함께 쓰는 아주 작은 상태.
 *
 * 알림 전용 collection은 만들지 않는다 — 기존 clubs/{clubId}/linkRequests 문서 개수가 곧
 * 대기 건수다. 승인·거절하면 그 요청 문서가 삭제되므로(lib/memberLink.ts) 다음 조회에서
 * 숫자가 자연스럽게 줄어든다. 읽음/안읽음 같은 별도 상태를 관리할 필요가 없다.
 *
 * 상단 알림(App.tsx)과 승인 카드(DeviceLinkAdminCard)는 화면 위치가 서로 멀어서 props로
 * 숫자를 넘기기 어렵다. 그래서 기존에 쓰던 zustand로 작은 store 하나만 둔다 — 승인 카드가
 * 목록을 새로 불러올 때마다 setCount()로 같은 값을 알려주므로, 상단 숫자가 2분 주기를
 * 기다리지 않고 즉시 줄어든다.
 */

/** 대기 건수를 다시 세는 주기. 기기등록은 하루에 몇 건 없는 작업이라 2분이면 충분하다. */
export const PENDING_POLL_INTERVAL_MS = 2 * 60 * 1000

interface PendingLinkRequestState {
  count: number
  /**
   * 서버가 이 기기의 목록 조회를 거부한 상태(permission-denied). 이 경우 같은 요청을 계속
   * 되풀이해도 결과가 달라지지 않으므로 주기 조회를 멈춘다 — 관리자 인증 상태가 다시
   * 바뀔 때만 풀린다.
   */
  blocked: boolean
  setCount: (count: number) => void
  refresh: () => Promise<void>
  reset: () => void
}

/**
 * 같은 순간에 조회가 겹치지 않게 하는 잠금(예: 설정 탭 진입과 주기 조회가 동시에 일어날 때).
 * 화면 개수와 무관하게 서버 조회는 한 번만 나간다.
 */
let inFlight: Promise<void> | null = null

export const usePendingLinkRequestStore = create<PendingLinkRequestState>()((set, get) => ({
  count: 0,
  blocked: false,

  /** 승인 카드가 이미 불러온 목록의 개수를 그대로 알려줄 때 사용한다(추가 조회 없음). */
  setCount: (count) => set({ count }),

  reset: () => set({ count: 0, blocked: false }),

  refresh: async () => {
    // Firestore 규칙상 linkRequests 목록 조회는 Firebase 관리자(admins/{uid}.active)만 가능하다.
    // 관리자 번호(PIN)만 켜진 기기나 일반 회원 기기에서는 아예 요청을 보내지 않는다.
    if (useAdminAuthStore.getState().status !== 'authorizedAdmin') return
    if (get().blocked) return
    if (inFlight) return inFlight

    inFlight = (async () => {
      try {
        const requests = await fetchPendingRequests()
        set({ count: requests.length })
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'permission-denied') {
          // 권한이 없는 상태 — 숫자를 감추고 되풀이 조회를 멈춘다.
          set({ count: 0, blocked: true })
        }
        // 네트워크 오류 등 일시적인 실패는 기존 숫자를 그대로 두고 다음 주기에 다시 시도한다.
      } finally {
        inFlight = null
      }
    })()

    return inFlight
  },
}))

/**
 * 상단 알림에서 쓰는 훅. Firebase 관리자로 인증된 동안에만 조회하고, 그 상태가 아니면
 * 항상 0을 돌려준다(일반 회원 화면에 관리자용 숫자가 새어 나가지 않게 한다).
 */
export function usePendingLinkRequestCount(): number {
  const status = useAdminAuthStore((s) => s.status)
  const count = usePendingLinkRequestStore((s) => s.count)

  useEffect(() => {
    if (status !== 'authorizedAdmin') {
      // 관리자 로그아웃·일반 회원 상태 — 남아 있던 숫자를 지우고 주기 조회도 걸지 않는다.
      usePendingLinkRequestStore.getState().reset()
      return
    }

    // 관리자 인증이 새로 확인된 시점이므로, 이전에 막혀 있었다면 한 번 더 시도해 본다.
    usePendingLinkRequestStore.setState({ blocked: false })
    void usePendingLinkRequestStore.getState().refresh()

    const timer = setInterval(() => {
      void usePendingLinkRequestStore.getState().refresh()
    }, PENDING_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [status])

  return status === 'authorizedAdmin' ? count : 0
}
