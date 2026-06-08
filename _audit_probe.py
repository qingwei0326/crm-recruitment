import sqlite3, os, glob
dbs = glob.glob('D:/招生系统/crm.db') + glob.glob('D:/招生系统/*.db')
dbs = list(dict.fromkeys(dbs))
print('DB candidates:', dbs)
for db in dbs:
    print('\n===== ', db, ' size=', os.path.getsize(db), ' =====')
    con = sqlite3.connect(db)
    print('--- INDEXES ---')
    for r in con.execute("SELECT tbl_name, name, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name").fetchall():
        print(r[0], '|', r[1], '|', r[2])
    print('--- ROW COUNTS ---')
    for t in ('students','calls','notes','follow_ups','operation_logs','visits','dial_logs','lead_view_logs','login_attempts','users'):
        try:
            print(t, con.execute('SELECT COUNT(*) FROM '+t).fetchone()[0])
        except Exception as e:
            print(t, 'ERR', e)
    print('journal_mode:', con.execute('PRAGMA journal_mode').fetchone())
    print('busy_timeout:', con.execute('PRAGMA busy_timeout').fetchone())
    con.close()
