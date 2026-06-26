from app.region_extractor import extract_region


def test_extract_region_uses_external_special_school_config():
    assert extract_region("漳州市第二实验小学") == "龙文区"


def test_extract_region_handles_province_and_city_prefixes():
    assert extract_region("福建省漳州市芗城区实验小学") == "芗城区"
    assert extract_region("漳州市龙文区实验小学") == "龙文区"


def test_extract_region_unknown_school_returns_empty_string():
    assert extract_region("星河国际学校") == ""
