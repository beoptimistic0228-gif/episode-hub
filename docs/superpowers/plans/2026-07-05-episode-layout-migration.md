# 산출물 에피소드별 재배치 (프로젝트 ①) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주간 파이프라인 산출물을 `output/episodes/<episode_id>/` 에피소드 단위 8그룹 구조로 재배치하고, 전 에이전트가 `lib_output.episode_dir()` 단일 헬퍼로 경로를 얻게 한다.

**Architecture:** 경로 계산을 `lib_output`에 단일화 → 산출물 쓰는 에이전트 9종의 저장 경로만 교체(입력 `data/*.json` 경로는 불변) → 레거시 1회 마이그레이션 → 전 파이프라인 스모크. 스펙: `docs/superpowers/specs/2026-07-05-episode-hub-design.md` §3.

**Tech Stack:** Python 3 (표준 라이브러리만, `pathlib`·`shutil`·`re`) — 기존 orchestrator 패턴 그대로. 테스트 = 레포 관례인 `__main__` 스모크 블록(`python -m agents.<mod>`) + 실행 검증.

## Global Constraints

- **$0 원칙**: 유료 API·신규 의존성 금지 — 표준 라이브러리만.
- **입력 경로 불변**: `data/*.json` 위치·이름은 절대 바꾸지 않는다 (스펙 §7 — output만 재배치).
- **일일 분석 산출물 불변**: `output/{benchmark,patterns,insights,weekly_reports}/`, `BOARD.*`, `INDEX.md` 위치 유지.
- **그룹 8종 고정**: `planning · products · prompts · renders · script · publish · validation · manuscript` (스펙 §3-1과 1:1).
- **현행 EP**: `ep20260628_ippool-g009` (동물의 숲). 레거시 컷오프 날짜 토큰 = `20260628` 미만 → `_archive/`.
- **에이전트 5·6·7은 재실행 금지** (topic 재추첨·재크롤·확정룸 재조합 = 승인된 확정룸 오염 위험) — import 스모크만. 8~13은 재실행 안전(같은 EP 결정론 재생성).
- **커밋 컨벤션**: `refactor(orchestrator): …` / 문서는 `docs(…)`. 변경 이력 테이블(CLAUDE.md `변경 이력` 표)은 소급 수정 금지 — 신규 행 추가만.
- 작업 디렉토리: 모든 커맨드는 `C:\GitHub\nakgwan-channel-infra\orchestrator`에서 실행 (`python -m agents.<mod>`).

---

### Task 1: lib_output — 에피소드 경로 헬퍼

**Files:**
- Modify: `orchestrator/agents/lib_output.py` (함수 6개 뒤에 추가; 파일 상단에 상수)

**Interfaces:**
- Produces: `EPISODE_GROUPS: tuple[str,...]` · `episode_root(episode_id: str) -> Path` · `episode_dir(episode_id: str, group: str) -> Path` (존재 보장 mkdir, 미정의 그룹이면 `ValueError`). 이후 전 태스크가 이 두 함수만 사용.

- [ ] **Step 1: 헬퍼 + 스모크 작성**

`lib_output.py` 상단 import 아래에 추가 (`Path`는 기존 import 사용, 없으면 `from pathlib import Path` 추가):

```python
ROOT = Path(__file__).resolve().parents[1]
EPISODES_ROOT = ROOT / "output" / "episodes"
# 스펙 §3-1 — 폴더 = Episode Hub 앱 화면의 의미 단위 (1:1)
EPISODE_GROUPS = ("planning", "products", "prompts", "renders",
                  "script", "publish", "validation", "manuscript")


def episode_root(episode_id: str) -> Path:
    """에피소드 산출물 루트. episode_id는 lib_episode 규약(ep<YYYYMMDD>_<slug>)."""
    if not episode_id or not str(episode_id).startswith("ep"):
        raise ValueError(f"episode_id 형식 오류: {episode_id!r}")
    return EPISODES_ROOT / episode_id


def episode_dir(episode_id: str, group: str) -> Path:
    """에피소드 그룹 폴더 (없으면 생성). 미정의 그룹 = ValueError (오타로 폴더 늘어남 방지)."""
    if group not in EPISODE_GROUPS:
        raise ValueError(f"미정의 그룹 {group!r} — EPISODE_GROUPS: {EPISODE_GROUPS}")
    d = episode_root(episode_id) / group
    d.mkdir(parents=True, exist_ok=True)
    return d
```

파일 끝에 스모크 블록 추가:

