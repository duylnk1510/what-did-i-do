# what-did-i-do

GitHub Organization에서 내 커밋 기록을 수집하는 CLI 도구입니다.

## 요구사항

- Node.js 18+
- GitHub CLI (`gh`)

### GitHub CLI 설치

```bash
# macOS
brew install gh

# Windows
winget install GitHub.cli

# Linux
# https://github.com/cli/cli/blob/trunk/docs/install_linux.md
```

### GitHub CLI 인증

```bash
gh auth login
```

## 사용법

```bash
node index.js
```

## 기능

- 로그인된 GitHub 계정의 Organization 목록 자동 조회
- 화살표 키로 Organization 선택
- 과거 핸들/이메일 추가 검색 지원
- 모든 레포지토리에서 내 커밋 수집
- 커밋 일시 기준 정렬
- 실시간 마크다운 파일 저장

## 출력 형식

`commits-{org}-{timestamp}.md` 파일로 저장됩니다.

| 일시 | 레포지토리 | 커밋 메시지 | 링크 |
|------|------------|-------------|------|
| 2026-01-07 12:30:45 | repo-name | 커밋 내용 | [링크](https://github.com/...) |
