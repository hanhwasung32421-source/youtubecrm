'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/app-shell'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPatchJson, authedPostJson } from '@/lib/session/authed-fetch'

type VideoItem = {
  id: string
  title: string | null
  stock_name: string
  content_type: 'longform' | 'shortform'
  published_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
}

export default function CreatorVideosPage() {
  const [items, setItems] = useState<VideoItem[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentCategory, setContentCategory] = useState('')
  const { toast, showSuccess, showError } = useToast()
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ pageSize: 20, totalCount: 0 })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editStock, setEditStock] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const loadMyVideos = async (targetPage = page) => {
    const { ok, data } = await authedFetchJson<{
      items?: VideoItem[]
      pagination?: { page: number; pageSize: number; totalCount: number }
      error?: string
    }>(`/api/videos/mine?page=${targetPage}`)
    if (!ok) {
      showError(data?.error || '영상 목록 조회 실패')
      return
    }
    setItems(data.items || [])
    if (data.pagination) {
      setPagination({ pageSize: data.pagination.pageSize, totalCount: data.pagination.totalCount })
    }
  }

  useEffect(() => {
    void loadMyVideos(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalPages = Math.max(Math.ceil(pagination.totalCount / pagination.pageSize), 1)

  const goToPage = async (nextPage: number) => {
    setPage(nextPage)
    await loadMyVideos(nextPage)
  }

  const isLikelyYoutubeUrl = (value: string) => {
    try {
      const url = new URL(value.trim())
      return /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === 'youtu.be'
    } catch {
      return false
    }
  }

  const submit = async () => {
    if (!youtubeUrl.trim()) {
      showError('유튜브 영상 주소를 입력해 주세요.')
      return
    }
    if (!isLikelyYoutubeUrl(youtubeUrl)) {
      showError('유튜브 영상 주소 형식이 아닙니다. (youtube.com 또는 youtu.be 링크)')
      return
    }

    setLoading(true)
    try {
      const { ok, data } = await authedPostJson<{ error?: string; video?: VideoItem; stockNameSource?: string }>('/api/videos/create', {
        youtubeUrl,
        contentCategory: contentCategory || null
      })
      if (!ok) {
        showError(data?.error || '영상 저장 실패')
        return
      }

      const savedType = data.video?.content_type
      const savedStock = data.video?.stock_name
      const typeText = savedType ? (savedType === 'longform' ? '롱폼' : '숏폼') : null
      const stockText =
        data.stockNameSource === 'placeholder'
          ? '제목에서 종목명을 찾지 못해 "종목 미지정"으로 저장했습니다. 목록에서 고쳐 주세요.'
          : savedStock
            ? `종목명은 "${savedStock}"으로 자동 저장했습니다.`
            : null

      showSuccess(
        [
          '영상이 CRM에 저장되었습니다.',
          typeText ? `형식은 영상 길이를 보고 "${typeText}"으로 정했습니다.` : null,
          stockText
        ]
          .filter(Boolean)
          .join(' ')
      )
      setYoutubeUrl('')
      setContentCategory('')
      await loadMyVideos()
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (item: VideoItem) => {
    setEditingId(item.id)
    setEditStock(item.stock_name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditStock('')
  }

  const saveEdit = async (id: string) => {
    const next = editStock.trim()
    if (!next) {
      showError('종목명을 입력해 주세요.')
      return
    }
    setSavingEdit(true)
    try {
      const { ok, data } = await authedPatchJson<{ error?: string; video?: VideoItem }>(`/api/videos/${id}`, {
        stock_name: next
      })
      if (!ok) {
        showError(data?.error || '종목명 수정 실패')
        return
      }
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, stock_name: data.video?.stock_name ?? next } : it)))
      showSuccess('종목명을 저장했습니다.')
      cancelEdit()
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <>
      <PageHeader title="영상 등록" subtitle="업로드 완료 후 URL과 기본 분류만 입력하면 업로드 시각과 통계가 자동 저장됩니다." />
        <Toast toast={toast} />
        <div className="grid grid-2">
          <div className="panel form-stack">
            <div className="panel-header">
              <div>
                <div className="panel-title">등록 문서 작성</div>
                <p className="panel-subtitle">계정 선택 후 영상 URL과 핵심 분류만 입력하면 CRM 문서가 생성됩니다.</p>
              </div>
            </div>
            <div className="panel soft">
              <div className="panel-title">연결 유튜브 계정</div>
              <p className="panel-subtitle" style={{ marginTop: 8 }}>
                개미들의 주식노트 계정이 자동으로 연결됩니다.
              </p>
            </div>
            <div className="field">
              <label className="label">유튜브 영상 주소 *</label>
              <input className="input" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} />
            </div>
            <p className="small muted">콘텐츠 형식(롱폼/숏폼)은 영상 길이를 보고 자동으로 정해집니다. 10분 미만이면 숏폼, 10분 이상이면 롱폼입니다.</p>
            <p className="small muted">
              주요 종목명은 영상 제목(예: "[삼성전자 주가전망]")에서 자동으로 읽어옵니다. 제목이 이 형식이 아니면 일단 등록되고, 아래 목록에서 나중에 종목명을 입력할 수 있습니다.
            </p>
            <div className="field">
              <label className="label">비고</label>
              <input className="input" value={contentCategory} onChange={(e) => setContentCategory(e.target.value)} />
            </div>
            <button className="button" disabled={loading} onClick={submit}>{loading ? '저장 중...' : '작성 버튼'}</button>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">최근 등록 영상</div>
                <p className="panel-subtitle">최근 문서처럼 쌓인 영상 기록과 통계 요약입니다.</p>
              </div>
            </div>
            <div className="list" style={{ marginTop: 16 }}>
              {items.length === 0 ? (
                <div className="empty-state">아직 등록된 영상이 없습니다.</div>
              ) : (
                items.map((item) => (
                  <div className="list-item" key={item.id}>
                    <div>{item.title || '제목 없음'}</div>
                    {editingId === item.id ? (
                      <div className="toolbar" style={{ marginTop: 4 }}>
                        <input
                          className="input"
                          style={{ maxWidth: 200 }}
                          value={editStock}
                          onChange={(e) => setEditStock(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveEdit(item.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          autoFocus
                        />
                        <button className="button" disabled={savingEdit} onClick={() => void saveEdit(item.id)}>
                          저장
                        </button>
                        <button className="button secondary" disabled={savingEdit} onClick={cancelEdit}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <div className="small muted">
                        {item.stock_name === '종목 미지정' ? (
                          <span title="영상 제목에서 종목명을 찾지 못했습니다.">종목 미지정</span>
                        ) : (
                          item.stock_name
                        )}{' '}
                        · {item.content_type === 'longform' ? '롱폼' : '숏폼'} ·{' '}
                        <button
                          type="button"
                          className="small"
                          style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                          onClick={() => startEdit(item)}
                        >
                          종목명 수정
                        </button>
                      </div>
                    )}
                    <div className="small muted">
                      조회수 {item.view_count ?? 0} · 좋아요 {item.like_count ?? 0} · 댓글 {item.comment_count ?? 0}
                    </div>
                  </div>
                ))
              )}
            </div>
            {pagination.totalCount > pagination.pageSize ? (
              <div className="toolbar" style={{ marginTop: 16, justifyContent: 'center' }}>
                <button className="button secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                  이전
                </button>
                <span className="small muted">
                  {page} / {totalPages} 페이지 · 총 {pagination.totalCount}건
                </span>
                <button className="button secondary" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                  다음
                </button>
              </div>
            ) : null}
          </div>
        </div>
    </>
  )
}
