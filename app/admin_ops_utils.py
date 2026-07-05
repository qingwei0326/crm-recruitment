import os
from datetime import datetime

from app.backup import BACKUP_DIR, _get_backup_extension


def backup_items(backup_dir: str = BACKUP_DIR) -> list[dict]:
    if not os.path.isdir(backup_dir):
        return []
    items = []
    ext = _get_backup_extension()
    for fname in os.listdir(backup_dir):
        if not (fname.startswith("crm_") and fname.endswith(ext)):
            continue
        fpath = os.path.join(backup_dir, fname)
        try:
            st = os.stat(fpath)
        except OSError:
            continue
        items.append(
            {
                "name": fname,
                "size": st.st_size,
                "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
            }
        )
    items.sort(key=lambda x: x["modified_at"], reverse=True)
    return items
