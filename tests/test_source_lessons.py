"""Validate named source steps while keeping context distinct from targets."""
import copy
import pytest
from neuroimage.adapters import load_recipe
from neuroimage.lessons import make_lessons


def test_source_model_lessons_use_available_targets_and_context():
    recipe = load_recipe('z_anatomy')
    content = make_lessons(recipe, recipe['objects'])
    lessons = {item['id']: item for item in content['lessons']}
    assert {'NI-Z001', 'NI-Z104', 'NI-Z105', 'NI-Z303', 'NI-Z304',
            'NI-Z403', 'NI-Z501', 'NI-Z502', 'NI-Z503'}.issubset(lessons)
    for ident in ('NI-Z101', 'NI-Z102', 'NI-Z103', 'NI-Z201', 'NI-Z301', 'NI-Z302', 'NI-Z401', 'NI-Z402'):
        lesson = lessons[ident]
        assert len(lesson['structure_ids']) > len(lesson['steps'])
        assert all(step['answer'] for step in lesson['steps'])
        assert lesson['review_status'] == 'draft_not_expert_reviewed'
    assert len(lessons['NI-Z001']['steps']) == 34
    for bad_steps in ([], [{'structure_id': 'unknown', 'prompt': 'Observe', 'question': 'Identify'}]):
        changed = copy.deepcopy(recipe)
        changed['teaching_sequences'][0]['steps'] = bad_steps
        with pytest.raises(ValueError, match='available targets'):
            make_lessons(changed, changed['objects'])
