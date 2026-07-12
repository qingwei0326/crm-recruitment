# Gemini Admin Shell Code Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify an eight-file Gemini input pack that asks Gemini to redesign and return production-ready code for the existing admin shell without changing routes, permissions, APIs, or data behavior.

**Architecture:** A reusable PowerShell pack builder reads an explicit JSON manifest, validates every source and destination, rejects sensitive or excessive inputs, and creates a ZIP outside version control. The first manifest combines three contract documents, one redacted screenshot, and four existing frontend files. Gemini may return at most three complete component files; local integration and regression testing happen only after that response is reviewed.

**Tech Stack:** PowerShell 7, .NET `System.IO.Compression`, React 18, Tailwind CSS 3, Lucide React, Vitest, Browser Harness.

## Global Constraints

- Gemini ZIP input must contain no more than 8 files even though the platform limit is 10.
- Gemini may create or modify no more than 3 code files in one response.
- Files with at most 400 lines may be returned in full; larger files require new presentational components plus a minimal unified diff.
- Do not include `node_modules`, lock files, databases, environment files, secrets, logs, real phone numbers, or real student data.
- Do not change routes, permissions, API paths, request/response shapes, state machines, or existing component props.
- Do not accept injection scripts, bulk overwriters, deletion scripts, hardcoded business data, or new dependencies.
- Keep the user's existing deleted documents and untracked ZIP files out of every commit.
- Generated screenshots and ZIP files remain untracked under `artifacts/gemini-ui/`.

---

## File Map

- Create `scripts/build_gemini_ui_pack.ps1`: generic manifest-driven ZIP builder and safety validator.
- Create `scripts/test_build_gemini_ui_pack.ps1`: isolated executable regression checks for the builder.
- Create `docs/gemini-ui/admin-shell/00-task-contract.md`: Gemini output scope and format.
- Create `docs/gemini-ui/admin-shell/01-shared-visual-spec.md`: approved visual language for operational CRM screens.
- Create `docs/gemini-ui/admin-shell/read-only-contract.md`: component props, navigation, permission, theme, and mobile behavior that cannot change.
- Create `docs/gemini-ui/admin-shell/manifest.json`: exact eight-entry pack manifest.
- Generate `artifacts/gemini-ui/admin-shell/02-current-admin-shell.png`: redacted 1440x900 current-state screenshot.
- Generate `artifacts/gemini-ui/frontend-admin-shell-gemini-v1.zip`: final Gemini upload artifact.
- Read only `frontend/src/components/AdminLayout.jsx`, `frontend/src/components/AdminSidebar.jsx`, `frontend/src/components/PageHeader.jsx`, and `frontend/src/index.css`.

---

### Task 1: Safe Manifest-Driven Pack Builder

**Files:**
- Create: `scripts/build_gemini_ui_pack.ps1`
- Create: `scripts/test_build_gemini_ui_pack.ps1`

**Interfaces:**
- Consumes: `-ManifestPath <workspace-relative-json>` and optional `-Force`.
- Manifest shape: `{ "name": string, "output": string, "entries": [{ "source": string, "name": string }] }`.
- Produces: one ZIP and compact JSON with `output`, `entries`, and `size_kb`.

- [ ] **Step 1: Add the failing builder regression script**

Create `scripts/test_build_gemini_ui_pack.ps1` with these executable cases:

