from core import bala_ai_model_library as library


def test_model_library_groups_by_age_and_gender():
    data = library.load_model_library()

    assert data["name"] == "巴拉AI模特内置素材库"
    assert data["groups"]["66"]["age_label"] == "新生儿"
    assert data["groups"]["66"]["gender"] == "通用"
    assert data["groups"]["73女"]["age_label"] == "婴童"
    assert data["groups"]["73女"]["gender"] == "女"
    assert data["groups"]["100男"]["age_label"] == "幼童"
    assert data["groups"]["100男"]["gender"] == "男"
    assert data["groups"]["140女"]["age_label"] == "中大童"
    assert data["groups"]["140女"]["gender"] == "女"
    assert len(data["items"]) >= 1
    assert all(item["image_url"].startswith("/bala-ai-video-model-library/api/image/") for item in data["items"])


def test_filter_model_library_by_age_gender_and_expression():
    data = library.load_model_library()

    filtered = library.filter_model_library(data, age_label="幼童", gender="女", search="标准")

    assert filtered["items"]
    assert all(item["age_label"] == "幼童" for item in filtered["items"])
    assert all(item["gender"] == "女" for item in filtered["items"])
    assert any(item["id"] == "100女/标准.jpg" for item in filtered["items"])


def test_resolve_model_image_path_rejects_path_traversal():
    resolved = library.resolve_model_image_path("100女/标准.jpg")
    assert resolved.is_file()
    assert resolved.name == "标准.jpg"

    try:
        library.resolve_model_image_path("../manifest.json")
    except ValueError as exc:
        assert "非法模特素材路径" in str(exc)
    else:
        raise AssertionError("path traversal should be rejected")
