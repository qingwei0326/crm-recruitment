# -*- coding: utf-8 -*-
"""重置 admin 密码为 123456，放 D:\CRM 下运行：python reset_pw.py"""
import sqlite3, os
db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crm.db")
con = sqlite3.connect(db)
con.execute("UPDATE users SET hashed_password=? WHERE username='admin'",
            ("$2b$12$25QW2Xu/Eno/TJNhMlEwU.6jMKyIs5BiYOhm0SAH1kWnAUJm6vYzG",))
con.commit()
print("done - admin 密码已重置为 123456")
