"""The isolated browser fixture must resolve cache-versioned URLs like a browser."""
import pytest
from tests.support.browser_harness import _asset_data_uri


@pytest.mark.parametrize('suffix', [
    '?v=71a9fc7b2e050e7c', '#preview', '?v=71a9fc7b2e050e7c#preview',
])
def test_versioned_product_image_embeds_the_same_bytes_and_mime_type(suffix):
    path = '/assets/images/products/name-plate.webp'
    plain = _asset_data_uri(path)
    assert plain.startswith('data:image/webp;base64,')
    assert _asset_data_uri(path + suffix) == plain
