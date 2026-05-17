# J1900 Same-Environment Deployment

Target path on J1900:

```text
D:\CRM
```

Do not use a Chinese path on J1900.

## Current First-Deploy Folder

Use this exact release folder from the dev machine:

```text
releases\admissions-crm-20260517-130821
```

This is the full offline first-deploy package. It already includes:

```text
.pydeps
node_modules
frontend\node_modules
```

Do not use an older package. No zip is needed. Copy the folder itself to J1900.

## First-Time J1900 Setup

1. Create the target folder:

```powershell
New-Item -ItemType Directory -Path 'D:\CRM' -Force
```

2. Copy runtime data from the dev machine into `D:\CRM`:

```text
crm.db
.secret_key
.env
```

After this, J1900 should have:

```text
D:\CRM\crm.db
D:\CRM\.secret_key
D:\CRM\.env
```

3. Copy the full release folder to J1900, but keep it outside `D:\CRM`. A simple staging path is:

```text
D:\deploy\admissions-crm-20260517-130821
```

4. Open PowerShell inside that copied folder and run:

```powershell
.\deploy-update.ps1
```

The default target is already `D:\CRM`. You can also be explicit:

```powershell
.\deploy-update.ps1 -Target 'D:\CRM'
```

5. Check the app:

```text
http://127.0.0.1:8000
```

## J1900 Requirements

The release bundle includes the Python and Node dependencies, but J1900 still needs:

```text
Python
Node.js / npm
```

If needed, set `CRM_PYTHON` to the Python interpreter path before starting.

## Startup

After the app works on J1900, install startup from the target folder:

```powershell
Set-Location 'D:\CRM'
.\install-startup-folder.ps1
```

This creates a startup shortcut for the current Windows user.

## Future Updates

On the dev machine:

```powershell
Set-Location '<your dev repo root>'
.\make-release.ps1 -IncludeDeps
```

Copy the new release folder to J1900 and run `.\deploy-update.ps1` from inside it.

The deployment script will:

1. Back up `D:\CRM\crm.db`, `D:\CRM\.secret_key`, and `D:\CRM\.env`
2. Stop the old service if `stop.ps1` exists
3. Copy release files into `D:\CRM`
4. Preserve runtime data files
5. Start the service with `D:\CRM\start.ps1`

## Cloudflare Domain

`crm.qing-wei.com` can continue to be used, but `cloudflared` must run on J1900 and point to:

```text
http://127.0.0.1:8000
```

Final shape:

```text
crm.qing-wei.com
  -> Cloudflare Tunnel
  -> J1900
  -> http://127.0.0.1:8000
```

## Important Rule

After switching to J1900, the only active database should be:

```text
D:\CRM\crm.db
```

Do not run another live copy with a separate `crm.db`.