```powershell
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$builder = Join-Path $PSScriptRoot 'build_gemini_ui_pack.ps1'
$sandbox = Join-Path $root ('.gemini-pack-test-' + [guid]::NewGuid().ToString('N'))

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Write-Manifest([string]$Path, [string]$Output, [object[]]$Entries) {
    @{ name = 'test-pack'; output = $Output; entries = $Entries } |
        ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $Path -Encoding utf8
}

try {
    New-Item -ItemType Directory -Path $sandbox | Out-Null
    'alpha' | Set-Content -LiteralPath (Join-Path $sandbox 'alpha.md') -Encoding utf8
    'beta' | Set-Content -LiteralPath (Join-Path $sandbox 'beta.jsx') -Encoding utf8

    $safeManifest = Join-Path $sandbox 'safe.json'
    $safeOutput = '.gemini-pack-test-output-' + [guid]::NewGuid().ToString('N') + '.zip'
    Write-Manifest $safeManifest $safeOutput @(
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'alpha.md')); name = '00-alpha.md' },
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'beta.jsx')); name = '01-beta.jsx' }
    )
    & $builder -ManifestPath ([IO.Path]::GetRelativePath($root, $safeManifest)) | Out-Null
    $safeZip = Join-Path $root $safeOutput
    Assert-True (Test-Path -LiteralPath $safeZip) 'safe pack was not created'

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($safeZip)
    try { Assert-True ($archive.Entries.Count -eq 2) 'safe pack entry count mismatch' }
    finally { $archive.Dispose() }

    $tooManyManifest = Join-Path $sandbox 'too-many.json'
    $nine = 1..9 | ForEach-Object {
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox 'alpha.md')); name = ('item-{0}.md' -f $_) }
    }
    Write-Manifest $tooManyManifest 'too-many.zip' $nine
    $tooManyRejected = $false
    try { & $builder -ManifestPath ([IO.Path]::GetRelativePath($root, $tooManyManifest)) | Out-Null }
    catch { $tooManyRejected = $_.Exception.Message -match '1..8' }
    Assert-True $tooManyRejected 'nine-entry manifest was not rejected'

    'secret' | Set-Content -LiteralPath (Join-Path $sandbox '.env') -Encoding utf8
    $secretManifest = Join-Path $sandbox 'secret.json'
    Write-Manifest $secretManifest 'secret.zip' @(
        @{ source = [IO.Path]::GetRelativePath($root, (Join-Path $sandbox '.env')); name = '.env' }
    )
    $secretRejected = $false
    try { & $builder -ManifestPath ([IO.Path]::GetRelativePath($root, $secretManifest)) | Out-Null }
    catch { $secretRejected = $_.Exception.Message -match 'forbidden' }
    Assert-True $secretRejected 'sensitive file was not rejected'

    'PASS: Gemini pack builder safety checks'
} finally {
    Get-ChildItem -LiteralPath $root -Filter '.gemini-pack-test-output-*.zip' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
    if (Test-Path -LiteralPath $sandbox) { Remove-Item -LiteralPath $sandbox -Recurse -Force }
}
```

- [ ] **Step 2: Run the regression script and confirm it fails**

Run:

```powershell
pwsh -NoProfile -File scripts/test_build_gemini_ui_pack.ps1
```

Expected: FAIL because `scripts/build_gemini_ui_pack.ps1` does not exist.

- [ ] **Step 3: Implement the pack builder**

Create `scripts/build_gemini_ui_pack.ps1` with these rules:

