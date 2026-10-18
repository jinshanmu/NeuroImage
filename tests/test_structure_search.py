"""Exact native-package structure lookup, pagination and unavailable data behavior."""
import json
import shutil

import pytest

from neuroimage.structure_search import search_structures
from test_pipeline import source, build


def test_search_keeps_historical_definitions_separate_and_never_reads_arrays(source, monkeypatch):
    path = build(source)
    original = json.loads(path.read_text())
    copy = path.parent.with_name('historical')
    shutil.copytree(path.parent, copy)
    historical = json.loads(path.read_text())
    historical['package_version'] = 'historical'
    (copy / 'manifest.json').write_text(json.dumps(historical))
    monkeypatch.setattr('nibabel.load', lambda *_a, **_k: pytest.fail('Search must not decode imaging arrays'))
    result = search_structures(source[0], 'CAUDATE left')
    assert result['total'] == 2 and result['indexed_packages'] == 2
    assert {item['package_version'] for item in result['matches']} == {original['package_version'], 'historical'}
    assert all(item['structure_id'] == 'synthetic:label:11' for item in result['matches'])
    assert len({item['atlas_key'] for item in result['matches']}) == 2
    assert all('manifest' not in item and 'position' not in item for item in result['matches'])
    first = search_structures(source[0], 'test', limit=1)
    second = search_structures(source[0], 'test', offset=1, limit=1)
    assert first['total'] == 4 and first['matches'] != second['matches']
    assert search_structures(source[0], 'synthetic:label:50')['total'] == 2
    assert search_structures(source[0], 'caudate', dataset='other')['total'] == 0
    assert search_structures(source[0], 'caudate', module='unavailable-module')['total'] == 0


def test_damaged_package_is_omitted_without_changing_originals(source):
    path = build(source)
    manifest = json.loads(path.read_text())
    missing = path.parent / manifest['assets'][0]['path']
    saved = missing.read_bytes(); missing.unlink()
    result = search_structures(source[0], 'caudate')
    assert result['matches'] == [] and result['unavailable_packages'] == 1
    assert not missing.exists()
    missing.write_bytes(saved)
    assert search_structures(source[0], 'left')['total'] == 1


@pytest.mark.parametrize('query,options', [('', {}), ('x', {}), ('a' * 161, {}), ('left', {'offset':-1}), ('left', {'limit':101})])
def test_search_rejects_invalid_query_or_page_before_reading_data(tmp_path, query, options):
    with pytest.raises(ValueError):
        search_structures(tmp_path, query, **options)
