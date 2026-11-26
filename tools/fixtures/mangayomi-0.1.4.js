const mangayomiSources = [
  {
    "name": "SBXH9 만화 (실험)",
    "id": 2841905963,
    "baseUrl": "https://sbxh9.com",
    "lang": "ko",
    "typeSource": "single",
    "iconUrl": "https://sbxh9.com/favicon.ico",
    "dateFormat": "",
    "dateFormatLocale": "ko_KR",
    "isNsfw": true,
    "hasCloudflare": true,
    "sourceCodeUrl": "https://raw.githubusercontent.com/andy0405-bot/mangayomi-sbxh/main/source.js",
    "apiUrl": "",
    "version": "0.1.4",
    "isManga": true,
    "itemType": 0,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "정상 응답 또는 앱 WebView에서 전체 페이지 주소를 확인한 회차만 지원"
  }
];

class DefaultExtension extends MProvider {
  constructor() { super(); this.client = new Client({useDartHttpClient: true}); }
  get base() { return (this.source && this.source.baseUrl) || "https://sbxh9.com"; }
  absolute(href) {
    if (!href) return "";
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf("//") === 0) return "https:" + href;
    return this.base + (href.charAt(0) === "/" ? href : "/" + href);
  }
  path(url) {
    return url.replace(/^https?:\/\/[^/]+/i, "") || "/";
  }
  async doc(path) {
    var url = this.absolute(path);
    var response = await this.client.get(url, {
      "User-Agent": "Mozilla/5.0 (compatible; Mangayomi)",
      "Referer": this.base + "/"
    });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error("HTTP " + response.statusCode + " " + this.path(url));
    var html = response.body || "";
    if (!html || /(?:403 Forbidden|Access Denied|개발자 도구 차단)/i.test(html.substring(0, 1000))) {
      throw new Error("사이트 응답이 차단됐거나 비어 있음. 브라우저 HTML만으로 실접속은 확인되지 않음.");
    }
    return new Document(html);
  }
  text(el) { return el ? String(el.text || "").trim() : ""; }
  attr(el, key) { return el ? String(el.attr(key) || "") : ""; }
  async listing(page, byEpisode) {
    const doc = await this.doc("/manhwa/updates" + (page === 1 ? "" : "?page=" + page));
    const pager = doc.select(".upd-pager")[0];
    const active = pager && Number(this.text(pager.selectFirst(".is-active")));
    if (page > 1 && active !== page) return {list: [], hasNextPage: false};
    const hasNextPage = !!pager && pager.select('button[aria-label="끝 페이지"]:not([disabled])').length > 0;
    const list = [], seen = new Set(), times = {};
    for (const card of doc.select("li.upd-card")) {
      const episode = this.attr(card.selectFirst("a.upd-card-main"), "href");
      const series = this.attr(card.selectFirst("a.upd-allbtn"), "href") ||
        episode.replace(/^(\/manhwa\/[^/]+)\/[^/]+$/, "$1");
      const name = this.text(card.selectFirst(".upd-title"));
      if (!series || !name) continue;
      const clock = card.selectFirst("time.upd-thumb-time");
      const iso = this.attr(clock, "datetime") || this.attr(clock, "title");
      const label = this.text(clock);
      if (episode && /^\d\d\/\d\d \d\d:\d\d$/.test(label) && Number.isFinite(Date.parse(iso))) {
        times[episode] = [String(Date.parse(iso)), label];
      }
      const key = byEpisode ? episode || series : series;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({name, link: this.absolute(series),
        imageUrl: this.absolute(this.attr(card.selectFirst(".upd-thumb img"), "src"))});
    }
    if (Object.keys(times).length) {
      new SharedPreferences().setString("updates-v1-" + ((page - 1) % 10), JSON.stringify(times));
    }
    return {list, hasNextPage: !!list.length && hasNextPage};
  }
  getPopular(page) { return this.listing(page, false); }
  getLatestUpdates(page) { return this.listing(page, true); }

  recentUploadTimes() {
    // One snapshot per recently browsed listing page, scoped by the app to this source.
    const prefs = new SharedPreferences(), times = {};
    for (let i = 0; i < 10; i++) {
      const saved = prefs.getString("updates-v1-" + i, "");
      if (saved) {
        try { Object.assign(times, JSON.parse(saved)); } catch (_) { /* Old cache entry */ }
      }
    }
    return times;
  }
  async search(query, page, filters) {
    if (page > 1) return {list:[],hasNextPage:false};
    // Search HTML was not part of the supplied snapshots; do not claim supported.
    // Best-effort use of verified search form parameters.
    var d = await this.doc("/search?q=" + encodeURIComponent(query || "") + "&field=title&match=contains");
    var links = d.select('a[href^="/manhwa/"]');
    var list = [], seen = {};
    for (var i=0; i<links.length; i++) {
      var a=links[i], href=this.attr(a,"href");
      if (!/^\/manhwa\/[^/]+$/.test(href)) continue;
      var name=this.text(a);
      if (!name || name === "만화" || name === "전편보기" || seen[href]) continue;
      seen[href]=true;
      list.push({name:name,link:this.absolute(href)});
    }
    return {list:list,hasNextPage:false};
  }
  async allChapterRows(path, firstDocument) {
    let doc = firstDocument, page = 1;
    const rows = [], seen = new Set(), unavailable = new Set();
    const countText = this.text(doc.selectFirst(".ep-section-count")).replace(/,/g, "");
    const countMatch = /(\d+)/.exec(countText);
    const expected = countMatch ? Number(countMatch[1]) : null;
    while (true) {
      const pager = doc.select(".episode-pager")[0];
      if (pager && Number(this.text(pager.selectFirst(".is-active"))) !== page) {
        throw new Error("회차 페이지 응답 불일치: 요청 " + page + "페이지.");
      }
      const before = rows.length + unavailable.size;
      for (const item of doc.select("li.ep-row-v2")) {
        if (item.select("a.ep-row-v2-link").length || !item.select(".ep-row-v2-link.is-disabled").length) continue;
        const ref = this.attr(item, "data-episode-ref");
        if (!ref) throw new Error("열람 불가 회차의 식별자를 확인하지 못했어.");
        unavailable.add(ref);
      }
      for (const row of doc.select("li.ep-row-v2 a.ep-row-v2-link")) {
        const href = this.attr(row, "href");
        const address = this.absolute(href);
        if (!href || this.path(address).split("?")[0].indexOf(path + "/") !== 0) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        rows.push(row);
      }
      if (rows.length + unavailable.size === before && (page > 1 || expected > 0)) {
        throw new Error("회차 목록 진행이 멈췄어 (" + page + "페이지, " + rows.length + "회차). 다시 시도해 줘.");
      }
      let next = null;
      if (pager) {
        for (const link of pager.select("a[href]")) {
          const href = this.attr(link, "href");
          const target = this.path(this.absolute(href));
          const match = /[?&]epage=(\d+)(?:&|$)/.exec(target);
          if (target.split("?")[0] !== path || !match) continue;
          const candidate = Number(match[1]);
          if (candidate > page && (!next || candidate < next.page)) next = {page: candidate, href};
        }
      }
      if (!next) {
        if (expected !== null && rows.length + unavailable.size !== expected) {
          throw new Error("전체 회차 수 불일치: " + rows.length + "개, 열람 불가 " + unavailable.size + "개 / 총 " + expected + ". 목록 변경 또는 누락을 확인해 줘.");
        }
        return rows;
      }
      if (next.page !== page + 1) throw new Error("연속된 다음 회차 페이지 링크를 찾지 못했어.");
      page = next.page;
      try {
        doc = await this.doc(next.href);
      } catch (error) {
        throw new Error("회차 " + page + "페이지를 가져오지 못했어 (" + rows.length + "회차 수신). " + String(error));
      }
    }
  }

  async getDetail(url) {
    var path=this.path(url);
    // Follow series page rather than episode page.
    var bits=path.split("/").filter(Boolean);
    if (bits.length > 2 && bits[0] === "manhwa") path="/"+bits.slice(0,2).join("/");
    var d=await this.doc(path);
    var title=this.text(d.selectFirst("h1.hero-v2-title"));
    var cover=d.selectFirst('meta[property="og:image"]');
    var intro=d.select(".hero-v2-description")[0] || d.selectFirst(".hero-v2-synopsis");
    var author=d.selectFirst(".hero-v2-author");
    var genreEls=d.select(".hero-v2-tags a, .hero-v2-genres a, .hero-v2-genre a");
    var genres=[];
    for (var i=0;i<genreEls.length;i++) { var g=this.text(genreEls[i]); if(g) genres.push(g.replace(/^#/,"")); }
    var rows=await this.allChapterRows(path, d);
    const times = this.recentUploadTimes();
    var chapters=[],seen={};
    for(var j=0;j<rows.length;j++) {
      var row=rows[j],href=this.attr(row,"href");
      if(!href || seen[href]) continue;
      seen[href]=true;
      var name=this.text(row.selectFirst(".ep-row-v2-title strong")) || this.text(row.selectFirst(".ep-row-v2-title"));
      const chapter = {name:name||("회차 "+(j+1)),url:this.absolute(href)};
      const upload = times[href];
      if (upload) {
        chapter.dateUpload = upload[0];
        chapter.scanlator = "업로드 " + upload[1];
      } else {
        const day = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(this.text(row.selectFirst(".ep-row-v2-date")));
        if (day) {
          const stamp = Date.parse("20"+day[1]+"-"+day[2]+"-"+day[3]+"T00:00:00+09:00");
          if (Number.isFinite(stamp)) chapter.dateUpload = String(stamp);
        }
      }
      chapters.push(chapter);
    }
    if(!title) throw new Error("상세 페이지 제목 선택자를 찾지 못함 (구조 변경 또는 차단)");
    return {name:title,link:this.absolute(path),imageUrl:this.absolute(this.attr(cover,"content")),
      author:this.text(author),description:this.text(intro),genre:genres,
      status: d.select(".pill-status.ongoing").length ? 0 : 5, chapters:chapters};
  }
  pageAddress(value, chapter) {
    const ref = (value || "").trim();
    if (!ref || /^[?#]/.test(ref) || /[\s\\]/.test(ref)) return "";
    if (/^https?:\/\/[^/?#]+/i.test(ref)) return ref;
    if (/^[a-z][\w+.-]*:/i.test(ref)) return "";
    const origin = chapter.match(/^(https?:)\/\/[^/?#]+/i);
    if (!origin) return "";
    if (ref.startsWith("//")) return origin[1] + ref;
    const basePath = chapter.slice(origin[0].length).split(/[?#]/)[0];
    const path = ref.startsWith("/") ? ref : basePath.replace(/[^/]*$/, "") + ref;
    const suffix = path.search(/[?#]/);
    const parts = (suffix < 0 ? path : path.slice(0, suffix)).split("/");
    const clean = [];
    for (const part of parts.slice(1)) {
      if (part === "..") clean.pop();
      else if (part !== ".") clean.push(part);
    }
    return origin[0] + "/" + clean.join("/") + (suffix < 0 ? "" : path.slice(suffix));
  }

  async getPageList(url) {
    const chapter = this.absolute(url);
    const doc = await this.doc(chapter);
    const container = doc.select(".vw-imgs")[0];
    const expected = Number(this.attr(container, "data-viewer-image-count"));
    const pages = new Set();
    let missing = false;
    for (const img of doc.select(".vw-imgs img.viewer-ratio-img")) {
      const address = this.pageAddress(this.attr(img, "data-src"), chapter)
        || this.pageAddress(this.attr(img, "src"), chapter);
      if (address) pages.add(address);
      else missing = true;
    }
    const asPages = urls => urls.map(url => ({url, headers: {Referer: this.base + "/"}}));
    if (pages.size && !missing && (expected ? pages.size === expected : this.attr(container, "data-viewer-virtualized") !== "1")) {
      return asPages(Array.from(pages));
    }

    if (!container && !doc.select(".vw-root .viewer-loading").length) {
      throw new Error("회차 본문 뷰어를 찾지 못했어. 페이지 형식 또는 접근 상태를 확인해 줘.");
    }
    // Use the site's normal reader. No private APIs, session export or script modification.
    const script = "(" + readerScript + ")(" + JSON.stringify(chapter) + ")";
    const result = await evaluateJavascriptViaWebview(chapter, {}, [script], 95);
    if (!result) throw new Error("앱 WebView에서 회차 이미지 목록을 받지 못했어.");
    const data = JSON.parse(result);
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data.urls) || !data.urls.length ||
        data.urls.some(address => typeof address !== "string" || !/^https?:\/\//i.test(address)) ||
        new Set(data.urls).size !== data.urls.length) {
      throw new Error("WebView가 유효한 회차 이미지 목록을 반환하지 않았어.");
    }
    return asPages(data.urls);
  }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}


const readerScript = String.raw`function readRenderedChapter(chapter) {
  const send = value => window.flutter_inappwebview.callHandler("setResponse", JSON.stringify(value));
  const deadline = Date.now() + 80000;
  const urls = new Map();
  let expected = 0;
  let started = false;
  function collect() {
    const target = new URL(chapter);
    if (location.origin !== target.origin || location.pathname !== target.pathname) {
      send({error: "회차 URL이 다른 페이지로 이동했어."});
      return;
    }
    const viewer = document.querySelector(".vw-imgs");
    if (viewer) {
      expected = Number(viewer.getAttribute("data-viewer-image-count"));
      const images = Array.from(viewer.querySelectorAll("img.viewer-ratio-img"));
      const numbered = [];
      for (const img of images) {
        const match = /^page\s+(\d+)$/i.exec(img.alt.trim());
        if (!match) continue;
        const n = Number(match[1]);
        if (n < 1 || n > expected) continue;
        numbered.push(n);
        // A lazy img can have a valid address before the browser decodes the pixels.
        for (const raw of [img.getAttribute("data-src"), img.currentSrc, img.getAttribute("src")]) {
          if (!raw || !raw.trim() || /^[?#]/.test(raw.trim())) continue;
          try {
            const address = new URL(raw, document.baseURI);
            if (/^https?:$/.test(address.protocol)) {
              urls.set(n, address.href);
              break;
            }
          } catch (_) { /* Try the next DOM attribute. */ }
        }
      }
      if (expected > 0 && urls.size === expected) {
        const pages = Array.from({length: expected}, (_, i) => urls.get(i + 1));
        if (pages.every(Boolean)) {
          send({urls: pages});
          return;
        }
      }
      if (!started) {
        viewer.scrollIntoView({block: "start"});
        started = true;
      } else if (numbered.length) {
        let next = 1;
        while (urls.has(next)) next++;
        // An unmounted gap may lie above the current viewport. Walk back to it.
        const direction = next < Math.min(...numbered) ? -1 : 1;
        if (!numbered.includes(next)) {
          window.scrollBy(0, direction * Math.max(1, Math.round(window.innerHeight * 0.8)));
        } else {
          const waiting = images.find(img => img.alt.trim().toLowerCase() === "page " + next);
          if (waiting) waiting.scrollIntoView({block: "center"});
        }
      }
    }
    if (Date.now() >= deadline) {
      send({error: "앱 WebView에서 확인한 회차 이미지 " + urls.size + "/" +
        (expected || "?") + "장. 일반 웹뷰에서 회차 표시 상태를 확인해 줘."});
      return;
    }
    setTimeout(collect, 200);
  }
  collect();
}`;
