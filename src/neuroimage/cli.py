"""Command-line workflow for independently acquired local atlases."""
from pathlib import Path
import argparse
import json
import sys
from . import __version__
from .adapters import load_recipe, recipe_names
from .build import build_atlas


def main(argv=None):
    parser = argparse.ArgumentParser(prog="neuroimage", description="Local normal intracranial anatomy atlas")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    doctor = sub.add_parser("doctor", help="Check the Linux environment, viewer, dependencies and selected storage")
    doctor.add_argument("--data-root", type=Path)
    doctor.add_argument("--state-root", type=Path)
    doctor.add_argument("--recipe", choices=recipe_names())
    doctor.add_argument("--storage-policy", type=Path)
    setup = sub.add_parser("quickstart", help="Acquire, build, validate and open one anatomical source")
    setup.add_argument("recipe", choices=recipe_names())
    setup.add_argument("--data-root", required=True, type=Path)
    setup.add_argument("--state-root", required=True, type=Path)
    setup.add_argument("--storage-policy", type=Path)
    setup.add_argument("--workers", type=int, default=2)
    setup.add_argument("--port", type=int, default=8765)
    setup.add_argument("--dry-run", action="store_true", help="Show source terms, manual downloads and storage needs without changing files")
    setup.add_argument("--no-start", action="store_true", help="Finish acquisition and construction without starting the service")
    setup.add_argument("--no-browser", action="store_true")
    recipes = sub.add_parser("recipes", help="List source recipes and acquisition requirements")
    recipes.add_argument("name", nargs="?")
    acquire = sub.add_parser("acquire", help="Acquire pinned source files, selectively expand and resume interrupted transfers")
    acquire.add_argument("recipe", choices=recipe_names())
    acquire.add_argument("--data-root", required=True, type=Path)
    acquire.add_argument("--storage-policy", type=Path, help="JSON storage policy; HDD floor defaults to 400 GiB")
    acquire.add_argument("--dry-run", action="store_true", help="Print sources and peak additional storage without writes or network access")
    build = sub.add_parser("build", help="Build or resume an atlas without modifying sources")
    build.add_argument("recipe", choices=recipe_names())
    build.add_argument("--data-root", required=True, type=Path)
    build.add_argument("--workers", type=int, default=4)
    build.add_argument("--storage-policy", type=Path, help="JSON storage policy; HDD floor defaults to 400 GiB")
    validate = sub.add_parser("validate", help="Validate package schema and every asset checksum")
    validate.add_argument("manifest", type=Path)
    library = sub.add_parser("library", help="Discover complete and interrupted local atlas builds without loading images")
    library.add_argument("--data-root", required=True, type=Path)
    library.add_argument("--dataset", help="Limit the inventory to one dataset directory")
    search = sub.add_parser("search", help="Find source-specific structures across exact local atlas versions")
    search.add_argument("query", help="English name, source abbreviation or stable structure ID")
    search.add_argument("--data-root", required=True, type=Path)
    search.add_argument("--dataset", default="", help="Limit matches to one source dataset")
    search.add_argument("--module", default="", help="Limit matches to a learning-module ID")
    search.add_argument("--offset", type=int, default=0, help="Skip this many matches; each page contains at most 100")
    locate = sub.add_parser("locate", help="Find the exact local atlas required by a saved scene or teaching notebook")
    locate.add_argument("content", type=Path)
    locate.add_argument("--data-root", required=True, type=Path)
    teaching = sub.add_parser("teaching", help="Prepare source-bound teaching notebooks from installed or custom recipes")
    teaching_sub = teaching.add_subparsers(dest="teaching_action", required=True)
    curricula = teaching_sub.add_parser("recipes", help="List installed English teaching recipes or inspect one")
    curricula.add_argument("name", nargs="?")
    teaching_sub.add_parser("schema", help="Print the JSON Schema for an English teaching recipe")
    teaching_sub.add_parser("course-schema", help="Print the portable independent-source teaching course schema")
    teaching_sub.add_parser("course-plan-schema", help="Print the reproducible source-bound course plan schema")
    course_plans = teaching_sub.add_parser("course-plans", help="List installed course plans or inspect one")
    course_plans.add_argument("name", nargs="?")
    course_prepare = teaching_sub.add_parser("course-prepare", help="Build or resume a course from explicit local package choices")
    course_prepare.add_argument("plan", help="Installed plan name or local course plan JSON file")
    course_prepare.add_argument("--packages", required=True, type=Path, help="JSON object mapping each source dataset to its exact local package key")
    course_prepare.add_argument("--data-root", required=True, type=Path)
    course_prepare.add_argument("--storage-policy", type=Path)
    course_list = teaching_sub.add_parser("courses", help="List saved local teaching courses")
    course_list.add_argument("--data-root", type=Path, required=True)
    course_show = teaching_sub.add_parser("course", help="Inspect a saved course, original sources and last viewed position")
    course_show.add_argument("id")
    course_show.add_argument("--data-root", type=Path, required=True)
    course_import = teaching_sub.add_parser("course-import", help="Save a portable source-bound course on the data drive")
    course_import.add_argument("content", type=Path)
    course_import.add_argument("--data-root", type=Path, required=True)
    course_import.add_argument("--new-copy", action="store_true", help="Assign a fresh course identity while retaining original scene bindings")
    course_import.add_argument("--storage-policy", type=Path)
    lesson_prepare = teaching_sub.add_parser("prepare", help="Prepare or reuse a notebook from actual local source targets")
    lesson_prepare.add_argument("recipe", help="Installed curriculum name or path to an English JSON recipe")
    lesson_prepare.add_argument("--atlas", required=True, type=Path)
    lesson_prepare.add_argument("--data-root", required=True, type=Path)
    lesson_prepare.add_argument("--storage-policy", type=Path)
    content_list = teaching_sub.add_parser("library", help="List saved local teaching files and their exact source versions")
    content_list.add_argument("--data-root", required=True, type=Path)
    content_list.add_argument("--query", default="")
    content_list.add_argument("--dataset", default="")
    content_import = teaching_sub.add_parser("import", help="Preserve a scene or notebook in the local teaching library")
    content_import.add_argument("content", type=Path)
    content_import.add_argument("--data-root", required=True, type=Path)
    content_import.add_argument("--storage-policy", type=Path)
    launch = sub.add_parser("open", help="Find and open the exact local atlas and a saved scene or teaching notebook")
    launch.add_argument("content", type=Path)
    launch.add_argument("--data-root", required=True, type=Path)
    launch.add_argument("--port", type=int, default=8765)
    launch.add_argument("--no-browser", action="store_true", help="Start the local viewer and print its URL without opening a browser")
    review = sub.add_parser("review", help="Prepare source-bound material and check manual review records")
    review_sub = review.add_subparsers(dest="review_action", required=True)
    prepare = review_sub.add_parser("prepare", help="Prepare independent structure and lesson review material")
    prepare.add_argument("manifest", type=Path)
    prepare.add_argument("--data-root", required=True, type=Path)
    prepare.add_argument("--limit", type=int, default=20)
    prepare.add_argument("--storage-policy", type=Path)
    notebook_review = review_sub.add_parser("notebook", help="Assemble full-section and magnified teaching exports into a manual review packet")
    notebook_review.add_argument("notebook", type=Path)
    notebook_review.add_argument("--captures", required=True, type=Path, help="Data-drive folder containing view-1.zip and optional view-1-magnified.zip exports")
    notebook_review.add_argument("--data-root", required=True, type=Path)
    notebook_review.add_argument("--storage-policy", type=Path)
    assemble = review_sub.add_parser("assemble", help="Verify and assemble captured review images")
    assemble.add_argument("packet", type=Path)
    assemble.add_argument("--keep-captures", action="store_true")
    capture = review_sub.add_parser("capture", help="Capture fixed scenes through an existing Playwright CLI browser session")
    capture.add_argument("packet", type=Path)
    capture.add_argument("--cli", default="playwright-cli", help="Path to the existing Playwright CLI executable or wrapper")
    capture.add_argument("--session", default="neuroimage")
    check = review_sub.add_parser("check", help="Check assessment identity and completeness, not anatomical correctness")
    check.add_argument("assessment", type=Path)
    check.add_argument("--packet", required=True, type=Path)
    queue = review_sub.add_parser("queue", help="Collect exact notebook cases into an offline preliminary-suitability review queue")
    queue.add_argument("--packet", required=True, action="append", type=Path)
    queue.add_argument("--data-root", required=True, type=Path)
    queue.add_argument("--storage-policy", type=Path)
    suitability = review_sub.add_parser("check-suitability", help="Verify a case-suitability record against exact original review images")
    suitability.add_argument("assessment", type=Path)
    suitability.add_argument("--queue", required=True, type=Path)
    suitability.add_argument("--data-root", required=True, type=Path)
    serve = sub.add_parser("serve", help="Browse explicitly selected packages offline over loopback")
    serve.add_argument("--atlas", action="append", required=True, type=Path)
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--web-root", type=Path, default=Path(__file__).with_name("web"))
    serve.add_argument("--content", type=Path, help="Open this exact source-bound scene or notebook on startup")
    workspace = sub.add_parser("workspace", help="Acquire, construct, open and prepare local teaching through a browser interface")
    workspace.add_argument("--data-root", required=True, type=Path)
    workspace.add_argument("--state-root", required=True, type=Path, help="Separate SSD directory for job state and bounded diagnostic logs")
    workspace.add_argument("--workers", type=int, default=2)
    workspace.add_argument("--storage-policy", type=Path)
    workspace.add_argument("--port", type=int, default=8765)
    workspace.add_argument("--no-browser", action="store_true")
    schema = sub.add_parser("schema", help="Print the atlas manifest JSON Schema")
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            from .setup import installation_report
            result = installation_report(data_root=args.data_root, state_root=args.state_root,
                                         recipe=args.recipe, storage_policy=args.storage_policy)
            print(json.dumps(result, indent=2))
            if not result["ready"]:
                raise SystemExit(1)
        elif args.command == "quickstart":
            from .setup import quickstart
            quickstart(args.recipe, args.data_root, args.state_root, storage_policy=args.storage_policy,
                       workers=args.workers, dry_run=args.dry_run)
            if not args.dry_run and not args.no_start:
                command = ["workspace", "--data-root", str(args.data_root), "--state-root", str(args.state_root),
                           "--workers", str(args.workers), "--port", str(args.port)]
                if args.storage_policy:
                    command.extend(["--storage-policy", str(args.storage_policy)])
                if args.no_browser:
                    command.append("--no-browser")
                return main(command)
        elif args.command == "recipes":
            print(json.dumps(load_recipe(args.name) if args.name else {"recipes": recipe_names()}, indent=2))
        elif args.command in {"acquire", "build"}:
            policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
            if args.command == "acquire":
                from .acquire import acquire
                acquire(args.recipe, args.data_root, minimum_free_gib=policy.get("hdd_minimum_free_gib", 400), dry_run=args.dry_run)
            else:
                build_atlas(args.recipe, args.data_root, workers=args.workers, minimum_free_gib=policy.get("hdd_minimum_free_gib", 400))
        elif args.command == "validate":
            from .validation import validate_package
            statistics = {}
            manifest = validate_package(args.manifest, cache_policy="refresh", statistics=statistics)
            print(json.dumps({"status": "passed", "package": manifest.package_id, "version": manifest.package_version,
                              "assets": len(manifest.assets), "anatomical_review": manifest.validation["anatomical_review"],
                              **statistics}, indent=2))
        elif args.command == "library":
            from .library import library_records
            print(json.dumps({"schema_version": "1.0", "packages": library_records(args.data_root, dataset=args.dataset),
                              "scope": "Metadata, declared file sizes and lesson references only. Hashes and geometry remain unchecked until validate or serve."}, indent=2))
        elif args.command == "search":
            from .structure_search import search_structures
            print(json.dumps(search_structures(args.data_root, args.query, dataset=args.dataset,
                                              module=args.module, offset=args.offset), indent=2))
        elif args.command == "locate":
            from .library import locate_content
            print(json.dumps(locate_content(args.content, args.data_root), indent=2))
        elif args.command == "teaching":
            from .teaching import teaching_recipe_schema, curriculum_names, curriculum_path, prepare
            if args.teaching_action == "schema":
                print(json.dumps(teaching_recipe_schema(), indent=2))
            elif args.teaching_action == "course-schema":
                from .courses import TeachingCourse
                print(json.dumps(TeachingCourse.model_json_schema(), indent=2))
            elif args.teaching_action == "course-plan-schema":
                from .course_plans import CoursePlan
                print(json.dumps(CoursePlan.model_json_schema(), indent=2))
            elif args.teaching_action == "course-plans":
                from .course_plans import plan_catalog, plan_path, read_plan
                print(json.dumps(read_plan(plan_path(args.name)) if args.name else {"plans": plan_catalog()}, indent=2))
            elif args.teaching_action == "course-prepare":
                from .course_plans import plan_path, prepare_course
                from .workspace import load_small_json
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                print(json.dumps(prepare_course(plan_path(args.plan), load_small_json(args.packages), args.data_root,
                    minimum_free_gib=policy.get("hdd_minimum_free_gib", 400),
                    progress=lambda event: print(json.dumps(event), flush=True)), indent=2))
            elif args.teaching_action == "courses":
                from .courses import course_records
                print(json.dumps(course_records(args.data_root), indent=2))
            elif args.teaching_action == "course":
                from .courses import get_course
                print(json.dumps(get_course(args.data_root, args.id), indent=2))
            elif args.teaching_action == "course-import":
                import uuid
                from .courses import _read, save_course
                course = _read(args.content)[0]
                if args.new_copy:
                    course["id"] = str(uuid.uuid4())
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                print(json.dumps(save_course(course, args.data_root, minimum_free_gib=policy.get("hdd_minimum_free_gib", 400)), indent=2))
            elif args.teaching_action == "recipes":
                print(json.dumps(json.loads(curriculum_path(args.name).read_text()) if args.name else {"recipes": curriculum_names()}, indent=2))
            elif args.teaching_action == "library":
                from .content_library import teaching_records
                print(json.dumps(teaching_records(args.data_root, query=args.query, dataset=args.dataset), indent=2))
            elif args.teaching_action == "import":
                from .content_library import import_teaching, read_content
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                print(json.dumps(import_teaching(read_content(args.content)[0], args.data_root,
                                                minimum_free_gib=policy.get("hdd_minimum_free_gib", 400)), indent=2))
            else:
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                print(json.dumps(prepare(args.atlas, curriculum_path(args.recipe), args.data_root,
                                         policy.get("hdd_minimum_free_gib", 400)), indent=2))
        elif args.command == "review":
            from .review import assemble_review, check_assessment, prepare_review
            if args.review_action == "queue":
                from .review_queue import prepare_queue
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                print(json.dumps(prepare_queue(args.packet, args.data_root, minimum_free_gib=policy.get("hdd_minimum_free_gib", 400)), indent=2))
            elif args.review_action == "check-suitability":
                from .review_queue import check_suitability
                print(json.dumps(check_suitability(args.assessment, args.queue, args.data_root), indent=2))
            elif args.review_action == "notebook":
                from .notebook_review import prepare_notebook_review
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                print(json.dumps(prepare_notebook_review(args.notebook, args.captures, args.data_root,
                    minimum_free_gib=policy.get("hdd_minimum_free_gib", 400)), indent=2))
            elif args.review_action == "prepare":
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                root = prepare_review(args.manifest, args.data_root, limit=args.limit, minimum_free_gib=policy.get("hdd_minimum_free_gib", 400))
                print(json.dumps({"packet": str(root), "anatomical_review": "not_performed"}, indent=2))
            elif args.review_action == "assemble":
                print(json.dumps(assemble_review(args.packet, keep_captures=args.keep_captures), indent=2))
            elif args.review_action == "capture":
                from .review_capture import capture_review
                capture_review(args.packet, cli=args.cli, session=args.session)
            else:
                print(json.dumps(check_assessment(args.assessment, args.packet), indent=2))
        elif args.command in {"serve", "open", "workspace"}:
            from .server import create_server
            manager = None
            if args.command == "open":
                from .library import locate_content
                match = locate_content(args.content, args.data_root)
                server = create_server([match["manifest"]], Path(__file__).with_name("web"), args.port, content_path=args.content)
            elif args.command == "workspace":
                from .workspace import Workspace
                policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
                manager = Workspace(args.data_root, args.state_root, workers=args.workers,
                    data_floor_gib=policy.get("hdd_minimum_free_gib", 400), state_floor_gib=policy.get("ssd_minimum_free_gib", 60))
                try:
                    server = create_server([], Path(__file__).with_name("web"), args.port, workspace=manager)
                except BaseException:
                    manager.close()
                    raise
            else:
                server = create_server(args.atlas, args.web_root, args.port, content_path=args.content)
            url = f"http://127.0.0.1:{server.server_port}"
            print(f"NeuroImage is available at {url}. Press Ctrl+C to stop.", flush=True)
            if args.command in {"open", "workspace"} and not args.no_browser:
                import webbrowser
                if not webbrowser.open(url):
                    print("Open the printed local URL in a WebGL2 browser.", flush=True)
            try:
                server.serve_forever()
            finally:
                server.server_close()
                if manager:
                    manager.close()
        else:
            from .contracts import Manifest
            print(json.dumps(Manifest.model_json_schema(), indent=2))
    except (ValueError, FileNotFoundError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except KeyboardInterrupt:
        print("Stopped safely. Completed build checkpoints remain reusable.", file=sys.stderr)
        raise SystemExit(130)


if __name__ == "__main__":
    main()
