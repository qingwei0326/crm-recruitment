"""根据学校名推断所属区县。

规则：
1. 命中 SPECIAL_SCHOOLS 字典里的精确学校名 → 用人工归类结果
2. 否则按校名前缀匹配「X县/X市/X区」；若前缀是 福建省/福建/漳州市/漳州 这种省/市级，剥掉再匹配下一层
3. 都不命中返回空串
"""

import re

# 人工核验过的特殊学校归属（校名前缀不带行政区或带错前缀）
SPECIAL_SCHOOLS = {
    # 22 个原本无 县/市/区 前缀的学校
    "福建省漳州市实验小学": "芗城区",
    "福建漳州蓝田经济开发区实验小学": "龙文区",
    "漳州新城学校": "龙文区",
    "龙溪师范学校附属小学": "芗城区",
    "厦门大学附属实验小学": "漳州开发区",
    "漳州康桥学校": "漳州台商投资区",
    "漳州立人学校": "芗城区",
    "漳州南太武实验小学": "龙海市",
    "云霄立人学校": "云霄县",
    "福建省漳州市芗城中学玉兰分校": "芗城区",
    "平和正兴学校": "平和县",
    "漳州双语实验学校": "芗城区",
    "漳州招商局经济技术开发区店地小学": "漳州开发区",
    "云霄云陵工业开发区第一学校": "云霄县",
    "漳浦英才学校": "漳浦县",
    "漳州竹林文武学校": "芗城区",
    "漳州招商局经济技术开发区白沙小学": "漳州开发区",
    "漳浦龙成中学": "漳浦县",
    "福建省华安县高车中心小学": "华安县",
    "长泰三中附小": "长泰县",
    "云霄特殊教育学校": "云霄县",
    "漳州安山文武学校": "芗城区",
    "中国女排华安县先锋希望小学": "华安县",
    # "漳州市XXX" 已明确查证的子集
    "漳州市第二实验小学": "龙文区",
    "漳州市金峰小学": "芗城区",
    "漳州市江滨小学": "芗城区",
    "漳州市正兴学校": "芗城区",
    "漳州市名流学校": "芗城区",
    "漳州市光华学校": "芗城区",
    "漳州市北斗中心小学": "芗城区",
    "漳州市常山华侨经济开发区常山中心小学": "常山开发区",
    "漳州市常山华侨经济开发区北区中心小学": "常山开发区",
    "漳州市常山华侨经济开发区溪墘侨心小学": "常山开发区",
    "漳州市常山华侨经济开发区观竹中心小学": "常山开发区",
}

_PREFIX_PATTERN = re.compile(r"^(.{2,4}?[县区市])")
_PROVINCE_LEVEL = ("福建省", "福建")
_CITY_LEVEL = ("漳州市", "漳州")


def extract_region(school_name: str) -> str:
    if not school_name:
        return ""
    if school_name in SPECIAL_SCHOOLS:
        return SPECIAL_SCHOOLS[school_name]
    m = _PREFIX_PATTERN.match(school_name)
    if not m:
        return ""
    prefix = m.group(1)
    rest = school_name[len(prefix) :]
    m2 = _PREFIX_PATTERN.match(rest)
    if m2 and prefix in _PROVINCE_LEVEL:
        prefix = m2.group(1)
        rest2 = rest[len(prefix) :]
        m3 = _PREFIX_PATTERN.match(rest2)
        if m3 and prefix in _CITY_LEVEL:
            prefix = m3.group(1)
        return prefix
    if m2 and prefix in _CITY_LEVEL:
        prefix = m2.group(1)
    return prefix
