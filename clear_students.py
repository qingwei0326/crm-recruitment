import sys, os
sys.path.insert(0, r'D:\CRM\.pydeps')
os.environ['PYTHONNOUSERSITE'] = '1'
from sqlalchemy import create_engine, text
e = create_engine(r'sqlite:///D:\CRM\crm.db')
with e.begin() as conn:
    conn.execute(text('PRAGMA foreign_keys=OFF'))
    for t in ['calls','notes','follow_ups','visits','lead_view_logs','operation_logs','students']:
        r = conn.execute(text(f'SELECT COUNT(*) FROM {t}'))
        print(f'{t}: {r.scalar()} deleted')
        conn.execute(text(f'DELETE FROM {t}'))
    conn.execute(text('PRAGMA foreign_keys=ON'))
print('done')
