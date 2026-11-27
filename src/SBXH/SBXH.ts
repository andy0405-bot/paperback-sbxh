import {
  Chapter, ChapterDetails, ChapterProviding, ContentRating, HomeSection,
  PagedResults, PaperbackExtensionBase, Request, Response, SearchRequest,
  SourceInfo, SourceIntents, SourceManga, PartialSourceManga
} from '@paperback/types'
import * as cheerio from 'cheerio'

const BASE = 'https://sbxh9.com'
export const SBXHInfo: SourceInfo = {
  name: 'SBXH 한국어', version: '0.1.3', icon: 'icon.png', author: 'andy0405-bot',
  description: 'Paperback 0.8 시험판. 일반 접근 가능한 회차를 지원합니다.',
  websiteBaseURL: BASE, language: 'ko', contentRating: ContentRating.ADULT,
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

function absolute(value: string, base = BASE): string {
  const ref = value.trim()
  if (!ref) return ''
  if (/^https:\/\/[^/?#\s]+(?:[/?#]|$)/i.test(ref)) return ref
  if (ref.startsWith('//')) return 'https:' + ref
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) throw new Error('HTTPS 주소만 지원합니다.')
  if (!ref.startsWith('/')) throw new Error('지원하지 않는 상대 주소입니다.')
  return base.replace(/\/$/, '') + ref
}

// Parse only serialized JSON strings. Never execute page scripts.
export function flightData(html: string): string {
  const chunks: string[] = []
  const pattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    try {
      const value = JSON.parse(match[1])
      if (value[0] === 1 && typeof value[1] === 'string') chunks.push(value[1])
    } catch (_) { /* A non-JSON script is not reader data. */ }
  }
  return chunks.join('')
}
function stringField(data: string, key: string): string {
  const match = new RegExp('"' + key + '":("(?:[^"\\\\]|\\\\.)*")').exec(data)
  return match ? JSON.parse(match[1]) : ''
}

interface Metadata { page: number }
interface ImageRow { page: number; src: string; srcCandidates?: string[] }
export function orderedImages(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('회차 이미지 목록이 비어 있습니다.')
  const rows = value as ImageRow[]
  if (rows.some(row => !Number.isInteger(row.page) || typeof row.src !== 'string')) {
    throw new Error('지원하지 않는 이미지 응답 형식입니다.')
  }
  rows.sort((a, b) => a.page - b.page)
  if (rows.some((row, index) => row.page !== index + 1)) {
    throw new Error('회차 페이지 번호가 누락되거나 중복되었습니다.')
  }
  const pages = rows.map(row => absolute(row.src))
  if (new Set(pages).size !== pages.length) throw new Error('회차 이미지 주소가 중복되었습니다.')
  return pages
}

// Report server evidence without exposing response bodies, tokens or client IPs.
export function checkedResponse(response: Response, method: string, path: string): string {
  const body = response.data || ''
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1].trim() || ''
  const ipBlocked = /\bNGINX_CIDR_REALIP\b/.test(body)
  const challenge = /just a moment|attention required/i.test(title) || /cf-chl-|challenge-platform/.test(body)
  const denied = /access denied|forbidden/i.test(title)
  const prefix = '[SBXH HTTP ' + response.status + '] ' + method + ' ' + path.split('?')[0] + ': '
  if (response.status < 200 || response.status >= 300 || ipBlocked || challenge || denied) {
    let reason = '서버가 정상 응답을 반환하지 않았습니다.'
    if (ipBlocked) reason = '사이트가 접속 IP 대역을 차단했습니다 (NGINX_CIDR_REALIP). 확장에서 해제할 수 없습니다.'
    else if (response.status === 401) reason = '서버가 인증을 요구했습니다.'
    else if (challenge) reason = '사이트의 브라우저 확인 페이지가 반환되었습니다. 웹뷰에서 접속 상태를 확인해 주세요.'
    else if (response.status === 403 || denied) reason = '서버가 접근을 거부했습니다. 로그인 필요 여부와 차단 사유는 서버 응답을 확인해야 합니다.'
    else if (response.status === 428) reason = '서버가 요청의 선행 조건을 요구했습니다 (HTTP 428).'
    else if (response.status === 429) reason = '요청 제한입니다. 잠시 후 다시 시도해 주세요.'
    throw new Error(prefix + reason)
  }
  if (!body.trim()) throw new Error(prefix + '사이트 응답 본문이 비어 있습니다.')
  return body
}