```powershell
param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Resolve-WorkspacePath([string]$RelativePath) {
    $full = [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "path escapes workspace: $RelativePath"
    }
    return $full
}

$manifestFull = Resolve-WorkspacePath $ManifestPath
$manifest = Get-Content -LiteralPath $manifestFull -Raw | ConvertFrom-Json
$entries = @($manifest.entries)
if ($entries.Count -lt 1 -or $entries.Count -gt 8) {
    throw "manifest entries must contain 1..8 files"
}

$outputFull = Resolve-WorkspacePath ([string]$manifest.output)
if ([IO.Path]::GetExtension($outputFull) -ne '.zip') { throw 'output must be a .zip file' }
if ((Test-Path -LiteralPath $outputFull) -and -not $Force) { throw "output already exists: $outputFull" }

$forbiddenNames = @('.env', '.env.linux', '.secret_key', 'package-lock.json', 'crm.db')
$forbiddenExtensions = @('.db', '.sqlite', '.sqlite3', '.pem', '.key', '.log', '.pid')
$seenNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$validated = foreach ($entry in $entries) {
    $source = Resolve-WorkspacePath ([string]$entry.source)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "source is missing: $source" }
    $name = [string]$entry.name
    if ([string]::IsNullOrWhiteSpace($name) -or $name -ne [IO.Path]::GetFileName($name)) {
        throw "entry name must be a flat filename: $name"
    }
    if (-not $seenNames.Add($name)) { throw "duplicate entry name: $name" }
    if ($forbiddenNames -contains [IO.Path]::GetFileName($source) -or
        $forbiddenExtensions -contains [IO.Path]::GetExtension($source).ToLowerInvariant() -or
        $source -match '[\\/]node_modules[\\/]') {
        throw "forbidden source: $source"
    }
    [pscustomobject]@{ Source = $source; Name = $name }
}

$outputDir = Split-Path -Parent $outputFull
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
if ($Force -and (Test-Path -LiteralPath $outputFull)) { Remove-Item -LiteralPath $outputFull -Force }
$staging = Join-Path $root ('.gemini-pack-stage-' + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    foreach ($entry in $validated) {
        Copy-Item -LiteralPath $entry.Source -Destination (Join-Path $staging $entry.Name)
    }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $outputFull -CompressionLevel Optimal
    $archive = [IO.Compression.ZipFile]::OpenRead($outputFull)
    try {
        if ($archive.Entries.Count -ne $validated.Count) { throw 'ZIP entry count mismatch' }
    } finally { $archive.Dispose() }
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}

[pscustomobject]@{
    output = $outputFull
    entries = $validated.Count
    size_kb = [math]::Round((Get-Item -LiteralPath $outputFull).Length / 1KB, 1)
} | ConvertTo-Json -Compress
```

- [ ] **Step 4: Run the builder regression script**

Run:

```powershell
pwsh -NoProfile -File scripts/test_build_gemini_ui_pack.ps1
```

Expected: `PASS: Gemini pack builder safety checks` and exit code 0.

- [ ] **Step 5: Commit the reusable builder**

```powershell
git add -- scripts/build_gemini_ui_pack.ps1 scripts/test_build_gemini_ui_pack.ps1
git commit -m "build: add safe Gemini UI pack builder"
```

---

### Task 2: Admin Shell Contracts and Manifest

**Files:**
- Create: `docs/gemini-ui/admin-shell/00-task-contract.md`
- Create: `docs/gemini-ui/admin-shell/01-shared-visual-spec.md`
- Create: `docs/gemini-ui/admin-shell/read-only-contract.md`
- Create: `docs/gemini-ui/admin-shell/manifest.json`

**Interfaces:**
- Consumes: existing component signatures and the manifest schema from Task 1.
- Produces: exact instructions for three complete Gemini outputs: `AdminLayout.jsx`, `AdminSidebar.jsx`, and `PageHeader.jsx`.

- [ ] **Step 1: Write the task contract**

Create `00-task-contract.md` with these binding requirements:

```markdown
# Admin shell redesign task

You are redesigning the visual shell of an operational admissions CRM. Return production React code, not a mockup.

## Allowed outputs

Return exactly these three complete files and no others:

1. `frontend/src/components/AdminLayout.jsx`
2. `frontend/src/components/AdminSidebar.jsx`
3. `frontend/src/components/PageHeader.jsx`

Each file is under 400 lines, so return the complete file in a separate fenced code block headed by its exact repository path.

## Required behavior

- Preserve every exported name, prop, route, label, permission check, theme action, logout action, mobile overlay action, and child render point described in `read-only-contract.md`.
- Use only existing React, React Router, Tailwind, and Lucide dependencies.
- Keep the interface quiet, compact, and optimized for repeated CRM work.
- Support desktop, mobile navigation, light mode, and dark mode.
- Include visible focus, hover, active, disabled, and selected states where applicable.
- Keep cards at 8px radius or less and avoid decorative gradients, orbs, marketing layouts, and nested cards.

## Forbidden

- No hardcoded users, metrics, students, routes, or API responses.
- No new routes, dependencies, event buses, state managers, data fetching, or global configuration.
- No changes to `App.jsx`, API modules, hooks, permissions, Tailwind config, or `index.css`.
- No Node, Python, or PowerShell scripts. No bulk overwrite or deletion commands.

Begin with a rationale of at most 200 Chinese characters, then output exactly three complete code files.
```

