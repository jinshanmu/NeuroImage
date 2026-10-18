# Local teaching library and courses

The workspace's **Teaching library** opens prepared image notebooks, independent model notebooks and imported source scenes. Each file retains its exact package version, construction signature and native space. Source models keep native XYZ; image atlases keep their declared image coordinates. Opening a teaching file validates its matching local package before the viewer validates and restores the scene.

**Browse anatomy**, the home link and **Teaching library** keep their selected destination after a page refresh. **Edit course** also retains the selected saved course. Saved notebook and course links continue to open their exact recorded content. Save or export live edits before refreshing; destination recovery preserves navigation, while teaching files preserve the content itself.

## Prepare and keep teaching material

Open a source's **Data tools**, select an available local package and choose a compatible **Teaching recipe**. **Prepare teaching** writes a reusable notebook under the data drive's `exports/<dataset>/notebooks/` directory. Its file appears automatically in the teaching library. The same preparation contract supports image and independent model curricula.

Use **Add teaching file** for a scene or notebook exported from the viewer. The library preserves an exact content-addressed copy under `exports/<package>/teaching/<hash>/content.json`. Importing the same file again reuses that copy. Original files, old package versions and earlier prepared notebooks remain intact. The library scans only those two documented export locations; it does not index raw source files or unrelated benchmark artifacts.

Search by topic, author or source, then choose **Open notebook** or **Open scene**. **Open in a new page** provides a bookmarkable teaching link. A model notebook supports native clipping, object visibility, camera, prompts, ordering, removal/undo, explicit browser save and portable export/import. Image notebooks retain their existing contrast, slice, camera, markers and practice controls. Unsaved notebook drafts survive navigation within the current page. Save or export a notebook before closing the browser.

## Build a course across sources

For a prepared starting sequence, use **Start from a course plan**. The first plan covers general intracranial anatomy. Choose the exact local package version for each listed source, then **Prepare course**. The operation verifies required source definitions, prepares reusable notebooks and saves the selected original scenes as a course. **Open prepared course** starts the recorded sequence. The organizer also lists the resulting course.

| Plan | Recorded views | Source configurations |
| --- | ---: | ---: |
| BigBrain cortical layers and hippocampal subfields | 30 | 2 |
| Cisternal regions: native image and spatial observation | 8 | 2 |
| Cranial nerves: source objects and regional context | 15 | 4 |
| Association and limbic white matter probability anatomy | 34 | 1 |
| Projection and callosal white matter probability anatomy | 34 | 1 |
| Brainstem nuclei, root assignments and cranial-nerve context | 24 | 6 |
| Cerebellar surfaces, lobular fields and deep nuclei | 26 | 3 |
| Cortical folds, cytoarchitectonic assignments and layer boundaries | 17 | 3 |
| Hippocampal layers, subfields and white-matter context | 15 | 4 |
| Intracranial anatomy: first teaching session | 6 | 1 |
| NextBrain Case 1: histological fine anatomy and MRI | 38 | 7 |
| NextBrain Case 2: brainstem fine anatomy and MRI | 38 | 4 |
| Interpreting normal variation across individual and population sources | 11 | 8 |
| Regional anatomy across native source atlases | 22 | 4 |
| Skull base: source skull, dura and intracranial context | 14 | 4 |
| Cerebellar lobules, vermis and deep nuclei | 40 | 1 |
| Cerebral arterial segments in healthy volunteer MRA | 24 | 3 |
| Normal arterial variation: source observations across eight volunteers | 16 | 8 |
| Vascular anatomy: native images, fields and source models | 18 | 5 |
| White matter: supplied streamline pathways | 10 | 1 |
| Cerebellar and ventricular source-model relationships | 38 | 1 |
| Frontal and central cortical surface relationships | 20 | 1 |
| Medial and basal cortical surface relationships | 16 | 1 |
| Temporal, parietal and insular surface relationships | 20 | 1 |
| Source models: distal arteries, sensory pathways and petrous context | 28 | 1 |
| Sella, clinoid processes and sphenoidal grooves | 18 | 1 |

The twenty-six plans select 580 views from 75 installed curricula containing 700 views. Views may appear in more than one plan; the counts describe teaching sequences and preserve each source definition. Four [integrated fine-anatomy courses](integrated-fine-anatomy-teaching.md) organize 82 existing observations across independently retained sources. Native images, computational fields and source models keep their recorded evidence descriptions.

