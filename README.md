# Paperback 0.8 — SBXH 한국어 0.1.0 시험판

Paperback v0.8.11-r1의 실제 설치와 렌더링은 아직 미검증입니다.
Windows Node.js 24에서 @paperback/types 및 toolchain 0.8.0-alpha.38로 빌드했습니다.

## 기능

최신 업데이트, 신규 등록(사이트 신작순), 조회순 목록과 페이지 이동을 지원합니다.
한국어 작품명 검색, 작품 대표 표지·작가·설명, 회차 목록을 제공합니다.
최신 회차와 업로드 시각은 카드 부제로 전달합니다. UI 표시는 iPhone에서 확인해야 합니다.
서재 갱신 때 앱이 getChapters를 호출하면 현재 회차 목록을 반환합니다.
앱의 자동 갱신 주기와 알림 동작은 iPhone에서 확인해야 합니다.
검색 결과는 /manhwa/ 작품을 표시합니다. 같은 페이지의 동일 작품은 하나로 합칩니다.

## 이미지 제공 조건

정적 본문에 전체 주소가 있으면 이를 사용합니다. 그렇지 않으면 일반 뷰어의 이미지 JSON을 읽습니다.
페이지에 adVerificationEnabled:false가 명시되고 이미지 토큰이 있을 때만 이미지 목록을 요청합니다.
401·403·428은 접근 오류로 처리합니다. 추가 인증이 필요한 회차는 지원하지 않습니다.
브라우저 서명·지문 등록·인증 쿠키 추출·보호 기능 변경은 구현하지 않았습니다.
정당한 열람 권한이 있는 콘텐츠에 사용하세요. 사이트의 자동화 허용 약관과 콘텐츠별 배포 권한은 확인되지 않았습니다.

## 개발 및 검증

표준 Node.js와 npm 환경에서 프로젝트 폴더 안에서 실행합니다.

    npm ci --ignore-scripts
    npm run check
    npm test
    npm run bundle -- --folder 0.8

npm test는 실제 사이트에 읽기 요청을 보내고 work/test-results.json을 생성합니다.
현재 PC에는 work/npm에 npm을 준비했으며, 전역 설치 없이 build.ps1로 빌드할 수 있습니다.
버전은 package-lock.json으로 고정했습니다. 오래된 0.8 도구의 간접 의존성 경고가 있어 개발 전용으로 사용합니다.

## GitHub Pages 배포

예정 저장소는 andy0405-bot/paperback-sbxh입니다. 현재 공개 배포 전 단계입니다.
전체 소스를 새 저장소에 반영하고 Settings > Pages의 Source를 GitHub Actions로 설정합니다.
.github/workflows/pages.yml이 타입 검사와 빌드 후 bundles를 배포합니다.

예정 Repository Base URL

    https://andy0405-bot.github.io/paperback-sbxh/0.8/

배포 후 versioning.json에 SBXH 0.1.0이 존재하는지 확인합니다.
Pages에는 확장 코드만 배포합니다. 사이트 이미지나 회차 토큰을 저장하지 않습니다.

## iPhone 설치와 확인

배포 후 예정 주소를 Safari에서 열고 Add to Paperback을 사용합니다.
또는 Paperback의 Settings > External Sources에서 Repository Base URL로 위 주소를 추가합니다.
저장소에서 SBXH 한국어를 설치합니다. ADULT 등급이므로 앱 콘텐츠 표시 설정의 영향을 받습니다.

1. 최신·신규 등록·조회순 목록과 View More 확인
2. 발할라 검색 후 상세와 회차 목록 확인
3. 마을사람 A는 악역 아가씨를 어떻게든 구하고 싶어 49화의 26쪽 확인
4. 첫 장·13쪽·마지막 장 표시 확인
5. 서재 갱신과 새 회차 인식 확인

실패하면 앱·소스 버전, 작품명, 회차, 페이지 번호, 오류 메시지를 기록하세요.

## 유지보수

src/SBXH/SBXH.ts의 BASE에서 도메인을 수정합니다.
선택자는 listing, getSearchResults, getMangaDetails, getChapters에서 관리합니다.
이미지 응답은 getChapterDetails와 orderedImages에서 검사합니다.
수정 후 SBXHInfo.version을 올리고 검사·테스트·빌드 후 main에 반영합니다.
Pages 성공 후 iPhone에서 소스를 업데이트합니다.
날짜만 제공되는 회차에 업로드 시간을 만들어 붙이지 않습니다.
사이트가 긴 회차 목록을 별도로 페이지화하면 추가 구현이 필요할 수 있습니다.

## 검증 결과

TEST-RESULTS.json은 Windows 실제 요청 기록입니다.
최신 43작품, 신규 등록 49작품, 조회순 42작품, 최신 2페이지 40작품을 읽었습니다.
발할라 검색 2작품, 대상 작품 70회차, 49화 이미지 주소 26개를 확인했습니다.
1·13·26쪽 이미지 다운로드는 모두 HTTP 200이었습니다.
iPhone 설치·렌더링·자동 갱신, 인증 회차는 미검증입니다.

## 참고한 원본

공식 0.8 설정 https://github.com/Paperback-iOS/extensions/blob/main/package.json
공식 개발 가이드 https://github.com/Paperback-iOS/website/blob/master/src/contributing/extension-development/quick-start.md
공식 배포 예제 https://github.com/Paperback-iOS/extensions/blob/main/.github/workflows/main.yml
기존 Mangayomi 코드 https://github.com/andy0405-bot/mangayomi-sbxh