- [ ] **Step 2: Write the shared visual specification**

Create `01-shared-visual-spec.md` with exact design rules:

```markdown
# Shared visual specification

- Product character: quiet, utilitarian, trustworthy, and work-focused.
- Density: compact enough for repeated scanning; no oversized hero typography or decorative section cards.
- Palette: neutral gray surfaces, blue primary actions, green success, amber warning, red danger; do not let one hue dominate the whole interface.
- Typography: normal letter spacing, compact headings, tabular numbers where metrics are shown.
- Shape: 4px to 8px radius for operational controls and panels.
- Navigation: stable 240px desktop sidebar; clear active marker; labels and icons remain visible; long navigation scrolls without moving account actions.
- Header: 56px desktop baseline; mobile safe-area support; actions remain reachable without overlapping the title.
- Mobile: minimum 40px controls, coherent overlay, no horizontal page overflow.
- Dark mode: preserve readable contrast and avoid pure-black large surfaces.
- Motion: short functional transitions only; honor reduced-motion behavior through CSS classes already available in the project.
```

- [ ] **Step 3: Write the read-only component contract**

Create `read-only-contract.md` containing these exact interfaces:

```markdown
# Read-only admin shell contract

## Component signatures

- `AdminLayout({ isMobile, sidebarOpen, onClose, children })`
- `AdminSidebar({ onClose })`
- `PageHeader({ title, isMobile, onMenuClick, children, actionsClassName = 'flex items-center gap-1', useSafeArea = true })`

## Required AdminLayout behavior

- Always renders `children` exactly once.
- Renders `AdminSidebar` inside a 240px desktop sidebar.
- On mobile, `sidebarOpen` controls the slide-in sidebar and backdrop.
- Clicking the mobile backdrop calls `onClose`.

## Required AdminSidebar behavior

- Keep `ADMIN_NAV_ITEMS` exported.
- Keep all existing labels, paths, order, icons, `permission`, `superOnly`, and `end` values unchanged.
- Filter items with `(!item.superOnly || user?.is_super_admin) && canAccessAdminPage(user, item.permission)`.
- Keep active-route matching for exact dashboard and nested paths.
- Keep `useAuth()` user/logout behavior, `useTheme()` dark/toggle behavior, and mobile close behavior.
- Keep accessible names `关闭导航`, `亮色模式` or `暗色模式`, and `退出登录`.

## Required PageHeader behavior

- Preserve the title, optional mobile menu button, right-side `children`, `actionsClassName`, and `useSafeArea` behavior.
- Keep mobile menu accessible name `打开导航`.
- Keep minimum 40px touch targets and mobile safe-area padding.

## Read-only project facts

- Tailwind uses `darkMode: 'class'` with no custom theme tokens.
- Routes and page permissions are enforced outside these components and must not move into them.
- The screenshot is a visual reference only; text and numbers in it are not source data.
```

- [ ] **Step 4: Add the exact eight-entry manifest**

Create `manifest.json`:

```json
{
  "name": "admin-shell-v1",
  "output": "artifacts/gemini-ui/frontend-admin-shell-gemini-v1.zip",
  "entries": [
    { "source": "docs/gemini-ui/admin-shell/00-task-contract.md", "name": "00-task-contract.md" },
    { "source": "docs/gemini-ui/admin-shell/01-shared-visual-spec.md", "name": "01-shared-visual-spec.md" },
    { "source": "artifacts/gemini-ui/admin-shell/02-current-admin-shell.png", "name": "02-current-admin-shell.png" },
    { "source": "frontend/src/components/AdminLayout.jsx", "name": "03-AdminLayout.jsx" },
    { "source": "frontend/src/components/AdminSidebar.jsx", "name": "04-AdminSidebar.jsx" },
    { "source": "frontend/src/components/PageHeader.jsx", "name": "05-PageHeader.jsx" },
    { "source": "frontend/src/index.css", "name": "06-index.css" },
    { "source": "docs/gemini-ui/admin-shell/read-only-contract.md", "name": "07-read-only-contract.md" }
  ]
}
```

