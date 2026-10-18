/** Run through Playwright CLI with a saved course open in an isolated profile. */
async page => {
  const identity = new URL(page.url()).searchParams.get('course')
  if (!identity) throw Error('Open a saved course before checking course navigation.')
  const saved = await (await page.request.get(new URL('/api/workspace/courses/' + encodeURIComponent(identity), page.url()).href)).json()
  const entries = saved.course?.entries
  if (!Array.isArray(entries)) throw Error('The local course is unavailable.')
  const pair = entries.flatMap((first, index) => entries.slice(index + 1).map(second => [first, second]))
    .find(([a, b]) => a.scene.package_id === b.scene.package_id && a.scene.package_version === b.scene.package_version &&
      a.scene.state.kind === b.scene.state.kind && a.scene.state.background === b.scene.state.background &&
      new Set([...a.scene.state.visible, ...b.scene.state.visible]).size <=
        (saved.locations?.find(location => location.id === a.id)?.representation === 'mri-streamlines' ? 6 : 32))
  if (!pair) throw Error('Choose two same-source views whose combined surfaces fit the viewer cache.')
  const primary = page.getByRole('region', { name: 'Primary atlas workspace', exact: true })
  const selection = page.getByRole('combobox', { name: 'Course presentation view', exact: true })
  const errors = [], requests = [], timings = []
  const onError = error => errors.push(String(error))
  const onRequest = request => { if (new URL(request.url()).pathname.startsWith('/atlas/')) requests.push(request.url()) }
  const assert = (condition, message) => { if (!condition) throw Error(message) }
  const storedScene = expected => page.evaluate(async expected => {
    const values = await new Promise((resolve, reject) => {
      const open = indexedDB.open('neuroimage-teaching', 1)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction('content', 'readonly')
        const request = transaction.objectStore('content').getAll()
        transaction.oncomplete = () => { db.close(); resolve(request.result) }
        transaction.onabort = () => { db.close(); reject(transaction.error) }
      }
    })
    return values.map(raw => { try { return JSON.parse(raw) } catch { return null } })
      .filter(value => value?.kind === 'neuroimage-scene' && value.package_id === expected.package_id &&
        value.package_version === expected.package_version && value.build_signature === expected.build_signature)
      .sort((a, b) => b.saved_utc.localeCompare(a.saved_utc))[0]
  }, expected)
  const open = async entry => {
    await selection.selectOption(entry.id)
    await page.waitForFunction(({ id, key }) => {
      const select = document.querySelector('select[aria-label="Course presentation view"]')
      const workspace = document.querySelector('[aria-label="Primary atlas workspace"]')
      return select?.value === id && !select.disabled && document.getElementById('atlas')?.value === key &&
        /^(Ready|Scene saved|Model scene saved)/.test(workspace?.querySelector('.live-status,.model-status')?.textContent ?? '')
    }, { id: entry.id, key: entry.scene.package_id + '-' + entry.scene.package_version }, { timeout: 180000 })
    await primary.getByRole('button', { name: 'Save scene', exact: true }).click()
    await page.waitForFunction(() => /^(Scene saved|Model scene saved)/.test(document.querySelector(
      '[aria-label="Primary atlas workspace"] .live-status,[aria-label="Primary atlas workspace"] .model-status')?.textContent ?? ''))
    const actual = await storedScene(entry.scene)
    assert(actual?.space_id === entry.scene.space_id, 'Navigation changed the source space.')
    const position = entry.scene.state.kind === 'source-model-view' ? 'position_native_mm' : 'position'
    for (const field of ['selected', 'visible', position, 'note', 'annotations', 'surfaceOpacity', 'surfaceCutaway']) {
      if (Object.hasOwn(entry.scene.state, field)) assert(JSON.stringify(actual.state[field]) === JSON.stringify(entry.scene.state[field]), 'Navigation changed ' + field + '.')
    }
  }
  page.on('pageerror', onError)
  let canvas
  try {
    for (const entry of pair) await open(entry)
    canvas = await primary.locator('canvas').elementHandle()
    page.on('request', onRequest)
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const entry of pair) {
        const start = Date.now()
        await open(entry)
        assert(await primary.locator('canvas').evaluate((element, previous) => element === previous, canvas), 'Same-source navigation recreated the canvas.')
        timings.push({ entry: entry.id, seconds: (Date.now() - start) / 1000 })
      }
    }
    assert(!requests.length, 'Warmed same-source navigation requested source assets again.')
    assert(!errors.length, errors.join('\n'))
    return { status: 'passed', course_id: identity, views: pair.map(entry => entry.id), repetitions: 3,
      same_canvas: true, source_requests_after_warmup: requests.length, timings, page_errors: errors,
      timing_method: 'Local UI selection, render readiness, browser save and source-state verification; no screenshot.' }
  } finally {
    page.off('pageerror', onError); page.off('request', onRequest)
    if (canvas) await canvas.dispose()
  }
}
