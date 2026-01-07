#!/usr/bin/env node

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const clear = () => process.stdout.write('\x1B[2J\x1B[H');
const clearLine = () => process.stdout.write('\x1B[2K\r');
const moveCursorUp = (n) => process.stdout.write(`\x1B[${n}A`);
const hideCursor = () => process.stdout.write('\x1B[?25l');
const showCursor = () => process.stdout.write('\x1B[?25h');

function execCommand(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  } catch (error) {
    return null;
  }
}

function select(message, choices) {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    hideCursor();

    const render = (isInitial = false) => {
      if (!isInitial) {
        moveCursorUp(choices.length);
      }
      choices.forEach((choice, index) => {
        clearLine();
        const prefix = index === selectedIndex ? '\x1B[36m❯' : ' ';
        const text = index === selectedIndex ? `\x1B[36m${choice.name}` : `\x1B[90m${choice.name}`;
        console.log(`${prefix} ${text}\x1B[0m`);
      });
    };

    console.log(`\x1B[1m${message}\x1B[0m\n`);
    render(true);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      showCursor();
    };

    const onKeypress = (str, key) => {
      if (key.name === 'up') {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : choices.length - 1;
        render();
      } else if (key.name === 'down') {
        selectedIndex = selectedIndex < choices.length - 1 ? selectedIndex + 1 : 0;
        render();
      } else if (key.name === 'return') {
        cleanup();
        process.stdin.pause();
        moveCursorUp(choices.length + 2);
        for (let i = 0; i < choices.length + 2; i++) {
          clearLine();
          console.log('');
        }
        moveCursorUp(choices.length + 2);
        console.log(`\x1B[32m✔\x1B[0m ${message}: \x1B[36m${choices[selectedIndex].name}\x1B[0m\n`);
        resolve(choices[selectedIndex].value);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        process.stdin.pause();
        clear();
        process.exit(0);
      }
    };

    process.stdin.on('keypress', onKeypress);
    process.stdin.resume();
  });
}

function checkGhCli() {
  const ghVersion = execCommand('gh --version');
  if (!ghVersion) {
    console.error('\x1B[31m✘ GitHub CLI(gh)가 설치되어 있지 않습니다.\x1B[0m\n');
    console.error('설치 방법:');
    console.error('  macOS:   brew install gh');
    console.error('  Windows: winget install GitHub.cli');
    console.error('  Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md\n');
    process.exit(1);
  }

  const authStatus = execCommand('gh auth status');
  if (!authStatus) {
    console.error('\x1B[31m✘ GitHub CLI 인증이 필요합니다.\x1B[0m\n');
    console.error('다음 명령어를 실행해주세요:');
    console.error('  gh auth login\n');
    process.exit(1);
  }
}

function getGitHubUser() {
  const result = execCommand('gh api user --jq .login');
  if (!result) {
    console.error('\x1B[31m✘ GitHub 사용자 정보를 가져올 수 없습니다.\x1B[0m\n');
    process.exit(1);
  }
  return result;
}

function getUserOrganizations() {
  const result = execCommand('gh api user/orgs --jq ".[].login"');
  if (!result) {
    return [];
  }
  return result.split('\n').filter(Boolean);
}

function getOrgRepos(org) {
  const result = execCommand(
    `gh repo list ${org} --limit 1000 --json name,url,sshUrl --jq '.[] | "\\(.name)|\\(.url)"'`
  );
  if (!result) {
    return [];
  }
  return result.split('\n').filter(Boolean).map((line) => {
    const [name, url] = line.split('|');
    return { name, url };
  });
}