```python
if __name__ == "__main__":
    import shutil
    _eid = "ep20990101_smoke"
    _d = episode_dir(_eid, "planning")
    assert _d == EPISODES_ROOT / _eid / "planning" and _d.is_dir(), _d
    try:
        episode_dir(_eid, "nope")
        raise SystemExit("[FAIL] 미정의 그룹이 통과됨")
    except ValueError:
        pass
    try:
        episode_root("")
        raise SystemExit("[FAIL] 빈 episode_id가 통과됨")
    except ValueError:
        pass
    shutil.rmtree(EPISODES_ROOT / _eid)
    print("[OK] lib_output episode 경로 스모크 통과")
```

- [ ] **Step 2: 스모크 실행**

Run: `python -m agents.lib_output`
Expected: `[OK] lib_output episode 경로 스모크 통과`

- [ ] **Step 3: Commit**

```bash
git add agents/lib_output.py
git commit -m "refactor(orchestrator): lib_output에 에피소드 경로 헬퍼 (episode_dir 단일화)"
```

---

### Task 2: Agent 5·6 경로 수술 (planning / products)

**Files:**
- Modify: `orchestrator/agents/agent5_topic_strategist.py:54` (`OUTPUT_DIR = ROOT / "output" / "topic_picks"`)
- Modify: `orchestrator/agents/agent6_product_curator.py:47,604-605` (`PROD_MD_DIR`)

**Interfaces:**
- Consumes: `lib_output.episode_dir(eid, "planning"|"products")` (Task 1)
- Produces: agent5 md → `episodes/<ep>/planning/topic_picks_*.md`, agent6 md → `episodes/<ep>/products/product_sheet_*.md`

- [ ] **Step 1: agent5 수술**

`agent5_topic_strategist.py:54`의 `OUTPUT_DIR = ROOT / "output" / "topic_picks"` 상수를 삭제하고, md를 쓰는 지점(파일 내 `OUTPUT_DIR` 사용처를 grep해서 찾기: `grep -n "OUTPUT_DIR" agents/agent5_topic_strategist.py`)을 다음 패턴으로 교체 — agent5는 episode_id의 **원점 생성자**이므로 md 저장 시점엔 이미 `episode_id` 변수가 존재한다:

```python
from agents.lib_output import episode_dir  # 파일 상단 기존 lib_output import 줄에 추가
# ...
md_dir = episode_dir(episode_id, "planning")   # 옛 OUTPUT_DIR.mkdir(...) 대체
md_path = md_dir / f"topic_picks_{date.today():%Y%m%d}.md"
```

- [ ] **Step 2: agent6 수술**

`agent6_product_curator.py:47` `PROD_MD_DIR = ROOT / "output" / "product_curation"` 삭제, 604-605를:

```python
md_dir = episode_dir(episode_id, "products")   # episode_id = agent5 handoff에서 이미 확보됨
md_path = md_dir / f"product_sheet_{date.today():%Y%m%d}.md"
```

(604의 `PROD_MD_DIR.mkdir(...)` 줄은 삭제 — `episode_dir`가 mkdir 보장. agent6 내 `episode_id` 변수명은 파일에서 `grep -n "episode_id" agents/agent6_product_curator.py`로 확인해 그 이름을 쓴다.)

- [ ] **Step 3: import 스모크 (5·6 재실행 금지 — Global Constraints)**

Run: `python -c "import agents.agent5_topic_strategist, agents.agent6_product_curator; print('[OK] import')"`
Expected: `[OK] import`

- [ ] **Step 4: Commit**

```bash
git add agents/agent5_topic_strategist.py agents/agent6_product_curator.py
git commit -m "refactor(orchestrator): A5·6 산출 경로 → episodes/<ep>/{planning,products}"
```

---

### Task 3: Agent 7 수술 (confirmed_room md·이미지·manifest→episode.json)

**Files:**
- Modify: `orchestrator/agents/agent7_room_composer.py:51-52` (`ASSETS_ROOT`·`ROOM_MD_DIR`), `:464-466` (`img_base`), `:887-890` (자산 폴더 루프 — 890 루프 본문까지 교체), `:902-934` (manifest 블록), `:896-897` (md 저장)

**Interfaces:**
- Consumes: `episode_dir`/`episode_root` (Task 1)
- Produces: md+제품이미지 → `episodes/<ep>/products/` (같은 폴더 — md의 이미지 상대경로 = 파일명만) · **`episodes/<ep>/episode.json`** (스키마 v1: manifest 필드 승계 + `schema_version:1`·`title`·`stage`·`approvals:{}`) · 스캐폴드 `renders/`, `publish/thumbnails/`

- [ ] **Step 1: 경로 상수 교체**