- [ ] **Step 5: Validate contract and manifest invariants**

Run:

```powershell
$manifest = Get-Content docs/gemini-ui/admin-shell/manifest.json -Raw | ConvertFrom-Json
if (@($manifest.entries).Count -ne 8) { throw 'manifest must contain exactly 8 entries' }
$task = Get-Content docs/gemini-ui/admin-shell/00-task-contract.md -Raw
$contract = Get-Content docs/gemini-ui/admin-shell/read-only-contract.md -Raw
foreach ($required in @('exactly these three complete files','No hardcoded','No Node, Python, or PowerShell scripts')) {
  if (-not $task.Contains($required)) { throw "task contract missing: $required" }
}
foreach ($required in @('AdminLayout({ isMobile, sidebarOpen, onClose, children })','ADMIN_NAV_ITEMS','canAccessAdminPage','打开导航')) {
  if (-not $contract.Contains($required)) { throw "read-only contract missing: $required" }
}
'PASS: admin shell contracts and manifest'
```

Expected: `PASS: admin shell contracts and manifest`.

- [ ] **Step 6: Commit only the contract sources and manifest**

```powershell
git add -f -- docs/gemini-ui/admin-shell/00-task-contract.md docs/gemini-ui/admin-shell/01-shared-visual-spec.md docs/gemini-ui/admin-shell/read-only-contract.md docs/gemini-ui/admin-shell/manifest.json
git commit -m "docs: define Gemini admin shell code pack"
```

---

### Task 3: Capture and Redact the Current Admin Shell

**Files:**
- Generate: `artifacts/gemini-ui/admin-shell/02-current-admin-shell.png`

**Interfaces:**
- Consumes: authenticated local admin page at `http://127.0.0.1:5173/admin`.
- Produces: a 1440x900 PNG with no phone number, student name, credential, token, or real operator name.

- [ ] **Step 1: Open the current admin dashboard in Browser Harness**

Use the `browser-use` skill, create a new tab at `http://127.0.0.1:5173/admin`, wait for load, and capture a diagnostic screenshot before changing the DOM. Do not navigate or modify the user's existing tabs.

Expected: the current admin dashboard is visible. If a login page is visible, stop and request login rather than storing credentials in a script.

- [ ] **Step 2: Redact visible identity text in the temporary page DOM**

Run this page expression before the final screenshot:

```javascript
() => {
  const operator = document.querySelector('aside .text-xs.text-gray-500.truncate');
  if (operator) operator.textContent = '管理员';
  document.querySelectorAll('a[href^="tel:"], [data-sensitive="true"]').forEach((node) => {
    node.textContent = '已脱敏';
  });
  return { title: document.title, path: location.pathname };
}
```

Expected: result path is `/admin`; the change affects only the browser DOM, not repository files.

- [ ] **Step 3: Capture the 1440x900 PNG**

Set the page viewport to 1440x900 and use CDP `Page.captureScreenshot` to write the PNG to the exact artifact path. Create `artifacts/gemini-ui/admin-shell/` first if absent.

- [ ] **Step 4: Inspect the image and verify dimensions**

Open the PNG with the image viewer and check that navigation, header, content density, light/dark contrast, and mobile affordances are visible enough for Gemini to assess. Then run:

```powershell
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile((Resolve-Path 'artifacts/gemini-ui/admin-shell/02-current-admin-shell.png'))
try {
  if ($image.Width -ne 1440 -or $image.Height -ne 900) { throw "unexpected dimensions: $($image.Width)x$($image.Height)" }
} finally { $image.Dispose() }
'PASS: redacted admin shell screenshot is 1440x900'
```

