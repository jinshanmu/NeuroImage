async page => {
  const url = new URL(page.url()), origin = url.origin;
  const jobs = (url.searchParams.get('review-jobs') ?? '').split(',').filter(Boolean);
  const assert = (ok, message) => { if (!ok) throw Error(message) };
  assert(jobs.length > 0, 'Provide completed preparation job IDs in review-jobs.');
  const errors = [], external = [], reports = [];
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  await page.unroute('**/*');
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : (external.push(route.request().url()), route.abort()));
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Notebook scene restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(), 'The viewer reported an error.');
  };
  const position = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  for (const job of jobs) {
    const book = await page.evaluate(async id => (await (await fetch('/api/workspace/content/' + id)).json()).content, job);
    const entries = book.scenes.filter(entry => entry.scene.state.pan[3] === 1);
    const output = 'data/exports/' + book.package_id + '/context-review-' + book.id;
    await page.goto(origin + '/?workspace-content=' + encodeURIComponent(job));
    await ready();
    await page.getByLabel('Import teaching notebook file', {exact: true}).setInputFiles(output + '/review-notebook.json');
    await page.getByRole('button', {name: 'Present notebook', exact: true}).click();
    await ready();
    const exportView = async name => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', {name: 'Export teaching image', exact: true}).click();
      await (await pending).saveAs(output + '/' + name + '.zip');
    };
    for (let index = 0; index < entries.length; index++) {
      await ready();
      const actual = await position(), expected = entries[index].scene.state.position;
      assert(actual.every((value, axis) => Math.abs(value - expected[axis]) < .011), 'The recorded source point moved.');
      assert(Number(await page.getByLabel('2D zoom', {exact: true}).inputValue()) === 1, 'Review must begin with complete sections.');
      await exportView('view-' + (index + 1));
      await page.getByRole('button', {name: 'Magnify at cursor', exact: true}).click();
      await ready();
      assert(JSON.stringify(await position()) === JSON.stringify(actual), 'Magnification moved the source point.');
      await exportView('view-' + (index + 1) + '-magnified');
      await page.getByRole('button', {name: 'Return to recorded view', exact: true}).click();
      await ready();
      if (index + 1 < entries.length) await page.getByRole('button', {name: 'Next view', exact: true}).click();
    }
    const pending = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Export notebook', exact: true}).click();
    await (await pending).saveAs(output + '/review-notebook.json');
    reports.push({dataset: book.package_id, package_version: book.package_version, complete_section_pairs: entries.length, notebook: output.replace(/^data\//, '') + '/review-notebook.json'});
  }
  page.off('pageerror', onError);
  await page.unroute('**/*');
  assert(!errors.length && !external.length, errors.concat(external).join('\n'));
  return {status: 'passed', reports, page_errors: errors, external_requests: external};
}