export class SBXH implements PaperbackExtensionBase, ChapterProviding {
  requestManager = App.createRequestManager({
    requestsPerSecond: 2, requestTimeout: 20000,
    interceptor: {
      interceptRequest: async (request: Request): Promise<Request> => {
        request.headers = { ...request.headers,
          Referer: request.headers?.Referer || BASE + '/',
          'User-Agent': await this.requestManager.getDefaultUserAgent() }
        return request
      },
      interceptResponse: async (response: Response): Promise<Response> => response
    }
  })

  private async request(path: string, method = 'GET', data?: string, referer = BASE + '/'): Promise<string> {
    const response = await this.requestManager.schedule(App.createRequest({
      url: absolute(path), method, data,
      headers: { Referer: referer, ...(method === 'POST'
        ? { 'Content-Type': 'application/json', 'x-images-client': 'viewer-v1' } : {}) }
    }), method === 'GET' ? 1 : 0)
    return checkedResponse(response, method, path)
  }

  private async listing(kind: string, page: number): Promise<PagedResults> {
    const updates = kind === 'updates'
    const path = updates ? '/manhwa/updates?page=' + page
      : '/manhwa?sort=' + (kind === 'fresh' ? 'fresh' : 'views') + '&page=' + page
    const $ = cheerio.load(await this.request(path))
    const results: PartialSourceManga[] = [], seen = new Set<string>()
    const cards = $(updates ? 'li.upd-card' : 'a.card[data-work-card]')
    cards.each((_, element) => {
      const card = $(element)
      const link = updates ? card.find('a.upd-allbtn').attr('href') : card.attr('href')
      const match = link?.match(/^\/manhwa\/([^/?#]+)$/)
      if (!match || seen.has(match[1])) return
      const title = card.find(updates ? '.upd-title' : '.subject').text().trim()
      const src = card.find('img').attr('data-src') || card.find('img').attr('src') || ''
      if (!title || !src) return
      seen.add(match[1])
      const chapter = card.find(updates ? '.upd-ep-main' : '.ep-no').text().trim()
      const time = card.find(updates ? '.upd-thumb-time' : '.ep-date').text().trim()
      results.push(App.createPartialSourceManga({ mangaId: match[1], title,
        image: absolute(src), subtitle: [chapter, time].filter(Boolean).join(' · ') }))
    })
    if (cards.length && !results.length) throw new Error('작품 목록 형식이 변경되었습니다.')
    let more = false
    if (updates) {
      const pager = $('.upd-pager').first()
      const active = Number(pager.find('.is-active').text())
      if (active !== page) throw new Error('요청한 목록 페이지가 반환되지 않았습니다.')
      more = pager.find('button[aria-label="끝 페이지"]:not([disabled])').length > 0
    } else {
      const data = flightData($.html())
      const current = Number(/"initialPage":(\d+)/.exec(data)?.[1])
      const total = Number(/"initialTotal":(\d+)/.exec(data)?.[1])
      const size = Number(/"initialPageModeSize":(\d+)/.exec(data)?.[1])
      if (current !== page || !size || !Number.isFinite(total)) throw new Error('작품 목록 페이지 정보를 확인하지 못했습니다.')
      more = page * size < total
    }
    return App.createPagedResults({ results, metadata: more ? {page: page + 1} : undefined })
  }

  async getHomePageSections(callback: (section: HomeSection) => void): Promise<void> {
    const sections = [['updates', '최신 업데이트'], ['fresh', '신규 등록'], ['views', '조회순']]
    // Register sections before I/O, as the official 0.8 source does.
    for (const [id, title] of sections) callback(App.createHomeSection({
      id, title, type: 'singleRowNormal', items: [], containsMoreItems: false
    }))
    for (const [id, title] of sections) {
      const data = await this.listing(id, 1)
      callback(App.createHomeSection({id, title, type: 'singleRowNormal',
        items: data.results, containsMoreItems: !!data.metadata}))
    }
  }
  getViewMoreItems(section: string, metadata: Metadata | undefined): Promise<PagedResults> {
    if (!['updates', 'fresh', 'views'].includes(section)) throw new Error('지원하지 않는 목록입니다.')
    return this.listing(section, metadata?.page || 1)
  }
  async getSearchResults(query: SearchRequest, metadata: Metadata | undefined): Promise<PagedResults> {
    const page = metadata?.page || 1
    const $ = cheerio.load(await this.request('/search?q=' + encodeURIComponent(query.title || '') +
      '&field=title&match=contains&page=' + page))
    const results: PartialSourceManga[] = [], seen = new Set<string>()
    $('a[href^="/manhwa/"]').each((_, element) => {
      const a = $(element), match = a.attr('href')?.match(/^\/manhwa\/([^/?#]+)$/)
      if (!match || seen.has(match[1])) return
      const title = a.find('.subject, .upd-title').first().text().trim() || a.text().trim()
      const image = a.find('img').attr('src') || ''
      if (!title || !image) return
      seen.add(match[1])
      results.push(App.createPartialSourceManga({mangaId: match[1], title, image: absolute(image)}))
    })
    const next = $('.pager a[href]').toArray().some(element => {
      const href = $(element).attr('href') || ''
      const match = /[?&]page=(\d+)/.exec(href)
      return match && Number(match[1]) > page
    })
    return App.createPagedResults({results, metadata: next ? {page: page + 1} : undefined})
  }
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = cheerio.load(await this.request('/manhwa/' + encodeURIComponent(mangaId)))
    const title = $('h1.hero-v2-title').text().trim()
    if (!title) throw new Error('작품 제목을 찾지 못했습니다.')
    const genres = $('.hero-v2-tags a, .hero-v2-genres a, .hero-v2-genre a')
      .toArray().map(e => $(e).text().trim().replace(/^#/, '')).filter(Boolean)
    // User preference: do not set the per-work hentai flag.
    return App.createSourceManga({id: mangaId, mangaInfo: App.createMangaInfo({
      titles: [title], image: absolute($('meta[property="og:image"]').attr('content') || ''),
      author: $('.hero-v2-author').text().trim(),
      desc: $('.hero-v2-description, .hero-v2-synopsis').first().text().trim(),
      status: $('.pill-status.ongoing').length ? 'ongoing' : 'unknown',
      tags: genres.length ? [App.createTagSection({id: 'genres', label: '장르',
        tags: genres.map(g => App.createTag({id: g, label: g}))})] : [],
      hentai: false
    })})
  }
  async getChapters(mangaId: string): Promise<Chapter[]> {
    const path = '/manhwa/' + encodeURIComponent(mangaId)
    let $ = cheerio.load(await this.request(path)), page = 1
    const count = /(\d+)/.exec($('.ep-section-count').text().replace(/,/g, ''))
    const expected = count ? Number(count[1]) : null
    const chapters: Chapter[] = [], seen = new Set<string>(), unavailable = new Set<string>()
    while (true) {
      const pager = $('.episode-pager').first()
      if (pager.length && Number(pager.find('.is-active').text().trim()) !== page) {
        throw new Error('회차 페이지 응답 불일치: 요청 ' + page + '페이지.')
      }
      const before = chapters.length + unavailable.size
      $('li.ep-row-v2').each((_, element) => {
        const item = $(element)
        if (item.find('a.ep-row-v2-link').length || !item.find('.ep-row-v2-link.is-disabled').length) return
        const ref = item.attr('data-episode-ref')
        if (!ref) throw new Error('열람 불가 회차의 식별자를 확인하지 못했습니다.')
        unavailable.add(ref)
      })
      $('li.ep-row-v2 a.ep-row-v2-link').each((_, element) => {
        const row = $(element), match = (row.attr('href') || '').match(/^\/manhwa\/([^/]+)\/([^/?#]+)$/)
        if (!match || match[1] !== mangaId || seen.has(match[2])) return
        const name = row.find('.ep-row-v2-title strong').text().trim() || row.find('.ep-row-v2-title').text().trim()
        const day = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(row.find('.ep-row-v2-date').text().trim())
        const time = day ? new Date('20' + day[1] + '-' + day[2] + '-' + day[3] + 'T00:00:00+09:00') : undefined
        seen.add(match[2])
        chapters.push(App.createChapter({id: match[2], name, chapNum: parseFloat(name) || 0,
          langCode: 'ko', sortingIndex: -chapters.length, time: time && Number.isFinite(time.getTime()) ? time : undefined}))
      })
      if (chapters.length + unavailable.size === before && (page > 1 || (expected !== null && expected > 0))) {
        throw new Error('회차 목록 진행이 멈췄습니다 (' + page + '페이지).')
      }
      let nextPage = Infinity, nextPath = ''
      pager.find('a[href]').each((_, element) => {
        const href = $(element).attr('href') || ''
        const local = href.startsWith(BASE + '/') ? href.slice(BASE.length) : href
        const match = /[?&]epage=(\d+)(?:&|$)/.exec(local)
        if (local.split('?')[0] !== path || !match) return
        const candidate = Number(match[1])
        if (candidate > page && candidate < nextPage) { nextPage = candidate; nextPath = local }
      })
      if (!nextPath) {
        if (expected !== null && chapters.length + unavailable.size !== expected) {
          throw new Error('전체 회차 수 불일치: ' + chapters.length + '개, 열람 불가 ' + unavailable.size + '개 / 총 ' + expected)
        }
        break
      }
      if (nextPage !== page + 1) throw new Error('연속된 다음 회차 페이지 링크를 찾지 못했습니다.')
      page = nextPage
      try { $ = cheerio.load(await this.request(nextPath)) }
      catch (error) { throw new Error('회차 ' + page + '페이지를 가져오지 못했습니다. ' + String(error)) }
    }
    if (!chapters.length) throw new Error('회차 목록이 비어 있거나 접근할 수 없습니다.')
    return chapters
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const path = '/manhwa/' + encodeURIComponent(mangaId) + '/' + encodeURIComponent(chapterId)
    const url = BASE + path, html = await this.request(path), $ = cheerio.load(html)
    const expected = Number($('.vw-imgs').attr('data-viewer-image-count'))
    const staticRows: ImageRow[] = []
    $('.vw-imgs img.viewer-ratio-img').each((_, e) => {
      const img = $(e), page = /^page\s+(\d+)$/i.exec(img.attr('alt') || '')
      const src = img.attr('data-src') || img.attr('src') || ''
      if (page && /^https:\/\//.test(src)) staticRows.push({page: Number(page[1]), src})
    })
    if (expected > 0 && staticRows.length === expected) {
      return App.createChapterDetails({id: chapterId, mangaId, pages: orderedImages(staticRows)})
    }
    const data = flightData(html)
    if (!/"adVerificationEnabled":false/.test(data)) {
      throw new Error('이 회차는 브라우저 인증이 필요하여 이 확장에서 지원하지 않습니다.')
    }
    const token = stringField(data, 'imagesToken')
    if (!token) throw new Error('일반 뷰어의 이미지 토큰이 없습니다.')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    // Request correlation nonce, not an authentication secret or a proof.
    const nonce = Array.from({length: 32}, () => alphabet[Math.floor(Math.random() * 64)]).join('')
    const raw = await this.request('/api/manhwa-images', 'POST', JSON.stringify({
      workId: mangaId, episodeId: chapterId, token, nonce, proof: ''
    }), url)
    let payload: {ok: boolean; images: unknown; error?: string}
    try { payload = JSON.parse(raw) } catch (_) { throw new Error('이미지 서버가 JSON을 반환하지 않았습니다.') }
    if (!payload.ok) throw new Error('이미지 서버가 일반 접근을 허용하지 않았습니다.')
    return App.createChapterDetails({id: chapterId, mangaId, pages: orderedImages(payload.images)})
  }

  // Paperback 0.8's globe uses this hook to open the normal site web view.
  // No challenge solving, cookie extraction, proxy or security modification.
  async getCloudflareBypassRequestAsync(): Promise<Request> {
    return App.createRequest({url: BASE + '/', method: 'GET', headers: {
      Referer: BASE + '/', 'User-Agent': await this.requestManager.getDefaultUserAgent()
    }})
  }

  getMangaShareUrl(mangaId: string): string { return BASE + '/manhwa/' + encodeURIComponent(mangaId) }
}

