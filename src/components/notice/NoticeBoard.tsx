import { useCallback, useEffect, useState } from 'react'
import { useAdmin } from '../../store/adminStore'
import { useApp } from '../../store/appStore'
import { currentAuthUid } from '../../lib/appAuth'
import { getLinkedMemberId } from '../../lib/memberLink'
import {
  createNotice, deleteNotice, fetchMyReadNoticeIds, fetchNotices, markNoticeRead,
  setNoticePinned, updateNoticeText,
} from '../../lib/noticeFirestore'
import { HOME_PINNED_LIMIT, pinnedCount, selectHomeNotices } from '../../logic/notices'
import type { Notice } from '../../types/notice'

/**
 * 홈 공지 게시판.
 *
 * 공지를 쓰고 고치고 지우고 고정하는 일은 관리자만 한다. 연결된 회원은 읽기만 하고,
 * 읽은 글은 본인 기록으로 남는다.
 *
 * 화면에서 버튼을 감추는 것은 편의일 뿐이고, 실제 권한은 firestore.rules가 서버에서 막는다
 * (회원이 공지를 직접 만들거나 고치거나 지우는 일, 남의 읽음 기록을 고치는 일은 규칙에서
 *  거부된다 — tests/rules/notices.rules.test.ts 참고).
 */

const labelStyle = { fontSize: 13, color: '#666' } as const

const actionButton = {
  minHeight: 44,
  padding: '10px 16px',
  fontSize: 15,
  borderRadius: 10,
  border: '1px solid #cfd8dc',
  background: '#fff',
  color: '#072B61',
  cursor: 'pointer',
} as const

const primaryButton = {
  ...actionButton,
  background: '#0f6e56',
  border: '1px solid #0f6e56',
  color: '#fff',
  fontWeight: 600,
} as const

const inputStyle = {
  width: '100%',
  fontSize: 16,
  padding: '12px 12px',
  borderRadius: 10,
  border: '1px solid #cfd8dc',
  boxSizing: 'border-box' as const,
}