`:51-52`의 `ASSETS_ROOT = OUTPUT_DIR / "assets"`·`ROOM_MD_DIR = OUTPUT_DIR / "confirmed_room"` 삭제. 상단에 `from agents.lib_output import episode_dir, episode_root` 추가 (기존 lib_output import 줄이 있으면 그 줄 확장).

- [ ] **Step 2: md·이미지 같은 폴더 저장**

`:896-897` (md 저장)을:
```python
md_dir = episode_dir(episode_id, "products")
md_path = md_dir / f"confirmed_room_{date.today():%Y%m%d}.md"
```
`:464-466` (이미지 상대경로) — md와 이미지가 같은 `products/` 폴더가 되므로:
```python
img_base = "."   # md와 같은 폴더 — 파일명만으로 참조
```
`:887-889` (자산 폴더)를:
```python
ep_dir = episode_root(episode_id)
products_dir = episode_dir(episode_id, "products")
episode_dir(episode_id, "renders")                     # 스캐폴드
(episode_dir(episode_id, "publish") / "thumbnails").mkdir(exist_ok=True)
```

- [ ] **Step 3: manifest → episode.json 확장**

`:902-934` manifest dict에 필드 추가·개명 (기존 필드 전부 유지):
```python
episode_doc = {
    "schema_version": 1,                       # Episode Hub 앱 호환 기준 (스펙 §4-3)
    "title": concept.get("title") or episode_id,
    "stage": "확정룸",                          # 앱·후속 단계가 갱신
    "approvals": {},                            # Owner 게이트 기록 (앱이 씀)
    **manifest,                                 # 기존 manifest 필드 승계
}
(ep_dir / "episode.json").write_text(
    json.dumps(episode_doc, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"EPISODE.JSON: {(ep_dir / 'episode.json').relative_to(ROOT)}")
```
manifest 내 `asset_dirs` 안내 문자열(`:922-924`)의 `thumbnails` 값을 `"publish/thumbnails/  (썸네일 완성본 저장 위치)"`로 갱신.

- [ ] **Step 4: import 스모크 (7 재실행 금지)**

Run: `python -c "import agents.agent7_room_composer; print('[OK] import')"`
Expected: `[OK] import`

- [ ] **Step 5: Commit**

```bash
git add agents/agent7_room_composer.py
git commit -m "refactor(orchestrator): A7 산출 → episodes/<ep>/ + manifest→episode.json(v1)"
```

---

### Task 4: Agent 8·9 수술 (prompts / script + 안내 문구 경로)

**Files:**
- Modify: `orchestrator/agents/agent8_master_sheet.py:33-34` (`MASTER_DIR`), `:362,408` (md 안내 문구), md 저장부(`grep -n "MASTER_DIR" agents/agent8_master_sheet.py`로 사용처 확인)
- Modify: `orchestrator/agents/agent9_script_writer.py:33-34` (`SCRIPTS_DIR`), `:183` (edit_note 문구), md 저장부(`:614-623` 부근)

**Interfaces:**
- Consumes: `episode_dir` (Task 1); 두 에이전트 모두 `episode_id` 변수를 이미 보유(lib_episode 가드 반환값)
- Produces: `episodes/<ep>/prompts/master_sheets_prompts.md` · `episodes/<ep>/script/script_v2_*.draft.md`

- [ ] **Step 1: agent8 수술**

`:34` `MASTER_DIR = OUTPUT_DIR / "master_sheets"` 삭제. ⚠️ `MD_OUT`(:40)·mkdir(:35)는 **모듈 레벨 상수**인데 `episode_id`는 `main()`(:431)에만 존재 — md 경로 계산을 main() 안으로 이동해 `episode_dir(episode_id, "prompts") / "master_sheets_prompts.md"`로. 안내 문구 2곳(`:362,408`)의 `output/assets/<ep>/renders/` 문자열을 `output/episodes/<ep>/renders/`로:
```python
lines.append(f"3. 받은 이미지는 `output/episodes/{meta.get('episode_id', '<episode_id>')}/renders/<카테고리>__<row>.png` 로 저장 (에피소드 자산 — OSMU 재사용)")
```
(`:408`도 동일 치환.)

- [ ] **Step 2: agent9 수술**

`:34` `SCRIPTS_DIR = OUTPUT_DIR / "scripts"` 삭제 → draft 저장부를 `episode_dir(episode_id, "script") / f"script_v2_{mode_tag}_{date.today()}.draft.md"` 패턴으로 (기존 파일명 조립식 유지 — `grep -n "SCRIPTS_DIR" agents/agent9_script_writer.py`로 사용처 확인해 dir만 교체). `:183` edit_note의 `output/assets/<episode_id>/renders/`를 `output/episodes/<episode_id>/renders/`로.

