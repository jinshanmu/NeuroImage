import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

const metadata = JSON.parse(readFileSync('package.json', 'utf8'))
const digest = createHash('sha256')
const files = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'web/index.html',
  ...readdirSync('web/src', { recursive: true }).filter(name => /\.(ts|tsx|css)$/.test(String(name)) && !String(name).endsWith('.test.ts')).map(name => 'web/src/' + name)]
for (const file of files.sort()) { digest.update(file + '\0'); digest.update(readFileSync(file)) }
const viewer = { version: metadata.version, build_sha256: digest.digest('hex'), renderer: 'NiiVue', renderer_version: metadata.dependencies['@niivue/niivue'],
  mesh_projection_in_2d: false, label_sampling: 'nearest-neighbor',
  orientation_labels: 'renderer-native direction mapping; foreground depth-disabled text with contrast backing; minimum 16 CSS pixels',
  independent_regions: { membership: 'independent masks; source or project-derived origin recorded per region; overlaps retained', two_dimensional: 'selected unchanged source probability or explicitly identified binary display mask', selection: 'nearest native voxel in visible regions; selected field stays fixed' },
  view_centering: 'full source sections by default; cursor-centered display magnification; physical RAS view parameters only; source coordinates and voxel values unchanged',
  streamline_rendering: { coordinates: 'source RAS millimetres', two_dimensional: 'physical slab clipped line segments; width recorded in scene',
    geometry: 'complete original trajectories selected by recorded source indices; no point simplification or tube radius', color: 'fixed bundle color; no random dither', selection_tolerance_mm: 1 },
  section_guides: { geometry: 'RAS plane intersected with the affine-transformed voxel field of view', source: 'schematic display guide; no tissue or image texture', depth_picking: false },
  surface_opacity: 'overall multiplier times per-structure multiplier; source arrays and geometry unchanged',
  surface_cutaway: 'native RAS half-space fragment clipping for selected 3D surfaces and their depth picking; original vertices and complete 2D sections unchanged; no cap or inferred internal tissue',
  native_image: 'For image-only (mri-volume) packages: byte-identical original source NIfTI, or an explicitly declared exact native frame with the complete original series retained; no segmentation or inferred surface; 2D nearest source samples and 3D intensity ray rendering; volume picking uses renderer-native 8-bit coordinate fractions and is approximate',
  source_model: { coordinates: 'Independent SOURCE_XYZ millimeters; no RAS assignment or image volume', selection: 'native triangle surface distance after framebuffer-depth unprojection; no source vertex changes', default_framing: 'complete visible source bounds before user magnification', selection_highlight: 'optional cyan display color; preserved in scenes; legacy scenes retain source colors' },
  image_panel_layout: 'responsive fit, explicit grid or row; retained in scene; legacy scenes preserve the original grid; equal anatomy panels stay in one full-width row at every window size; 3D is last on the right; optional visible-source bounds fitting preserves complete geometry',
  depth_picking: 'integer framebuffer pixel read and matching pixel-center unprojection; explicit 24-bit RGB integer depth without dithering; unblended surface depth for positive-opacity geometry; hidden and zero-opacity geometry excluded',
  scene_markers: { source: 'preserved source-bound RAS annotations', slice_tolerance_mm: .05, three_dimensional: 'projected-through-anatomy' } }

export default defineConfig({
  root: 'web',
  plugins: [react()],
  define: { __NEUROIMAGE_VIEWER__: JSON.stringify(viewer) },
  build: { outDir: '../src/neuroimage/web', emptyOutDir: true, sourcemap: false },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8765', '/atlas': 'http://127.0.0.1:8765' } },
})