Preparation progress is saved under `exports/course-preparations/<plan>/<signature>/`. The signature includes the plan, curriculum definitions, selected source manifest hashes, software version and preparation implementation. **Stop course preparation** retains completed notebooks. Repeating the same choices resumes or reuses them. Once a saved course has been edited, the original preparation preserves that course and reports the changed revision. Use **Make a copy** before adapting a prepared sequence when you also want to retain repeatable preparation of the original.

To assemble a different sequence yourself:

1. In **Teaching library**, choose **New course** and enter its title, author and learning objective.
2. Find a notebook or scene below the organizer and choose **Add to course**. A notebook contributes all its recorded views. Each course supports up to 100 views and a 10 MiB JSON file.
3. Select a view to edit its title or discussion prompt. Use **Move course view earlier/later** to change the order. **Remove course view** has an undo action while the editor remains open.
4. Choose **Save course** to preserve the course on the data drive. Browser drafts are also retained locally while editing. Save the current draft before selecting another saved course or closing the editor.
5. Choose **Present course**. The course opens the recorded source, position, selection and display settings. **Return to course view** restores the stored scene after live exploration.

**Compare another recorded view** opens an independently bound course view in the comparison panel. Its position stays separate while the main lesson advances. Each panel uses its own source geometry and coordinates; course organization does not establish an anatomical mapping or registration between datasets. Ordinary comparison controls and per-panel scene export remain available.

The saved course position is an entry identifier, so reordering preserves the last viewed entry. The position is stored after a successful local source opening. Reopen the course link after restarting the service or browser to continue. The primary recorded view is restored; exploratory changes are retained only when saved as source scenes or notebook content. Comparison scenes can be saved or exported separately.

## Export, transfer and recover

**Export course** writes a portable JSON document. Every embedded scene carries the source identifiers, version, native space, citations, license declaration, construction parameters and processing records from its original package. Images, categorical arrays, probability fields, meshes and trajectories remain in the separate local atlas packages. Recipients acquire or recover their own matching packages.

**Import course** preserves the portable identity. An identical import reuses an existing saved course. If another revision already uses that identity, reopen the saved course or choose **Make a copy** before saving the imported draft. Concurrent saves report the changed revision instead of overwriting it.

Course files live at `exports/courses/<course-id>/course.json`. `previous-course.json` retains the preceding saved revision; `position.json` records the most recently opened main view. For recovery, import the retained revision as a new course copy. Keep these small teaching files with the required historical atlas packages. A missing package is shown per view, and the course file remains available for recovery.

Command-line equivalents:

```bash
neuroimage teaching library --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching import path/to/notebook.json --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching courses --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching course COURSE_UUID --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching course-import path/to/course.json --new-copy --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching course-schema
neuroimage teaching course-plans
neuroimage teaching course-plans intracranial-foundations
neuroimage teaching course-prepare intracranial-foundations --packages source-choices.json --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching course-plan-schema
```

`source-choices.json` maps each required dataset ID to the exact `package_id-package_version` from `neuroimage library --data-root "$ATLAS_DATA_ROOT"`. For the first plan, provide the `spl_nac` key and the verified version of that local package. Course plans reference installed curriculum names and stable view IDs. They contain English instructions and source references; all acquired assets remain in the separate local packages.

The portable contracts are `schemas/teaching-course.schema.json` and `schemas/teaching-course-plan.schema.json`. Their engineering identity checks and browser acceptance are separate from anatomical instructor assessment of the individual source views.

## Frame small structures for teaching

In an image atlas, **Focus selected 3D** sets the camera center and scale from the selected structure's physical source bounds. Slice coordinates and 2D zoom stay unchanged. **Equal 2D + 3D** keeps four equal panels in one horizontal row at every window size. The 3D panel is last on the right. **Fit visible 3D** centers all visible source bounds and fits their projected extent within the viewport, including after rotation or resizing; **3D anatomy** uses the full canvas for the source surfaces. **Expand viewer** provides additional screen space. Use **Full 3D context** to return to the broader reference view. Saved scenes and teaching exports retain the chosen framing. The `focus_selected_3d` display option applies the same source-bound framing during notebook preparation; `layout: "anatomy"` selects the four equal panels. `fitVisible3D` preserves automatic camera fitting in saved scenes; manual zoom switches to a fixed camera scale. The installed regional curricula use responsive panels and focused 3D bounds to fit different window sizes.

The source selector shares the available header width with the anatomy, teaching and comparison controls. Both page edges and all four image frames follow the browser width. The browser provides page scrolling in ordinary and expanded viewing; the main canvas column grows with its controls. Expanded image viewing keeps the same source coordinate while the window is resized. Use **Exit expanded view** to return to the ordinary header, teaching controls and prior page scroll position.