- [ ] **Step 3: 실행 검증 (8·9는 재실행 안전)**

Run: `python -m agents.agent8_master_sheet && python -m agents.agent9_script_writer`
Expected: 정상 종료 + 출력 로그의 MD 경로가 `output\episodes\ep20260628_ippool-g009\prompts\…`·`…\script\…` — 확인:
`ls output/episodes/ep20260628_ippool-g009/prompts/ output/episodes/ep20260628_ippool-g009/script/`

- [ ] **Step 4: Commit**

```bash
git add agents/agent8_master_sheet.py agents/agent9_script_writer.py output/episodes/
git commit -m "refactor(orchestrator): A8·9 산출 경로 → episodes/<ep>/{prompts,script}"
```

---

### Task 5: Agent 10·11 수술 (publish)

**Files:**
- Modify: `orchestrator/agents/agent10_title_generator.py:40,261-262`
- Modify: `orchestrator/agents/agent11_thumbnail_designer.py:42,351-352`

**Interfaces:**
- Consumes: `episode_dir` (Task 1); `episode_id` = `require_same_episode` 반환값(양쪽 다 2026-07-05 커밋 6911820으로 이미 존재)
- Produces: `episodes/<ep>/publish/titles_*.md` · `episodes/<ep>/publish/thumbnail_prompts_*.md`

- [ ] **Step 1: 수술**

agent10 `:40` `TITLES_MD_DIR` 상수 삭제, `:261-262`를:
```python
md_dir = episode_dir(episode_id, "publish")
md_path = md_dir / f"titles_{date.today():%Y%m%d}.md"
```
agent11 `:42` `THUMB_MD_DIR` 삭제, `:351-352`를:
```python
md_dir = episode_dir(episode_id, "publish")
md_path = md_dir / f"thumbnail_prompts_{date.today():%Y%m%d}.md"
```
(양쪽 상단에 `from agents.lib_output import episode_dir` — 기존 lib_output import 줄 확장.)

- [ ] **Step 2: 실행 검증**

Run: `python -m agents.agent10_title_generator && python -m agents.agent11_thumbnail_designer`
Expected: 정상 종료. `ls output/episodes/ep20260628_ippool-g009/publish/` → `titles_*.md`·`thumbnail_prompts_*.md`

- [ ] **Step 3: Commit**

```bash
git add agents/agent10_title_generator.py agents/agent11_thumbnail_designer.py output/episodes/
git commit -m "refactor(orchestrator): A10·11 산출 경로 → episodes/<ep>/publish"
```

---

### Task 6: Validator·Agent 13·osmu_shorts_adapter 수술 (validation / manuscript / INDEX / shorts)

**Files:**
- Modify: `orchestrator/agents/validator.py:41,502,597-598` (+ episode_id 파생 추가)
- Modify: `orchestrator/agents/agent13_reporter.py:29,43-58(섹션 링크),137-138,175` (+ episode_id 파생 + `build_index()` 파라미터 추가)
- Modify: `orchestrator/agents/osmu_shorts_adapter.py:24,28,31` (검증에서 발견된 누락 지점 — 옛 scripts 읽기·옛 shorts 쓰기)

**Interfaces:**
- Consumes: `episode_dir` (Task 1) + `lib_episode.get_episode_id`
- Produces: `episodes/<ep>/validation/validator_*.md` · `episodes/<ep>/manuscript/원고초안_*.md` · `episodes/<ep>/publish/shorts_*.md` · `output/INDEX.md`(위치 불변, 링크만 갱신)
- ⚠️ **스코프 주의(사전 검증 판명)**: validator·agent13 코드엔 `episode_id` 변수가 **없다**. validator의 `_ep_id`(:526)는 :502 사용처보다 뒤에 계산되고 가드 실패 시 None. 아래 Step들이 room에서 직접 파생한다.

- [ ] **Step 1: validator 수술 — episode_id를 room에서 조기 파생**

room 로드(:353 부근) 직후에 추가:
```python
from agents.lib_episode import get_episode_id   # 상단 기존 lib_episode import 줄 확장
episode_id = get_episode_id(room)               # room = confirmed_room.json 로드본
if not episode_id:
    print("[FAIL] confirmed_room에 episode_id 도장 없음 — Agent 7 재실행 필요")
    sys.exit(1)
```
`:41` `VALID_MD_DIR` 삭제, `:597-598`을 `episode_dir(episode_id, "validation")` 사용으로 교체. `:502` shorts glob을:
```python
shorts_hits = sorted(_glob.glob(str(episode_dir(episode_id, "publish") / "shorts_*.md")))
```
(:526 `_ep_id` 계산 로직은 그대로 두되, 파생한 `episode_id`와 중복이면 하나로 정리해도 됨 — 동작 동일 조건에서만.)