export function NoticeBoard() {
  const { isAdmin } = useAdmin()
  const members = useApp((s) => s.members)

  const [notices, setNotices] = useState<Notice[]>([])
  const [readIds, setReadIds] = useState<string[]>([])
  const [linkedMemberId, setLinkedMemberId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  /** null이면 목록만. 'new'면 새 공지 작성, 그 밖에는 그 id의 공지를 수정 중. */
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')

  /**
   * 표시용 작성자 이름.
   *
   * 회원으로 확인된 글은 회원 목록의 "현재" 이름을 쓴다 — 이름이 바뀌면 지난 공지도 바뀐
   * 이름으로 보인다. 회원을 찾을 수 없으면 저장된 이름을 그대로 쓴다(확인되지 않은 관리자
   * 기기가 올린 글은 여기서 '관리자'로 보인다).
   */
  const displayAuthor = useCallback(
    (n: Notice) =>
      (n.authorMemberId && members.find((m) => m.id === n.authorMemberId)?.name) || n.authorName,
    [members],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const uid = currentAuthUid()
      const linked = uid ? await getLinkedMemberId(uid).catch(() => null) : null
      setLinkedMemberId(linked)
      setNotices(await fetchNotices())
      setReadIds(linked ? await fetchMyReadNoticeIds(linked).catch(() => []) : [])
    } catch {
      setError('공지를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const homeItems = selectHomeNotices(notices, readIds)
  const pinnedNow = pinnedCount(notices)

  /** 글을 펼치면 읽음으로 기록한다. 연결된 회원일 때만 서버에 남긴다. */
  const openNotice = async (n: Notice) => {
    if (openId === n.id) { setOpenId(null); return }
    setOpenId(n.id)
    if (!linkedMemberId || readIds.includes(n.id)) return
    try {
      setReadIds(await markNoticeRead(linkedMemberId, n.id, readIds))
    } catch {
      // 읽음 기록 실패는 글을 읽는 데 지장이 없으므로 조용히 넘어간다.
    }
  }

  const startNew = () => { setEditing('new'); setDraftTitle(''); setDraftBody(''); setInfo(''); setError('') }
  const startEdit = (n: Notice) => { setEditing(n.id); setDraftTitle(n.title); setDraftBody(n.body); setInfo(''); setError('') }
  const cancelEdit = () => { setEditing(null); setDraftTitle(''); setDraftBody('') }

  const save = async () => {
    const title = draftTitle.trim()
    const body = draftBody.trim()
    if (!title) { setError('제목을 입력해 주세요.'); return }
    if (title.length > 100) { setError('제목은 100자까지 쓸 수 있습니다.'); return }
    if (body.length > 4000) { setError('내용은 4000자까지 쓸 수 있습니다.'); return }
    setError('')
    try {
      if (editing && editing !== 'new') {
        await updateNoticeText(editing, { title, body })
        setInfo('수정했습니다.')
      } else {
        // 이 기기가 어느 회원인지 연결로 확인되면 그 회원의 실명으로, 확인할 수 없으면
        // '관리자'라는 역할 표기로 남긴다 — 확인되지 않은 신원에 임의의 실명을 붙이지 않는다.
        const me = linkedMemberId ? members.find((m) => m.id === linkedMemberId) : undefined
        await createNotice({
          authorMemberId: me ? me.id : null,
          authorName: me ? me.name : '관리자',
          title,
          body,
        })
        setInfo('공지를 올렸습니다.')
      }
      cancelEdit()
      await load()
    } catch {
      setError('저장하지 못했습니다. 관리자 권한과 인터넷 연결을 확인해 주세요.')
    }
  }

  const runAdmin = async (fn: () => Promise<void>, done: string) => {
    setError('')
    try { await fn(); setInfo(done); await load() }
    catch { setError('처리하지 못했습니다. 관리자 권한과 인터넷 연결을 확인해 주세요.') }
  }

  const togglePin = (n: Notice) => {
    if (!n.pinned && pinnedNow >= HOME_PINNED_LIMIT) {
      setError('고정은 ' + HOME_PINNED_LIMIT + '개까지만 할 수 있습니다. 다른 고정을 먼저 해제해 주세요.')
      return
    }
    void runAdmin(() => setNoticePinned(n.id, !n.pinned), n.pinned ? '고정을 해제했습니다.' : '맨 위에 고정했습니다.')
  }

  return (
    <section aria-label="공지 게시판" style={{ textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: '#072B61', margin: 0 }}>공지</h2>
        {isAdmin && editing === null && (
          <button style={primaryButton} onClick={startNew}>글 작성</button>
        )}
      </div>

      {isAdmin && editing !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="notice-title">제목</label>
          <input id="notice-title" style={inputStyle} value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)} />
          <label style={labelStyle} htmlFor="notice-body">내용</label>
          <textarea id="notice-body" rows={5} style={{ ...inputStyle, resize: 'vertical' }}
            value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...primaryButton, flex: 1 }} onClick={() => void save()}>올리기</button>
            <button style={{ ...actionButton, flex: 1 }} onClick={cancelEdit}>취소</button>
          </div>
        </div>
      )}

      {loading && <p style={{ ...labelStyle, margin: '8px 0' }}>공지를 불러오는 중입니다...</p>}
      {error && <p style={{ fontSize: 14, color: '#c0392b', margin: '8px 0' }}>{error}</p>}
      {info && <p style={{ fontSize: 14, color: '#0f6e56', margin: '8px 0' }}>{info}</p>}

      {!loading && homeItems.length === 0 && (
        <p style={{ fontSize: 15, color: '#666', margin: '10px 0' }}>아직 올라온 공지가 없습니다.</p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {homeItems.map(({ notice, read, pinnedSlot }) => (
          <li key={notice.id} style={{
            border: '1px solid #e0e0e0', borderRadius: 12, padding: '12px 14px',
            background: read ? '#fafafa' : '#fff',
          }}>
            <button
              onClick={() => void openNotice(notice)}
              aria-expanded={openId === notice.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
              }}
            >
              {pinnedSlot && <span style={{
                flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#0f6e56',
                border: '1px solid #0f6e56', borderRadius: 6, padding: '2px 6px',
              }}>고정</span>}
              {!read && <span style={{
                flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#c0392b',
                border: '1px solid #c0392b', borderRadius: 6, padding: '2px 6px',
              }}>새 글</span>}
              <span style={{
                fontSize: 16, color: '#072B61', fontWeight: read ? 400 : 700,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{notice.title}</span>
            </button>
            <div style={{ ...labelStyle, marginTop: 6 }}>
              {displayAuthor(notice)} · {notice.createdAt.slice(0, 10)}
            </div>
            {openId === notice.id && (
              <p style={{ fontSize: 15, color: '#333', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>
                {notice.body}
              </p>
            )}
            {isAdmin && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button style={actionButton} onClick={() => startEdit(notice)}>수정</button>
                <button style={actionButton} onClick={() => togglePin(notice)}>
                  {notice.pinned ? '고정 해제' : '맨 위 고정'}
                </button>
                <button style={actionButton}
                  onClick={() => void runAdmin(() => deleteNotice(notice.id), '삭제했습니다.')}>삭제</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