function getUserEmail() {
  return execCommand('git config user.email') || '';
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function cloneAndGetCommits(repo, org, authors, tempDir) {
  const repoPath = path.join(tempDir, repo.name);
  const cloneUrl = `https://github.com/${org}/${repo.name}.git`;

  try {
    await execAsync(`git clone --quiet --filter=blob:none "${cloneUrl}" "${repoPath}"`);
  } catch (error) {
    return [];
  }

  const authorFilters = authors.map((a) => `--author="${a}"`).join(' ');

  let commits;
  try {
    const { stdout } = await execAsync(
      `git log --all ${authorFilters} --format="%H<|>%s<|>%aI" --date=iso`,
      { cwd: repoPath, maxBuffer: 50 * 1024 * 1024 }
    );
    commits = stdout.trim();
  } catch (error) {
    fs.rmSync(repoPath, { recursive: true, force: true });
    return [];
  }

  if (!commits) {
    fs.rmSync(repoPath, { recursive: true, force: true });
    return [];
  }

  const commitLines = commits.split('\n').filter(Boolean);
  const result = [];

  for (const line of commitLines) {
    const parts = line.split('<|>');
    if (parts.length < 3) continue;

    const hash = parts[0];
    const message = parts[1];
    const date = parts[2];

    result.push({
      hash,
      message,
      date,
      repoName: repo.name,
      repoUrl: repo.url
    });
  }

  fs.rmSync(repoPath, { recursive: true, force: true });
  return result;
}

function cleanupTempDirs() {
  const cwd = process.cwd();
  const entries = fs.readdirSync(cwd);
  for (const entry of entries) {
    if (entry.startsWith('.temp-repos-')) {
      fs.rmSync(path.join(cwd, entry), { recursive: true, force: true });
    }
  }
}

async function main() {
  cleanupTempDirs();
  clear();
  console.log('\x1B[1m=== GitHub Organization 커밋 수집기 ===\x1B[0m\n');

  checkGhCli();

  clearLine();
  process.stdout.write('GitHub 사용자 정보 확인 중...');
  const username = getGitHubUser();
  const userEmail = getUserEmail();
  clearLine();
  console.log(`\x1B[32m✔\x1B[0m 사용자: \x1B[36m${username}\x1B[0m ${userEmail ? `(${userEmail})` : ''}\n`);

  const authors = [username];
  if (userEmail) {
    authors.push(userEmail);
  }

  console.log('\x1B[90m예: old-username, old@email.com\x1B[0m');
  const extraAuthors = await prompt('추가 검색할 이메일/핸들 (없으면 Enter): ');
  if (extraAuthors) {
    extraAuthors.split(',').map((a) => a.trim()).filter(Boolean).forEach((a) => authors.push(a));
  }
  console.log(`\x1B[32m✔\x1B[0m 검색 대상: ${authors.join(', ')}\n`);

  clearLine();
  process.stdout.write('조직 목록을 가져오는 중...');
  const orgs = getUserOrganizations().sort((a, b) => a.localeCompare(b));
  clearLine();
  console.log(`\x1B[32m✔\x1B[0m ${orgs.length}개의 조직 발견\n`);

  const choices = [
    { name: `${username} (개인 레포지토리)`, value: username },
    ...orgs.map((org) => ({ name: org, value: org }))
  ];

  const org = await select('조직 선택', choices);

  clearLine();
  process.stdout.write(`${org}의 레포지토리 목록을 가져오는 중...`);
  const repos = getOrgRepos(org);
  clearLine();

  if (repos.length === 0) {
    console.log('\x1B[31m✘\x1B[0m 레포지토리를 찾을 수 없습니다.\n');
    process.exit(1);
  }

  console.log(`\x1B[32m✔\x1B[0m ${repos.length}개의 레포지토리 발견\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = path.join(process.cwd(), `commits-${org}-${timestamp}.md`);

  const tempDir = path.join(process.cwd(), `.temp-repos-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const allCommits = [];

  const writeHeader = () => {
    fs.writeFileSync(outputFile, `# ${org} - ${username}의 커밋 기록\n\n`);
    fs.appendFileSync(outputFile, `생성일시: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n\n`);
    fs.appendFileSync(outputFile, `| 일시 | 레포지토리 | 커밋 메시지 | 링크 |\n`);
    fs.appendFileSync(outputFile, `|------|------------|-------------|------|\n`);
  };

  const formatCommit = (commit) => {
    const d = new Date(commit.date);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const formattedDate = kst.toISOString().replace('T', ' ').slice(0, 19);
    const commitUrl = `${commit.repoUrl}/commit/${commit.hash}`;
    return `| ${formattedDate} | ${commit.repoName} | ${commit.message.replace(/\|/g, '\\|')} | [링크](${commitUrl}) |\n`;
  };

  const writeAllCommits = () => {
    writeHeader();
    const sorted = [...allCommits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    for (const commit of sorted) {
      fs.appendFileSync(outputFile, formatCommit(commit));
    }
  };

  writeHeader();

  const total = repos.length;

  for (const repo of repos) {
    console.log(`  \x1B[90m○ ${repo.name}\x1B[0m`);
  }
  console.log(`\x1B[90m[0/${total}]\x1B[0m`);

  let completed = 0;

  const render = () => {
    process.stdout.write(`\x1B[${total + 1}A`);
    for (let i = 0; i < total; i++) {
      clearLine();
      const repo = repos[i];
      const result = repoResults[i];
      if (result === undefined) {
        console.log(`  \x1B[90m○ ${repo.name}\x1B[0m`);
      } else if (result > 0) {
        console.log(`  \x1B[32m● ${repo.name} → ${result}개\x1B[0m`);
      } else {
        console.log(`  \x1B[90m● ${repo.name}\x1B[0m`);
      }
    }
    clearLine();
    console.log(`\x1B[90m[${completed}/${total}]\x1B[0m`);
  };

  const repoResults = new Array(total).fill(undefined);

  const results = await Promise.all(
    repos.map(async (repo, index) => {
      const commits = await cloneAndGetCommits(repo, org, authors, tempDir);
      completed++;
      repoResults[index] = commits.length;
      render();
      return { repo, commits };
    })
  );

  for (const { repo, commits } of results) {
    if (commits.length > 0) {
      allCommits.push(...commits);
    }
  }

  writeAllCommits();

  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('');
  console.log('\x1B[1m=== 완료 ===\x1B[0m');
  console.log(`총 \x1B[36m${allCommits.length}개\x1B[0m의 커밋을 발견했습니다.`);
  console.log(`결과 파일: \x1B[4m${outputFile}\x1B[0m\n`);

  process.exit(0);
}

main().catch((error) => {
  cleanupTempDirs();
  showCursor();
  console.error('\n\x1B[31m오류 발생:\x1B[0m', error.message);
  process.exit(1);
});
