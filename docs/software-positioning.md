# A reproducible workflow for neuroanatomy teaching

NeuroImage Atlas connects independently obtained neuroanatomy resources to reusable browser lessons. A teacher can move from native MRI sections to source labels, overlapping probability fields, trajectories, or an independent anatomical model while retaining what each representation actually means. A saved view identifies the exact package, construction signature and native space that produced it.

## Problems addressed

- **Preparing lessons across incompatible resources.** A common adapter, package and validation contract replaces separate acquisition-to-viewing procedures. It preserves source names, coordinates, terms and version evidence rather than silently treating different atlases as one anatomy.
- **Recovering the intended teaching state.** Scenes retain position, visibility, camera, annotations and learning state. Notebooks sequence views; courses sequence source-bound notebook entries. Incompatible package or space identities are rejected before replacing open work.
- **Keeping source evidence visible.** The browser distinguishes image observations, categorical labels, independent probability memberships, computational trajectories and author-defined models. It does not infer tissue where a resource lacks it.
- **Sharing software without redistributing acquired anatomy.** The repository supplies code, schemas, recipes and teaching definitions. Users obtain each resource under its individual terms and construct local packages through the same interfaces.

## Relationship to 3D Slicer

The application consists of a Python service and a React/TypeScript browser interface using NiiVue. It does not launch, embed or require 3D Slicer. Slicer already provides extensive image computing, MRML scene management, scripting and extensions. NeuroImage's contribution is the explicit link between source acquisition, validated package identity and portable teaching state, together with a curated normal-neuroanatomy workflow. It does not claim that Slicer cannot implement comparable workflows or that its rendering or general image processing is superior.

For neurosurgical and neurological educators, the practical benefit is a recoverable explanation of normal spatial relationships with the source evidence attached. For researchers, the same contracts make resource-specific inputs and scene state inspectable. These are software capabilities; improved learning, comprehensive anatomical validity and clinical benefit require separate studies.

See [scope and development plan](release-scope-and-roadmap.md), [adapter development](adapter-development.md), and [teaching courses](teaching-library-and-courses.md).
