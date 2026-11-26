// SPDX-License-Identifier: Apache-2.0
// Adapted from Keiyoushi Toon11.kt (Apache-2.0); see includes/NOTICE.txt.
// Modified 2026-11-26: Paperback 0.8 TypeScript port, configurable origin,
// stable IDs, safe JSON parsing and bounded-progress sequential pagination.
import {Chapter, ChapterDetails, ChapterProviding, ContentRating, DUISection,
  HomeSection, PagedResults, PaperbackExtensionBase, PartialSourceManga,
  Request, Response, SearchRequest, SourceInfo, SourceIntents, SourceManga} from '@paperback/types'
import * as cheerio from 'cheerio'

const DEFAULT_BASE = 'https://update.spotv24.com'
export const Toon11Info: SourceInfo = {
  name: '11툰 한국어', version: '0.1.0', icon: 'icon.png', author: 'andy0405-bot',
  description: 'Paperback 0.8 시험판. 공개 일반 만화 페이지를 읽습니다. 실제 기기 미검증.',
  websiteBaseURL: DEFAULT_BASE, language: 'ko', contentRating: ContentRating.MATURE,
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.SETTINGS_UI
}
export function origin(value: string): string {
  const clean = value.trim().replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(clean)) {
    throw new Error('기본 URL은 경로·쿼리 없이 https://도메인 형식으로 입력해 주세요.')
  }
  return clean
}
function param(path: string, key: string): string {
  const match = new RegExp('[?&]' + key + '=([^&#]*)').exec(path)
  try { return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '' }
  catch (_) { throw new Error('주소의 매개변수 형식이 올바르지 않습니다.') }
}
function local(value: string, base: string): string {
  const ref = value.trim().replace(/&amp;/g, '&')
  if (ref.startsWith(base + '/')) return ref.slice(base.length)
  if (ref.startsWith('/bbs/')) return ref
  if (/^(?:\.\/)?(?:board|search_stx)\.php\?/.test(ref)) return '/bbs/' + ref.replace(/^\.\//, '')
  throw new Error('작품 주소가 설정한 사이트의 일반 만화 경로가 아닙니다.')
}
function imageUrl(value: string, base: string): string {
  const ref = value.trim()
  if (!ref) return ''
  if (ref.startsWith('//')) return 'https:' + ref
  if (/^https:\/\/[^\s/?#]+(?:[/?#]|$)/i.test(ref)) return ref
  if (ref.startsWith('/') && !ref.startsWith('//')) return base + ref
  throw new Error('안전한 HTTPS 이미지 주소가 아닙니다.')
}
function requireId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error('작품 식별자가 올바르지 않습니다.')
  return id
}
function seriesPath(id: string): string { return '/bbs/board.php?bo_table=toons&is=' + requireId(id) }
export function responseText(response: Response): string {
  const text = response.data || '', code = response.status
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1] || ''
  if (code === 401) throw new Error('[11툰 HTTP 401] 사이트에서 인증을 요구합니다.')
  if (code === 403 || /access denied|forbidden/i.test(title)) throw new Error('[11툰 HTTP ' + code + '] 사이트가 접근을 거부했습니다. 서버의 차단 사유를 확인해 주세요.')
  if (code === 429) throw new Error('[11툰 HTTP 429] 요청 제한입니다. 잠시 후 다시 시도해 주세요.')
  if (/just a moment|attention required/i.test(title) || /cf-chl-|challenge-platform/.test(text)) throw new Error('[11툰 HTTP ' + code + '] 브라우저 확인 페이지가 반환되었습니다.')
  if (code < 200 || code >= 300) throw new Error('[11툰 HTTP ' + code + '] 서버 오류입니다.')
  if (!text.trim()) throw new Error('[11툰 HTTP ' + code + '] 응답 본문이 비어 있습니다.')
  return text
}
export function parseImages(html: string, base: string): string[] {
  const $ = cheerio.load(html)
  let list: unknown
  for (const script of $('script').toArray()) {
    const match = /\bimg_list\s*=\s*(\[\s*(?:"(?:[^"\\]|\\.)*"\s*,?\s*)*\])/.exec($(script).html() || '')
    if (match) { try { list = JSON.parse(match[1]) } catch (_) { throw new Error('이미지 목록 JSON 형식이 올바르지 않습니다.') }; break }
  }
  if (!Array.isArray(list) || !list.length || list.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error('일반 뷰어의 이미지 목록(img_list)이 없거나 비어 있습니다. 인증·유료 회차 또는 구조 변경을 확인해 주세요.')
  }
  return list.map(value => imageUrl(value, base))
}
export class Toon11 implements PaperbackExtensionBase, ChapterProviding {
  stateManager = App.createSourceStateManager()
  requestManager = App.createRequestManager({requestsPerSecond: 2, requestTimeout: 20000,
    interceptor: {
      interceptRequest: async (request: Request): Promise<Request> => {
        request.headers = {...request.headers, 'User-Agent': await this.requestManager.getDefaultUserAgent()}
        return request
      }, interceptResponse: async (response: Response): Promise<Response> => response
    }})
  private async base(): Promise<string> {
    this.shareBase = origin(await this.stateManager.retrieve('baseUrl') || DEFAULT_BASE)
    return this.shareBase
  }
  private async html(path: string, base: string): Promise<string> {
    let response: Response
    try { response = await this.requestManager.schedule(App.createRequest({url: base + local(path, base),
      method: 'GET', headers: {Referer: base + '/'}}), 1) }
    catch (_) { throw new Error('11툰 연결 실패: 서버 응답을 받지 못했습니다. 연결 초기화·시간 초과·네트워크 상태를 확인해 주세요.') }
    return responseText(response)
  }
  async getSourceMenu(): Promise<DUISection> {
    return App.createDUISection({id: 'toon11-settings', header: '11툰 설정',
      footer: '공식 안내에서 확인한 HTTPS 기본 주소를 입력해 주세요. 주소 변경 후에도 작품·회차 ID는 유지됩니다.',
      isHidden: false, rows: async () => [App.createDUIInputField({id: 'base-url', label: '기본 URL',
        value: App.createDUIBinding({get: async () => this.base(),
          set: async value => this.stateManager.store('baseUrl', origin(String(value || '')))})})]})
  }
  private next($: cheerio.CheerioAPI, path: string, base: string, page: number): string | undefined {
    const pager = $('span.pg').first()
    if (!pager.length) { if (page > 1) throw new Error('다음 페이지의 페이지 번호를 확인하지 못했습니다.'); return undefined }
    const active = /(\d+)/.exec(pager.find('.pg_current').text())
    if (!active || Number(active[1]) !== page) throw new Error('요청 페이지와 응답 페이지 번호가 다릅니다.')
    let next: string | undefined, number = Infinity
    pager.find('a[href]').each((_, e) => {
      let target: string
      try { target = local($(e).attr('href') || '', base) } catch (_) { return }
      if (target.split('?')[0] !== path.split('?')[0]) return
      for (const key of ['bo_table','is','stx','type','sord','is_over','sca']) {
        if (key === 'stx' && param(path,'is')) continue // titles do not identify a series
        if (param(target,key) !== param(path,key)) return
      }
      const candidate = Number(param(target, 'page'))
      if (Number.isInteger(candidate) && candidate > page && candidate < number) { next = target; number = candidate }
    })
    if (next && number !== page + 1) throw new Error('연속된 다음 페이지 링크가 없습니다.')
    return next
  }
  private async listing(path: string, page: number): Promise<PagedResults> {
    const base = await this.base(), $ = cheerio.load(await this.html(path, base))
    const results: PartialSourceManga[] = [], seen = new Set<string>()
    $('li[data-id]').each((_, e) => {
      const row = $(e), id = row.attr('data-id') || '', title = row.find('.homelist-title').text().trim()
      if (!/^\d+$/.test(id) || !title || seen.has(id)) return
      const thumb = row.find('.homelist-thumb').first()
      const style = /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/.exec(thumb.attr('style') || '')?.[1] || ''
      const img = thumb.attr('data-mobile-image') || style || row.find('img').attr('data-src') || row.find('img').attr('src') || ''
      seen.add(id); results.push(App.createPartialSourceManga({mangaId:id, title, image:imageUrl(img,base)}))
    })
    if (!results.length && !/검색.*(?:없|결과가 없습니다)|게시물이 없습니다|검색된 자료가 하나도 없습니다/.test($.text())) throw new Error('작품 목록 선택자를 찾지 못했습니다. 사이트 구조 또는 접근 상태를 확인해 주세요.')
    const next = this.next($,path,base,page)
    return App.createPagedResults({results, metadata: next ? {page:page+1,path:next} : undefined})
  }
  async getHomePageSections(callback: (section: HomeSection) => void): Promise<void> {
    const sections = [['updates','최신 업데이트 작품'],['popular','인기 작품']]
    for (const [id,title] of sections) callback(App.createHomeSection({id,title,type:'singleRowNormal',items:[],containsMoreItems:false}))
    for (const [id,title] of sections) {
      const data = await this.getViewMoreItems(id,undefined)
      callback(App.createHomeSection({id,title,type:'singleRowNormal',items:data.results,containsMoreItems:!!data.metadata}))
    }
  }
  getViewMoreItems(section: string, metadata: {page:number;path:string} | undefined): Promise<PagedResults> {
    const paths: Record<string,string> = {updates:'/bbs/board.php?bo_table=toon_c&sord=&type=upd&page=1',
      popular:'/bbs/board.php?bo_table=toon_c&is_over=0&page=1'}
    if (!paths[section]) throw new Error('지원하지 않는 목록입니다.')
    return this.listing(metadata?.path || paths[section],metadata?.page || 1)
  }
  getSearchResults(query: SearchRequest, metadata: {page:number;path:string} | undefined): Promise<PagedResults> {
    return this.listing(metadata?.path || '/bbs/search_stx.php?stx=' + encodeURIComponent(query.title || '') + '&page=1',metadata?.page || 1)
  }
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const base=await this.base(), $=cheerio.load(await this.html(seriesPath(mangaId),base))
    const title=$('h2.title').text().trim()
    if (!title) throw new Error('작품 상세 제목이 없습니다.')
    const field=(label:string) => $('span').filter((_,e)=>$(e).text().trim().replace(/\s*[:：]\s*$/,'')===label).first().next('span').text().trim()
    const genres=field('장르').split(',').map(x=>x.trim()).filter(Boolean), status=field('분류')
    return App.createSourceManga({id:mangaId,mangaInfo:App.createMangaInfo({titles:[title],
      image:imageUrl($('img.banner').attr('src') || '',base),author:field('작가'),desc:field('소개'),
      status: /완결/.test(status)?'completed':/주간|월간|연재|격주/.test(status)?'ongoing':'unknown',
      hentai:genres.some(g=>/^(성인|19|19금|adult|hentai)$/i.test(g)),
      tags:[App.createTagSection({id:'genres',label:'장르',tags:genres.map(g=>App.createTag({id:g,label:g}))})]})})
  }
  async getChapters(mangaId: string): Promise<Chapter[]> {
    const base=await this.base(), chapters:Chapter[]=[], seen=new Set<string>(), visited=new Set<string>()
    let path: string | undefined=seriesPath(mangaId), page=1
    while(path) {
      if(visited.has(path)) throw new Error('회차 페이지가 반복되었습니다.')
      visited.add(path)
      const current: string=path, $=cheerio.load(await this.html(current,base)), before=chapters.length
      $('#comic-episode-list > li').each((_,e)=>{
        const row=$(e), button=row.find('button').first()
        const href=row.find('a[href]').attr('href') || /location\.href\s*=\s*['"]([^'"]+)['"]/.exec(button.attr('onclick') || '')?.[1]
        if(!href) throw new Error('회차 링크를 확인하지 못했습니다. 인증이나 구매가 필요한 회차는 지원하지 않습니다.')
        const target=local(href,base), board=param(target,'bo_table'), wr=param(target,'wr_id'), work=param(target,'is')
        if(!/^(toons|toon)$/.test(board) || !/^\d+$/.test(wr) || (work && work!==mangaId)) throw new Error('회차 식별자가 올바르지 않습니다.')
        const id=board+':'+wr
        if(seen.has(id)) return
        const name=row.find('.episode-title').text().trim() || button.text().trim(), day=/(\d{2})\.(\d{2})\.(\d{2})/.exec(row.find('.free-date').text())
        const time=day?new Date('20'+day[1]+'-'+day[2]+'-'+day[3]+'T00:00:00+09:00'):undefined
        seen.add(id);chapters.push(App.createChapter({id,name,chapNum:parseFloat(/(\d+(?:\.\d+)?)\s*화/.exec(name)?.[1] || '') || 0,
          langCode:'ko',sortingIndex:-chapters.length,time:time && Number.isFinite(time.getTime())?time:undefined}))
      })
      if(chapters.length===before) throw new Error('회차 목록이 비어 있거나 페이지 진행이 멈췄습니다.')
      path=this.next($,current,base,page)
      page++
    }
    return chapters
  }
  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const match=/^(toons|toon):(\d+)$/.exec(chapterId)
    if(!match) throw new Error('회차 식별자가 올바르지 않습니다.')
    const base=await this.base(), path='/bbs/board.php?bo_table='+match[1]+'&is='+requireId(mangaId)+'&wr_id='+match[2]
    return App.createChapterDetails({id:chapterId,mangaId,pages:parseImages(await this.html(path,base),base)})
  }
  async getCloudflareBypassRequestAsync(): Promise<Request> { return App.createRequest({url:await this.base()+'/',method:'GET'}) }
  getMangaShareUrl(mangaId: string): string {
    // SDK share URL is synchronous. This promise-free default is replaced by the
    // most recently retrieved configured origin after any normal source call.
    return this.shareBase + seriesPath(mangaId)
  }
  private shareBase = DEFAULT_BASE
}
