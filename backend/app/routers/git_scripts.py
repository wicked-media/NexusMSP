from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/git-scripts/list")
async def list_scripts(current_user: dict = Depends(get_current_user)):
    scripts = await db.git_scripts.find({}, {"_id": 0}).to_list(100)
    if not scripts:
        scripts = await _seed_scripts()
    return scripts

@router.get("/git-scripts/{script_id}/history")
async def script_history(script_id: str, current_user: dict = Depends(get_current_user)):
    script = await db.git_scripts.find_one({"id": script_id}, {"_id": 0})
    if not script:
        return {"error": "Not found"}
    return {"script": script, "commits": script.get("commits", [])}

async def _seed_scripts():
    scripts_data = [
        ("Install-SentinelOne.ps1", "powershell", "Automated S1 agent install with site token", "# SentinelOne Agent Install\nparam([string]$SiteToken)\n$installer = 'https://s1-dl.example.com/agent.msi'\nInvoke-WebRequest -Uri $installer -OutFile C:\\temp\\s1.msi\nStart-Process msiexec.exe -ArgumentList \"/i C:\\temp\\s1.msi /qn SITE_TOKEN=$SiteToken\" -Wait\nGet-Service SentinelAgent | Select Status"),
        ("Reset-UserPassword.ps1", "powershell", "Force password reset with temp password and require change", "param([string]$Username,[string]$TempPassword)\nSet-ADAccountPassword -Identity $Username -Reset -NewPassword (ConvertTo-SecureString $TempPassword -AsPlainText -Force)\nSet-ADUser -Identity $Username -ChangePasswordAtLogon $true\nUnlock-ADAccount -Identity $Username"),
        ("Clear-PrintQueue.ps1", "powershell", "Nuclear option for stuck print queues", "Stop-Service Spooler -Force\nRemove-Item C:\\Windows\\System32\\spool\\PRINTERS\\* -Force\nStart-Service Spooler\nGet-Printer | Select Name, PrinterStatus"),
        ("Check-DiskHealth.sh", "bash", "SMART health check for Linux servers", "#!/bin/bash\nfor disk in $(lsblk -d -o NAME | tail -n +2); do\n  echo \"=== /dev/$disk ===\"\n  smartctl -H /dev/$disk\n  smartctl -A /dev/$disk | grep -E 'Reallocated|Pending|Uncorrectable'\ndone"),
        ("Deploy-WinGet-Apps.ps1", "powershell", "Bulk app install via WinGet", "param([string[]]$Apps = @('Google.Chrome','Mozilla.Firefox','7zip.7zip','Notepad++.Notepad++'))\nforeach($app in $Apps){\n  Write-Host \"Installing $app...\"\n  winget install $app --accept-package-agreements --accept-source-agreements -h\n}"),
    ]
    scripts = []
    for name, lang, desc, content in scripts_data:
        s = {"id": f"gs-{uuid.uuid4().hex[:8]}", "name": name, "language": lang, "description": desc, "content": content, "version": f"1.{random.randint(0,5)}.{random.randint(0,9)}", "author": random.choice(["Alex Thompson", "Sarah Chen", "Mike Rodriguez"]), "last_modified": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))).isoformat(),
             "commits": [{"hash": uuid.uuid4().hex[:7], "message": "Initial version", "author": "Alex Thompson", "date": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}, {"hash": uuid.uuid4().hex[:7], "message": "Added error handling", "author": "Sarah Chen", "date": (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()}, {"hash": uuid.uuid4().hex[:7], "message": "Updated for latest API", "author": "Alex Thompson", "date": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}],
             "tags": [lang, random.choice(["deployment", "security", "maintenance", "monitoring"])], "execution_count": random.randint(10, 200)}
        scripts.append(s)
        await db.git_scripts.insert_one(s)
    return [{k: v for k, v in s.items() if k != "_id"} for s in scripts]
