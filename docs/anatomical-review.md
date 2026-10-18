# Independent anatomical and lesson review

Engineering validation establishes file integrity and defined spatial relationships. Independent human review is still required to assess anatomical definitions, source limitations and teaching content. The review workflow never changes an atlas's `not_reviewed` status automatically.

## Prepare source-bound material

Use the same `NeuroImage` environment and configured data root as construction. Supply an already validated local package:

```bash
neuroimage review prepare "$ATLAS_MANIFEST" --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json
```

The command prints a packet directory under `benchmarks/<dataset_id>/review-<version>`. By default it selects up to 20 structures across deep structures, ventricles, cortex, brainstem and cerebellum, according to the package's actual coverage. It includes every available lesson and a scene for each lesson step. A reduced `--limit` supports focused feedback; record the actual reviewed scope. Source streamline packages use trajectory-specific criteria and actual retained vertex targets. Expert review is tracked independently of software implementation and engineering acceptance.

Each packet contains the exact source manifest, licenses, fixed source-target scenes, an English offline assessment page, a review plan and a blank JSON assessment template. Source publications and successful engineering tests are not prefilled as reviewer judgments. Twenty structures with four criteria each and eight lessons with three criteria each produce 104 initially unassessed criteria.

The plan retains native coordinates, source names and uncertainty. Paired structures may be shown together where the source provides explicit matching left/right names. A target is a real labelled voxel or retained trajectory vertex, not a claimed anatomical landmark. An individual, template and composite model require different interpretations even when their structure names are similar.

## Capture and inspect

Open the matching package in the local viewer. Import each `scenes/NI-R*.json` file and use **Export teaching image**. Save the corresponding ZIP in the packet's `captures` directory as `NI-R001.zip`, `NI-R002.zip`, and so on. Then assemble:

```bash
neuroimage review assemble "$REVIEW_PACKET"
```

The assembler checks the package, build, native space, selected structure and target coordinate before accepting each PNG. It also requires a recorded viewer build and rendering policy that excludes complete-mesh projections from 2D sections. Superseded captures cannot be reused as current slice-boundary evidence. It retains verified image and scene hashes for resume and removes only its verified redundant capture ZIPs. Use `--keep-captures` to retain those ZIPs. Originals and atlas assets are never modified. Changed images are not counted as completed captures.

An existing Playwright CLI browser session can automate the same viewer controls:

```bash
neuroimage review capture "$REVIEW_PACKET" --cli playwright-cli --session neuroimage
```

The browser must already be open at the local viewer, with the matching package offered by its service. This optional helper requires an independently installed Playwright CLI and a browser with working file downloads; it does not install tools or change the browser configuration. Captures run in batches of four and report progress. Rerunning skips verified images. The diagnostic `capture-log.txt` remains with the local packet. After an interrupted or failed capture, inspect the reported error and resume the command; quarantine a corrupt capture ZIP before retrying it.

Open the packet's `index.html` locally. Inspect all images and reopen the supplied scenes in the exact matching atlas whenever a static view is insufficient. Assess orientation, label definition, image correspondence and uncertainty for each structure. Review each lesson's anatomy, instructions and limitations. Use **Not resolvable** when the available evidence cannot support a judgment. Explain requested revisions and non-applicability.

## Save and check a manual record

Enter the reviewer's identity, qualifications and review date. Use **Export assessment JSON** before closing the page. Import that JSON into the same packet to continue; it rejects records for another package or packet. The page does not submit anything to a server and does not autosave reviewer entries.

```bash
neuroimage review check "$ASSESSMENT_JSON" --packet "$REVIEW_PACKET"
```

This reports record format, assessed criteria and requested revisions. A complete record does not certify anatomy, resolve objections or independently verify reviewer qualifications. Keep the record and any expert correspondence as separate local evidence. Record expert judgments and required corrections explicitly, with their view/criterion scope. The historical M20 review target is now a separate review plan and is excluded from software progress calculations. Do not edit the blank template or a package manifest to manufacture approval.

The packet contains derived source images and must remain separate from software distributions. Its reuse follows the retained dataset terms. Only the reusable review code, template, instructions and engineering check results belong in Git.
## Probability evidence and older packages

For a structure with source probability evidence, the fixed review scene and captured image retain the probability overlay. The packet includes a separate categorical comparison scene at the same native location. Its criteria address the declared probability interpretation, uncertainty and computational derivation. For CIT168, these include observer support, population averaging and the source-inferred right side. A categorical-only capture is not accepted in place of the requested probability view.

Source interpretation and channel derivation are printed alongside the case. Review packets still start without judgments; computational agreement with a declared navigation-label rule does not approve its anatomy. Optional contract fields are normalized when checking older package metadata, so original schema 1.0/1.1 packages remain reviewable without rewriting their source manifests.