- [ ] **Step 2: agent13 수술 — episode_id 파생 + build_index 시그니처**

room 로드(:80 부근) 직후 동일 패턴으로 `episode_id = get_episode_id(room)` 파생(없으면 exit 1). `:29` `MANUSCRIPT_DIR` → `episode_dir(episode_id, "manuscript")` 사용처 교체. `:137-138` 콘티 glob을 `episodes/<ep>/script/*.final.md`·`*.draft.md`로, `:175` shorts glob을 `episodes/<ep>/publish/shorts_*.md`로. `:43-58` INDEX 섹션 테이블은 **`build_index()`에 `episode_id: str` 파라미터를 추가**(현 시그니처에 없음 — 호출부도 함께 수정)해 주간 항목만 `episodes/{episode_id}/<group>/<pattern>`으로 (일일 항목 불변). INDEX.md 자체는 `output/INDEX.md` 유지.

- [ ] **Step 2b: osmu_shorts_adapter 수술**

`:24,28,31`의 옛 경로(`output/scripts` 읽기 · `output/shorts` 쓰기)를 교체 — 콘티 읽기 = `episode_dir(episode_id, "script")` glob, shorts md 쓰기 = `episode_dir(episode_id, "publish") / f"shorts_{date.today():%Y%m%d}.md"`. episode_id는 이 파일이 로드하는 입력 JSON(콘티 meta 또는 confirmed_room — 파일 상단 입력부를 열어 확인)에서 `get_episode_id`로 파생. `data/osmu_shorts.json` 경로는 불변.

- [ ] **Step 3: 실행 검증**

Run: `python -m agents.validator && python -m agents.agent13_reporter`
Expected: 정상 종료(validator 종합 `PASS_WITH_DEFERRED` 유지). 확인:
`ls output/episodes/ep20260628_ippool-g009/validation/ output/episodes/ep20260628_ippool-g009/manuscript/` + `head -30 output/INDEX.md`에 `episodes/ep20260628…` 링크.

- [ ] **Step 4: Commit**

```bash
git add agents/validator.py agents/agent13_reporter.py output/episodes/ output/INDEX.md
git commit -m "refactor(orchestrator): validator·A13 산출 경로 → episodes/<ep> + INDEX 링크"
```

---

### Task 7: .gitignore 갱신 (이미지 규칙 → 새 경로)

**Files:**
- Modify: `.gitignore:35-41` (레포 루트)

**Interfaces:**
- Produces: 새 경로 이미지 무시 규칙 — 이후 Task 8 마이그레이션이 이미지를 옮겨도 git이 추적 안 함

- [ ] **Step 1: 규칙 교체**

`.gitignore:35-41`의 옛 규칙(`orchestrator/output/master_sheets/images/*`·`orchestrator/output/assets/*/…` 5줄)을 다음으로 교체:

```gitignore
orchestrator/output/episodes/*/products/*
!orchestrator/output/episodes/*/products/*.md
orchestrator/output/episodes/*/renders/*
orchestrator/output/episodes/*/publish/thumbnails/*
orchestrator/output/_archive/**/images/*
```

(products/는 md와 이미지가 공존 — md만 추적 예외. `_archive`의 md·json은 추적 유지 = 스펙 "삭제 금지" 이행.)

- [ ] **Step 2: 검증**

