from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid
import random
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== PROXMOX VM MANAGEMENT ==============

@router.get("/proxmox/nodes")
async def get_proxmox_nodes(current_user: dict = Depends(get_current_user)):
    """Get all Proxmox nodes/servers"""
    nodes = await db.proxmox_nodes.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not nodes:
        # Return demo data
        nodes = [
            {"id": "node-1", "name": "pve-node01", "status": "online", "cpu_usage": 34.2, "memory_usage": 67.5, "disk_usage": 45.0, "uptime_hours": 720, "vm_count": 8, "ip": "10.0.0.10"},
            {"id": "node-2", "name": "pve-node02", "status": "online", "cpu_usage": 22.8, "memory_usage": 55.1, "disk_usage": 38.7, "uptime_hours": 720, "vm_count": 5, "ip": "10.0.0.11"},
            {"id": "node-3", "name": "pve-node03", "status": "warning", "cpu_usage": 89.5, "memory_usage": 92.3, "disk_usage": 78.2, "uptime_hours": 168, "vm_count": 12, "ip": "10.0.0.12"},
        ]
    return nodes

@router.get("/proxmox/vms")
async def get_proxmox_vms(node_id: Optional[str] = None, client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get all VMs across Proxmox nodes"""
    query = {}
    if node_id:
        query["node_id"] = node_id
    if client_id:
        query["client_id"] = client_id
    db_vms = await db.proxmox_vms.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    # Always generate demo VMs if empty
    if not db_vms:
        # Generate demo VMs
        vm_templates = [
            {"name": "DC-PRIMARY", "os": "Windows Server 2022", "type": "vm", "vcpu": 4, "ram_gb": 16, "disk_gb": 120, "status": "running"},
            {"name": "WEB-SERVER-01", "os": "Ubuntu 22.04", "type": "vm", "vcpu": 2, "ram_gb": 8, "disk_gb": 80, "status": "running"},
            {"name": "SQL-DB-01", "os": "Windows Server 2019", "type": "vm", "vcpu": 8, "ram_gb": 32, "disk_gb": 500, "status": "running"},
            {"name": "FILE-SERVER", "os": "Windows Server 2022", "type": "vm", "vcpu": 2, "ram_gb": 8, "disk_gb": 2000, "status": "running"},
            {"name": "EXCHANGE-01", "os": "Windows Server 2019", "type": "vm", "vcpu": 4, "ram_gb": 16, "disk_gb": 250, "status": "stopped"},
            {"name": "BACKUP-SRV", "os": "Ubuntu 24.04", "type": "vm", "vcpu": 2, "ram_gb": 4, "disk_gb": 4000, "status": "running"},
            {"name": "DEV-CONTAINER", "os": "Debian 12", "type": "lxc", "vcpu": 1, "ram_gb": 2, "disk_gb": 20, "status": "running"},
            {"name": "MONITORING", "os": "Ubuntu 22.04", "type": "lxc", "vcpu": 1, "ram_gb": 4, "disk_gb": 50, "status": "running"},
        ]
        pve_nodes = ["node-1", "node-2", "node-3"]
        clients_list = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10)
        demo_vms = []
        for i, t in enumerate(vm_templates):
            c = clients_list[i % len(clients_list)] if clients_list else {"id": "", "name": ""}
            vm = {
                "id": f"vm-{100+i}",
                "vmid": 100 + i,
                "node_id": pve_nodes[i % len(pve_nodes)],
                "node_name": f"pve-node0{(i % 3) + 1}",
                "client_id": c["id"],
                "client_name": c.get("name", ""),
                **t,
                "cpu_usage": round(random.uniform(5, 85), 1),
                "memory_usage": round(random.uniform(20, 90), 1),
                "disk_usage": round(random.uniform(15, 75), 1),
                "uptime_seconds": random.randint(3600, 2592000),
                "ip_address": f"10.0.{i+1}.{random.randint(2,200)}",
                "backup_enabled": random.choice([True, True, True, False]),
                "last_backup": (datetime.now(timezone.utc).isoformat() if random.random() > 0.3 else None),
                "backup_schedule": random.choice(["daily", "weekly", "none"]),
                "tags": random.sample(["production", "development", "staging", "critical", "monitoring"], random.randint(1, 3)),
            }
            demo_vms.append(vm)
        return demo_vms
    return db_vms


@router.post("/proxmox/vms/{vm_id}/action")
async def vm_action(vm_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Perform action on a VM: start, stop, reboot, shutdown, suspend, resume"""
    action = data.get("action", "")
    valid_actions = ["start", "stop", "reboot", "shutdown", "suspend", "resume", "reset"]
    if action not in valid_actions:
        raise HTTPException(status_code=400, detail=f"Invalid action. Valid: {valid_actions}")

    # Log the action
    log = {
        "id": str(uuid.uuid4()),
        "vm_id": vm_id,
        "action": action,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.proxmox_action_logs.insert_one(log)

    # Update VM status based on action
    status_map = {"start": "running", "stop": "stopped", "shutdown": "stopped", "reboot": "running", "suspend": "suspended", "resume": "running", "reset": "running"}
    await db.proxmox_vms.update_one({"id": vm_id}, {"$set": {"status": status_map.get(action, "running")}})

    return {"message": f"VM {action} executed successfully", "vm_id": vm_id, "action": action, "new_status": status_map.get(action, "running")}


@router.get("/proxmox/vms/{vm_id}/action-log")
async def get_vm_action_log(vm_id: str, current_user: dict = Depends(get_current_user)):
    """Get action history for a VM"""
    logs = await db.proxmox_action_logs.find({"vm_id": vm_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return logs


# ============== BACKUP MANAGEMENT ==============

@router.get("/proxmox/backups")
async def get_proxmox_backups(vm_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Get backup list"""
    query = {}
    if vm_id:
        query["vm_id"] = vm_id
    backups = await db.proxmox_backups.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    if not backups and not vm_id:
        # Demo data
        backups = [
            {"id": f"bkp-{i}", "vm_id": f"vm-{100+i%8}", "vm_name": ["DC-PRIMARY","WEB-SERVER-01","SQL-DB-01","FILE-SERVER","EXCHANGE-01","BACKUP-SRV","DEV-CONTAINER","MONITORING"][i%8],
             "type": random.choice(["full", "incremental", "differential"]), "size_gb": round(random.uniform(5, 200), 1),
             "status": random.choice(["completed", "completed", "completed", "failed"]),
             "duration_minutes": random.randint(5, 120), "retention_days": random.choice([7, 14, 30, 90]),
             "storage": random.choice(["local-zfs", "nfs-backup", "ceph-backup"]),
             "created_at": datetime.now(timezone.utc).isoformat(), "compressed": True, "verified": random.choice([True, True, False])}
            for i in range(12)
        ]
    return backups


@router.post("/proxmox/backups")
async def create_backup(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new backup job"""
    backup = {
        "id": str(uuid.uuid4()),
        "vm_id": data.get("vm_id"),
        "vm_name": data.get("vm_name", ""),
        "type": data.get("type", "full"),
        "storage": data.get("storage", "local-zfs"),
        "retention_days": data.get("retention_days", 30),
        "compressed": data.get("compressed", True),
        "status": "running",
        "size_gb": 0,
        "duration_minutes": 0,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "verified": False,
    }
    await db.proxmox_backups.insert_one(backup)
    backup.pop("_id", None)
    return backup


@router.post("/proxmox/backups/{backup_id}/restore")
async def restore_backup(backup_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Initiate a restore from backup"""
    backup = await db.proxmox_backups.find_one({"id": backup_id}, {"_id": 0})
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    restore_log = {
        "id": str(uuid.uuid4()),
        "backup_id": backup_id,
        "vm_id": backup.get("vm_id"),
        "target_vm": data.get("target_vm", backup.get("vm_id")),
        "status": "in_progress",
        "initiated_by": current_user["id"],
        "initiated_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.proxmox_restore_logs.insert_one(restore_log)
    restore_log.pop("_id", None)
    return restore_log


@router.get("/proxmox/backup-schedules")
async def get_backup_schedules(current_user: dict = Depends(get_current_user)):
    """Get configured backup schedules"""
    schedules = await db.proxmox_backup_schedules.find({}, {"_id": 0}).to_list(50)
    if not schedules:
        schedules = [
            {"id": "sched-1", "name": "Nightly Full Backup", "schedule": "0 2 * * *", "type": "full", "storage": "nfs-backup", "retention_days": 30, "enabled": True, "vms": ["vm-100","vm-102","vm-103"], "last_run": datetime.now(timezone.utc).isoformat()},
            {"id": "sched-2", "name": "Hourly Incrementals", "schedule": "0 * * * *", "type": "incremental", "storage": "local-zfs", "retention_days": 7, "enabled": True, "vms": ["vm-100","vm-102"], "last_run": datetime.now(timezone.utc).isoformat()},
            {"id": "sched-3", "name": "Weekly Archive", "schedule": "0 3 * * 0", "type": "full", "storage": "ceph-backup", "retention_days": 90, "enabled": False, "vms": ["vm-100","vm-101","vm-102","vm-103","vm-104","vm-105"], "last_run": None},
        ]
    return schedules


@router.post("/proxmox/backup-schedules")
async def create_backup_schedule(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a backup schedule"""
    schedule = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "New Schedule"),
        "schedule": data.get("schedule", "0 2 * * *"),
        "type": data.get("type", "full"),
        "storage": data.get("storage", "local-zfs"),
        "retention_days": data.get("retention_days", 30),
        "enabled": data.get("enabled", True),
        "vms": data.get("vms", []),
        "last_run": None,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.proxmox_backup_schedules.insert_one(schedule)
    schedule.pop("_id", None)
    return schedule
