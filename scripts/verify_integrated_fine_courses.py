"""Compare exported browser scenes with each source-bound recorded course entry."""
import argparse
import json
from pathlib import Path
import zipfile

from neuroimage.build import atomic_json, sha256, utc_now


def verify(root, log, directory, browser_script):
    report = json.JSONDecoder().raw_decode(log.read_text().split('### Result\n', 1)[1])[0]
    if report['status'] != 'passed' or report['page_errors'] or report['external_requests']:
        raise ValueError('All course browser interactions must finish successfully')
    report.update(recorded_utc=utc_now(), browser_script_sha256=sha256(browser_script),
                  verifier_sha256=sha256(Path(__file__)), scene_checks=[], export_checks=[])
    courses = {}
    for row in report['verified']:
        identity = row['course_id']
        if identity not in courses:
            courses[identity] = json.loads((root / 'exports/courses' / identity / 'course.json').read_text())
        entries = {entry['id']: entry for entry in courses[identity]['entries']}
        expected = entries[row['entry']]['scene']
        path = (root / row['scene']).resolve()
        path.relative_to(directory)
        actual = json.loads(path.read_text())
        for field in ['package_id', 'package_version', 'build_signature', 'space_id']:
            if actual[field] != expected[field]:
                raise ValueError(f'{row["plan"]}/{row["entry"]}: changed {field}')
        state, recorded = actual['state'], expected['state']
        model = recorded.get('kind') == 'source-model-view'
        fields = (['selected', 'visible', 'position_native_mm', 'camera', 'focus_native_mm',
                   'surfaceOpacity', 'surfaceCutaway', 'highlightSelected'] if model else
                  ['selected', 'visible', 'position', 'background', 'radiological', 'pan',
                   'surfaceOpacity', 'surfaceCutaway', 'sectionPlanes', 'overlay', 'labelOpacity'])
        for field in fields:
            if state.get(field) != recorded.get(field):
                raise ValueError(f'{row["plan"]}/{row["entry"]}: changed {field}')
        if not model:
            if state['camera'][:2] != recorded['camera'][:2]:
                raise ValueError('Recorded MRI camera direction changed')
            fitted = recorded.get('fitVisible3D', recorded.get('layout') == 'anatomy') and not recorded.get('imageContext')
            if fitted:
                if state.get('fitVisible3D') is not True:
                    raise ValueError('Complete visible geometry fitting was lost')
            elif state['camera'] != recorded['camera'] or state.get('focus3D') != recorded.get('focus3D'):
                raise ValueError('Recorded fixed camera framing changed')
        report['scene_checks'].append({'scene': row['scene'], 'sha256': sha256(path),
            'package_id': actual['package_id'], 'space_id': actual['space_id'],
            'selected': state['selected'], 'position': state.get('position', state.get('position_native_mm')),
            'source_binding_and_recorded_state': 'matched'})
    expected_pairs = {(identity, entry['id']) for identity, course in courses.items() for entry in course['entries']}
    actual_pairs = {(row['course_id'], row['entry']) for row in report['verified']}
    if actual_pairs != expected_pairs or len(report['verified']) != len(actual_pairs):
        raise ValueError('Every course entry must have one actual exported browser scene')
    for path in sorted(directory.glob('*/*-teaching.zip')):
        with zipfile.ZipFile(path) as archive:
            scene = json.loads(archive.read('scene.json'))
            manifest = json.loads(archive.read('provenance.json'))
            if (scene['build_signature'] != manifest['build']['signature']
                    or scene['space_id'] != manifest['space']['id']
                    or not any(item['id'] == scene['state']['selected'] for item in manifest['structures'])
                    or not all(source['license_file'] in archive.namelist() for source in manifest['sources'])
                    or not all(name in archive.namelist() for name in ['anatomy.png', 'rendering.json', 'teaching-notes.txt'])):
                raise ValueError('Teaching export lost its source, scene or license binding')
        report['export_checks'].append({'path': path.relative_to(root).as_posix(), 'sha256': sha256(path),
                                       'package_id': scene['package_id'], 'source_license_scene_binding': 'matched'})
    if len(report['export_checks']) != report['source_count']:
        raise ValueError('Each represented source requires one credited teaching export')
    atomic_json(directory / 'acceptance.json', report)
    return {'status': 'passed', 'courses': len(courses), 'views': len(actual_pairs), 'exports': len(report['export_checks'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--log', type=Path, required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--browser-script', type=Path, default=Path('scripts/browser_integrated_fine_courses.js'))
    args = parser.parse_args()
    root = args.data_root.resolve()
    directory = (root / args.directory).resolve()
    directory.relative_to(root)
    print(json.dumps(verify(root, args.log, directory, args.browser_script)))


if __name__ == '__main__':
    main()
