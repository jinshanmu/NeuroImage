"""Optional Playwright CLI capture of fixed review scenes, in resumable batches."""
import json
from pathlib import Path
import subprocess
import tempfile
import time
from .acquire import destination
from .build import sha256
from .review import assemble_review, read_plan, validate_capture

SCRIPT = r'''async page => {
  const work = PAYLOAD;
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({width:1600,height:1050});
  const catalog = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases);
  const atlas = catalog.find(a => a.key === work.package_id + '-' + work.package_version);
  if (!atlas) throw new Error('The matching review package must be offered by the current local service.');
  await page.goto(new URL('/?view=atlas&atlas=' + encodeURIComponent(atlas.key), page.url()).href);
  await page.waitForFunction(() => document.querySelector('.live-status')?.textContent?.startsWith('Ready'), null, {timeout:120000});
  const completed=[];
  for (const item of work.cases) {
    await page.locator('.scene-toolbar input[type=file]').setInputFiles(item.scene);
    await page.waitForFunction(() => document.querySelector('.live-status')?.textContent?.startsWith('Ready'), null, {timeout:45000});
    if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').textContent());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'Export image',exact:true}).click();
    await (await download).saveAs(item.output);
    completed.push(item.id);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {status:'passed',completed,page_errors:errors};
}'''


def capture_review(packet, *, cli="playwright-cli", session="neuroimage"):
    root = Path(packet).resolve(); plan = read_plan(root)
    assembled = assemble_review(root)
    state_path = root / "capture-state.json"
    state = json.loads(state_path.read_text())["completed"] if state_path.exists() else {}
    pending = [case for case in plan["cases"] if case["id"] not in state or not (root / case["image_file"]).is_file()
               or sha256(root / case["image_file"]) != state[case["id"]]["image_sha256"]
               or sha256(root / case["scene_file"]) != state[case["id"]]["scene_sha256"]]
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="neuroimage-review-capture-") as work:
        for offset in range(0, len(pending), 4):
            batch = pending[offset:offset+4]
            payload = {"package_id": plan["package_id"], "package_version": plan["package_version"], "cases": [
                {"id": case["id"], "scene": str(destination(root, case["scene_file"])), "output": str(destination(root, "captures/" + case["id"] + ".zip"))} for case in batch]}
            script = Path(work) / "capture.js"
            script.write_text(SCRIPT.replace("PAYLOAD", json.dumps(payload)))
            result = subprocess.run([cli, "-s=" + session, "run-code", "--filename=" + str(script)], capture_output=True, text=True)
            log = root / "capture-log.txt"
            with log.open("a") as stream:
                stream.write(result.stdout); stream.write(result.stderr)
            if result.returncode or "### Error" in result.stdout:
                detail = result.stdout.split("### Error")[-1][:1500] if "### Error" in result.stdout else result.stderr[-1500:]
                raise ValueError(f"Browser capture interrupted. Verified prior cases remain reusable. Details: {detail}; log: {log}")
            for case in batch:
                validate_capture(destination(root, "captures/" + case["id"] + ".zip"), plan, case)
            assembled = assemble_review(root)
            print(json.dumps({"event": "review-capture-progress", **assembled, "seconds": round(time.monotonic()-started, 2)}), flush=True)
    print(json.dumps({"event": "review-capture-complete", **assembled, "new_captures": len(pending), "seconds": round(time.monotonic()-started, 2)}), flush=True)
    return assembled