Run: `git check-ignore -v orchestrator/output/episodes/epX/renders/a.png orchestrator/output/episodes/epX/products/b.jpg; git check-ignore orchestrator/output/episodes/epX/products/confirmed_room_1.md || echo "[OK] md는 추적"`
Expected: png·jpg 두 건은 규칙 매칭 출력, md는 `[OK] md는 추적`

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(repo): gitignore 이미지 규칙 → output/episodes 새 경로"
```

---

### Task 8: 레거시 마이그레이션 스크립트 (dry-run → apply)

**Files:**
- Create: `orchestrator/agents/migrate_episode_layout.py`

**Interfaces:**
- Consumes: `lib_output.episode_root/episode_dir/EPISODE_GROUPS` · `data/agent6_script_meta.json`(title용)
- Produces: 1회성 CLI — `python -m agents.migrate_episode_layout` (dry-run 기본, `--apply`로 실행). 이동 규칙: 주간 종류폴더 파일 중 날짜 토큰 ≥ `20260628` → `episodes/ep20260628_ippool-g009/<group>/`, 미만 → `output/_archive/<종류>/`, 무날짜 파일(`master_sheets_prompts.md`·`room_render_prompts.md`) → 현행 EP. `assets/<ep>/` → 각 그룹으로 흡수 + `manifest.json` → `episode.json` 변환 후 assets 폴더 제거.

- [ ] **Step 1: 스크립트 작성**

```python
"""migrate_episode_layout.py — output/ 종류별 → episodes/<ep>/ 1회성 재배치.

기본 dry-run(이동 계획만 출력), --apply 시 실행. 스펙 §3-2 레거시 이사 규칙.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agents.lib_output import ROOT, episode_dir, episode_root  # noqa: E402

OUTPUT = ROOT / "output"
ARCHIVE = OUTPUT / "_archive"
EP = "ep20260628_ippool-g009"          # 현행 EP (파이프라인 유일 진행분)
CUTOFF = "20260628"                     # 이 날짜 미만 = 도장 이전 레거시
TYPE_TO_GROUP = {
    "topic_picks": "planning",
    "product_curation": "products",
    "confirmed_room": "products",
    "master_sheets": "prompts",
    "scripts": "script",
    "titles": "publish",
    "thumbnails": "publish",
    "shorts": "publish",
    "validation": "validation",
    "manuscript": "manuscript",
}
DATE_RE = re.compile(r"(20\d{2})-?(\d{2})-?(\d{2})")


def date_token(name: str) -> str | None:
    m = DATE_RE.search(name)
    return "".join(m.groups()) if m else None


def plan_moves() -> list[tuple[Path, Path]]:
    moves: list[tuple[Path, Path]] = []
    for type_name, group in TYPE_TO_GROUP.items():
        src_dir = OUTPUT / type_name
        if not src_dir.is_dir():
            continue
        for f in sorted(src_dir.rglob("*")):
            if not f.is_file():
                continue
            rel_sub = f.relative_to(src_dir)
            tok = date_token(f.name)
            legacy = ("_deprecated" in rel_sub.parts) or (rel_sub.parts[0] == "images") \
                     or (tok is not None and tok < CUTOFF)
            if legacy:
                dest = ARCHIVE / type_name / rel_sub
            else:  # 현행 EP (무날짜 = 현행 프롬프트 파일 포함)
                dest = episode_root(EP) / group / f.name
            moves.append((f, dest))
    # assets/<EP>/ 흡수: products·renders → 동명 그룹, thumbnails → publish/thumbnails
    assets = OUTPUT / "assets" / EP
    if assets.is_dir():
        sub_to_dest = {"products": episode_root(EP) / "products",
                       "renders": episode_root(EP) / "renders",
                       "thumbnails": episode_root(EP) / "publish" / "thumbnails"}
        for sub, dest_dir in sub_to_dest.items():
            d = assets / sub
            if d.is_dir():
                for f in sorted(d.iterdir()):
                    if f.is_file():
                        moves.append((f, dest_dir / f.name))
    return moves


def build_episode_json() -> dict:
    manifest_p = OUTPUT / "assets" / EP / "manifest.json"
    manifest = json.loads(manifest_p.read_text(encoding="utf-8")) if manifest_p.exists() else {}
    meta_p = ROOT / "data" / "agent6_script_meta.json"
    subject = ""
    if meta_p.exists():
        sm = json.loads(meta_p.read_text(encoding="utf-8"))
        if sm.get("episode_id") == EP:
            subject = sm.get("subject", "")
    return {
        "schema_version": 1,
        "title": subject or EP,
        "stage": "렌더",
        "approvals": {"moodboard": {"approved": True, "by": "부부",
                                     "at": "2026-07-05", "note": "Owner 구두 승인"}},
        **manifest,
    }


def main() -> None:
    apply = "--apply" in sys.argv
    moves = plan_moves()
    for src, dest in moves:
        print(f"{'MOVE' if apply else 'PLAN'}  {src.relative_to(OUTPUT)}  ->  {dest.relative_to(OUTPUT)}")
        if apply:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dest))
    doc = build_episode_json()
    ep_json = episode_root(EP) / "episode.json"
    print(f"{'WRITE' if apply else 'PLAN '}  episode.json (title={doc['title'][:30]}…, stage={doc['stage']})")
    if apply:
        episode_root(EP).mkdir(parents=True, exist_ok=True)
        ep_json.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        # 빈 껍데기 정리: assets/<EP>(manifest 포함)와 비워진 종류 폴더 제거
        assets_ep = OUTPUT / "assets" / EP
        if assets_ep.is_dir():
            shutil.rmtree(assets_ep)
        for type_name in TYPE_TO_GROUP:
            d = OUTPUT / type_name
            if d.is_dir() and not any(d.rglob("*")):
                d.rmdir()
        if (OUTPUT / "assets").is_dir() and not any((OUTPUT / "assets").iterdir()):
            (OUTPUT / "assets").rmdir()
        # ⚠️ rglob("*")는 빈 하위폴더(_deprecated/·images/)에도 걸림 — 파일 기준으로 재검사
        for type_name in TYPE_TO_GROUP:
            d = OUTPUT / type_name
            if d.is_dir() and not any(p for p in d.rglob("*") if p.is_file()):
                shutil.rmtree(d)
    print(f"\n총 {len(moves)}건 {'이동 완료' if apply else '(dry-run — --apply로 실행)'}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: dry-run 실행·계획 눈검증**

Run: `python -m agents.migrate_episode_layout`
Expected: 전 건 `PLAN` 출력 — ① 20260611 파일들이 `_archive/<종류>/`로 ② 20260628+ 파일·무날짜 프롬프트가 `episodes/ep20260628…/<그룹>/`으로 ③ assets 3종이 그룹으로 가는지 확인. 이상 있으면 규칙 수정 후 재실행.

- [ ] **Step 3: apply + 결과 검증**

Run: `python -m agents.migrate_episode_layout --apply`
그다음: `ls output/ && ls output/episodes/ep20260628_ippool-g009/ && python -c "import json; d=json.load(open('output/episodes/ep20260628_ippool-g009/episode.json',encoding='utf-8')); print(d['schema_version'], d['stage'], d['approvals']['moodboard']['approved'], len(d.get('products',[])))"`
Expected: `output/`에 주간 종류 폴더·assets 소멸(일일 4종 + episodes + _archive + **studio/** + BOARD·INDEX만 잔존 — studio는 재배치 대상 아님) · episode.json → `1 렌더 True 10` (products 실측 10개)

- [ ] **Step 4: Commit**

```bash
git add -A output/ agents/migrate_episode_layout.py
git commit -m "refactor(orchestrator): 산출물 에피소드별 재배치 — 레거시 이사 + episode.json(v1)"
```

---

### Task 9: 지침·문서 경로 동기화

**Files:**
- Modify: `.claude/agents/agent-prompt-engineer.md:27-30` (산출 경로 — `output/master_sheets/room_render_prompts.md` → `output/episodes/<ep>/prompts/room_render_prompts.md`; `data/room_render_prompts.json`은 불변)
- Modify: `.claude/skills/team-prompt/SKILL.md` · `.claude/skills/osmu-shorts-adapter/SKILL.md:19` · `.claude/agents/osmu-shorts-adapter.md` · `.claude/skills/agent-{8,9,10,11,13}-*/SKILL.md` · `.claude/skills/agent-5d-interior-designer/SKILL.md`(경로 언급 시)
- Modify: `orchestrator/CLAUDE.md` — `project_root 레이아웃` 트리의 output 하위 절 + Agent 8·Phase 8B·Agent 9~13 산출 경로 문구 + **변경 이력 표에 신규 행 1개 추가**(소급 수정 금지)
- Modify: `orchestrator/BUILD_SOP.md` — Phase 5~13 "산출" 필드 경로

**Interfaces:**
- Consumes: Task 1~8에서 확정된 새 경로 체계
- Produces: 산문·지침·코드 경로 일치 (스펙 §3-2 문서 동기화 — 서브에이전트가 옛 경로에 쓰는 사고 방지)

- [ ] **Step 1: 전 참조 지점 수집**

Run: `grep -rn "output/assets\|output/topic_picks\|output/product_curation\|output/confirmed_room\|output/master_sheets\|output/scripts\|output/titles\|output/thumbnails\|output/validation\|output/manuscript\|output/shorts" ../.claude/ CLAUDE.md BUILD_SOP.md --include="*.md" | grep -v docs/superpowers`
Expected: 수정 대상 전체 목록 (스펙·플랜 문서 제외 — 사전 검증 실측 **약 24개 파일**, Files 목록은 대표만·grep 결과가 정본).

- [ ] **Step 2: 경로 치환 (매핑 테이블)**

| 옛 경로 | 새 경로 |
|---|---|
| `output/assets/<ep>/products,renders` | `output/episodes/<ep>/products,renders` |
| `output/assets/<ep>/thumbnails` | `output/episodes/<ep>/publish/thumbnails` |
| `output/topic_picks/…` | `output/episodes/<ep>/planning/…` |
| `output/product_curation/…`·`output/confirmed_room/…` | `output/episodes/<ep>/products/…` |
| `output/master_sheets/…` | `output/episodes/<ep>/prompts/…` |
| `output/scripts/…` | `output/episodes/<ep>/script/…` |
| `output/titles/…`·`output/thumbnails/…`·`output/shorts/…` | `output/episodes/<ep>/publish/…` |
| `output/validation/…` | `output/episodes/<ep>/validation/…` |
| `output/manuscript/…` | `output/episodes/<ep>/manuscript/…` |

Step 1 목록의 각 파일에서 위 표대로 치환. `orchestrator/CLAUDE.md` 변경 이력 표에는 행 추가:
`| 2026-07-05 | 산출물 에피소드별 재배치 — output/episodes/<ep>/ 8그룹 + episode.json | lib_output.episode_dir · A5~13·validator 경로 · migrate_episode_layout | Episode Hub 스펙 §3 (docs/superpowers/specs/2026-07-05-episode-hub-design.md) | — |`

- [ ] **Step 3: 검증 — 옛 경로 잔존 0**

Run: Step 1의 grep 재실행
Expected: 매치 0건 (또는 의도적 역사 기록 — 변경 이력 표·Decision Log 인용 — 만 잔존, 각각 눈으로 확인)

- [ ] **Step 4: Commit**

```bash
git add ../.claude CLAUDE.md BUILD_SOP.md
git commit -m "docs(multi): 산출 경로 문서 동기화 — episodes/<ep> 체계 (스펙 §3-2)"
```

---

### Task 10: 전 파이프라인 스모크 (최종 검증)

**Files:** 없음 (실행 검증만)

**Interfaces:**
- Consumes: Task 1~9 전부

- [ ] **Step 1: 8→13 전체 재실행**

Run: `python -m agents.agent8_master_sheet && python -m agents.agent9_script_writer && python -m agents.agent10_title_generator && python -m agents.agent11_thumbnail_designer && python -m agents.validator && python -m agents.agent13_reporter`
Expected: 전부 exit 0, validator `PASS_WITH_DEFERRED` 유지(에피소드 가드 경고 0).

- [ ] **Step 2: 산출 위치 전수 확인**

Run: `find output/episodes/ep20260628_ippool-g009 -name "*.md" | sort && echo "---옛 폴더 재생성 여부---" && ls output/ | grep -E "titles|scripts|master_sheets|confirmed_room|topic_picks|product_curation|thumbnails|validation|manuscript|shorts|assets" || echo "[OK] 옛 종류 폴더 재생성 없음"`
Expected: 8그룹 하위에 md 전부 + `[OK] 옛 종류 폴더 재생성 없음`

- [ ] **Step 3: git 상태 확인 후 커밋**

Run: `git status --short` — 재실행으로 갱신된 episodes/ 산출물만 나타나는지 확인.
```bash
git add output/ && git commit -m "chore(orchestrator): 재배치 후 전 파이프라인 스모크 — 산출물 재생성"
```

---

---

### Task 11: 재배치 후 대청소 — repo-cruft-audit (Owner 지시 2026-07-06)

**Files:** 없음 (감사 리포트 산출 → 승인 후 삭제 커밋)

- [ ] **Step 1:** Task 1~10 완료 후 `repo-cruft-audit` 스킬 실행 — 데드 코드·데드 문서·미사용 에이전트·stale 데이터·옛 경로 잔존 참조를 4방향 감사(L0 자산/orchestrator 런타임/미문서화 디렉토리/구조)로 전수 발굴, 적대적 검증 후 등급별 리포트.
- [ ] **Step 2:** 리포트를 Owner에게 보고 — **삭제는 Owner 승인 항목만** 실행 후 커밋.

이미 알려진 후보(감사가 재검증): `agents/compile_weekly_excel.py`(Excel 리포트 2026-06-06 폐기) · stale `studio/board.json` fixture · review-studio 문서 참조(브랜치 행방불명) · **`agents/studio_generator.py:42`(옛 scripts 경로 읽기 — 재배치 후 파손, 사전 검증 발견)** · `output/studio/` HTML 2건 · 재배치로 생긴 옛 경로 참조 잔존물.

---

## 남기는 것 (이 플랜 범위 아님 — 스펙 §6)

- Episode Hub 앱(프로젝트 ②) — 별도 플랜.
- `studio/board.json` 연동 — episode.json 파생 렌더 후속.
- 이미지 공유(클라우드·LFS) — 백로그.
