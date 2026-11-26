import assert from 'node:assert/strict'
import fs from 'node:fs'
const summary: Record<string, unknown> = {testedAt: new Date().toISOString(), runtime: process.version}
;(globalThis as any).App = new Proxy({}, {
  get: (_, key) => key === 'createRequestManager' ? (options: any) => ({
    getDefaultUserAgent: async () => 'Mozilla/5.0',
    schedule: async (request: any) => {
      const prepared = await options.interceptor.interceptRequest(request)
      const response = await fetch(prepared.url, {method: prepared.method, headers: prepared.headers,
        body: prepared.method === 'GET' ? undefined : prepared.data, signal: AbortSignal.timeout(20000)})
      return {data: await response.text(), status: response.status, headers: Object.fromEntries(response.headers), request}
    }
  }) : (value: any) => value
})
async function main() {
  const {SBXH, flightData, orderedImages} = await import('../src/SBXH/SBXH')
  assert.throws(() => orderedImages([{page: 2, src:'https://example.com/2'}]))
  assert.throws(() => orderedImages([{page: 1, src:'javascript:bad'}]))
  assert.deepEqual(orderedImages([{page:2,src:'https://example.com/2'}, {page:1,src:'https://example.com/1'}]), ['https://example.com/1','https://example.com/2'])
  assert.equal(flightData('<script>self.__next_f.push([1,"hello"])</script>'),'hello')
  const source = new SBXH()
  const sections: any[] = []
  await source.getHomePageSections(async section => {sections.push(section)})
  assert.equal(sections.length,6)
  assert(sections.slice(3).every(s=>s.items.length > 0))
  summary.sections = sections.slice(3).map(s=>({id:s.id,count:s.items.length,first:s.items[0].title}))
  const next = await source.getViewMoreItems('updates',{page:2})
  assert(next.results.length)
  summary.latestPage2 = next.results.length
  const search = await source.getSearchResults({title:'발할라'} as any,undefined)
  assert(search.results.some(s=>s.mangaId === '24945'))
  summary.searchResults = search.results.length
  const details = await source.getMangaDetails('27147')
  assert(details.mangaInfo.titles[0].includes('마을사람'))
  const chapters = await source.getChapters('27147')
  assert(chapters.length > 1)
  summary.chapters = chapters.length
  const target = chapters.find(c=>c.name === '49화')!
  assert(target)
  const images = await source.getChapterDetails('27147',target.id)
  assert.equal(images.pages.length,26)
  summary.imageUrls = images.pages.length
  const imageTests = []
  for (const index of [0,12,25]) {
    try {
      const r = await fetch(images.pages[index],{headers:{Referer:'https://sbxh9.com/'}, signal:AbortSignal.timeout(10000)})
      const bytes = new Uint8Array(await r.arrayBuffer())
      imageTests.push({page:index+1,status:r.status,type:r.headers.get('content-type'),bytes:bytes.length})
    } catch(e: any) { imageTests.push({page:index+1,error:e.cause?.code || e.message}) }
  }
  summary.sampleImageDownloads = imageTests
  summary.iosVerified = false
  fs.writeFileSync('work/test-results.json',JSON.stringify(summary,null,2)+'\n')
  console.log(JSON.stringify(summary,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})