Expected: `PASS: redacted admin shell screenshot is 1440x900`.

---

### Task 4: Build and Audit the Eight-File Gemini Pack

**Files:**
- Read: `docs/gemini-ui/admin-shell/manifest.json`
- Generate: `artifacts/gemini-ui/frontend-admin-shell-gemini-v1.zip`

**Interfaces:**
- Consumes: Task 1 builder, Task 2 contracts, Task 3 screenshot, and four current frontend files.
- Produces: one upload-ready ZIP with exactly eight flat entries.

- [ ] **Step 1: Build the ZIP**

Run:

```powershell
pwsh -NoProfile -File scripts/build_gemini_ui_pack.ps1 -ManifestPath docs/gemini-ui/admin-shell/manifest.json -Force
```

Expected: JSON reports `entries: 8` and output path `artifacts/gemini-ui/frontend-admin-shell-gemini-v1.zip`.

- [ ] **Step 2: Audit entry names, count, and forbidden content**

Run:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Resolve-Path 'artifacts/gemini-ui/frontend-admin-shell-gemini-v1.zip'
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $names = @($archive.Entries | ForEach-Object FullName)
  $expected = @(
    '00-task-contract.md', '01-shared-visual-spec.md', '02-current-admin-shell.png',
    '03-AdminLayout.jsx', '04-AdminSidebar.jsx', '05-PageHeader.jsx',
    '06-index.css', '07-read-only-contract.md'
  )
  if ($names.Count -ne 8) { throw "expected 8 entries, found $($names.Count)" }
  if (@($expected | Where-Object { $_ -notin $names }).Count -ne 0) { throw 'required entry missing' }
  if (@($names | Where-Object { $_ -match 'node_modules|package-lock|\.env|\.db$|\.log$' }).Count -ne 0) {
    throw 'forbidden entry found'
  }
} finally { $archive.Dispose() }
'PASS: Gemini admin shell ZIP contains exactly 8 approved files'
```

Expected: `PASS: Gemini admin shell ZIP contains exactly 8 approved files`.

- [ ] **Step 3: Confirm tracked source files were not modified**

Run:

```powershell
git status --short
```

Expected: no modifications to `frontend/src/components/AdminLayout.jsx`, `AdminSidebar.jsx`, `PageHeader.jsx`, or `frontend/src/index.css`. Existing user document deletions and unrelated ZIPs may remain and must not be staged.

---

### Task 5: Upload Handoff and Response Gate

**Files:**
- Deliver: `artifacts/gemini-ui/frontend-admin-shell-gemini-v1.zip`
- Read: `docs/gemini-ui/admin-shell/00-task-contract.md`

**Interfaces:**
- Consumes: verified eight-file ZIP.
- Produces: a Gemini response containing exactly three complete component files and no executable injector.

- [ ] **Step 1: Provide the upload prompt**

Use this exact message with the ZIP:

```text
请先读取压缩包内的 00-task-contract.md、01-shared-visual-spec.md 和 07-read-only-contract.md，再审查现有组件与截图。严格按 00-task-contract.md 输出：先用不超过 200 个中文字说明视觉取舍，然后只返回其中指定的 3 个完整 React 文件。不要输出脚本、额外文件、假数据或业务逻辑改动。
```

- [ ] **Step 2: Gate the Gemini response before any edit**

Reject the response unless all conditions are true:

```text
1. Exactly three target paths are present.
2. All three outputs are React component files, not an injector script.
3. Component signatures and ADMIN_NAV_ITEMS are preserved.
4. No route, permission, API, hardcoded business data, dependency, or global config change is proposed.
5. No target file exceeds the agreed full-file threshold.
```

- [ ] **Step 3: Stop at the integration boundary**

Do not apply Gemini code in this plan. Save the response for a separate reviewed implementation cycle that starts with component regression tests, applies one file at a time, and performs desktop/mobile browser screenshot comparison.
