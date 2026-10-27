import { describe, expect, it, vi } from 'vitest'
import type { Niivue, NVMesh } from '@niivue/niivue'
import { SurfaceOIT, type SurfaceOITCommand } from './surfaceOIT'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const source = '#version 300 es\nprecision highp float;\nin vec4 vClr;\nuniform float opacity;\nout vec4 color;\nvoid main(){color=vec4(vClr.rgb,opacity);}'
type Handle = { id: number; kind: string; name?: string; source?: string; attached?: Handle[] }
type Framebuffer = { draw: number[]; read: number; attachments: Map<number, Handle> }

const constants = {
  NONE: 0, ZERO: 0, ONE: 1, TRIANGLES: 4, NO_ERROR: 0, INVALID_OPERATION: 1282,
  FRONT: 1028, BACK: 1029, LEQUAL: 515, GREATER: 516, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771,
  FRAMEBUFFER: 36160, READ_FRAMEBUFFER: 36008, DRAW_FRAMEBUFFER: 36009,
  READ_FRAMEBUFFER_BINDING: 36010, DRAW_FRAMEBUFFER_BINDING: 36006, FRAMEBUFFER_COMPLETE: 36053,
  COLOR_ATTACHMENT0: 36064, COLOR_ATTACHMENT1: 36065, COLOR_ATTACHMENT2: 36066, DEPTH_ATTACHMENT: 36096,
  DEPTH_COMPONENT16: 33189, DEPTH_COMPONENT24: 33190, DEPTH_COMPONENT32F: 36012, RGBA16F: 34842,
  CURRENT_PROGRAM: 35725, VERTEX_ARRAY_BINDING: 34229, READ_BUFFER: 3074, DRAW_BUFFER0: 34853,
  VIEWPORT: 2978, SCISSOR_BOX: 3088, COLOR_WRITEMASK: 3107, DEPTH_WRITEMASK: 2930, DEPTH_FUNC: 2932,
  CULL_FACE_MODE: 2885, BLEND_SRC_RGB: 32969, BLEND_DST_RGB: 32968, BLEND_SRC_ALPHA: 32971, BLEND_DST_ALPHA: 32970,
  BLEND_EQUATION_RGB: 32777, BLEND_EQUATION_ALPHA: 34877, COLOR_CLEAR_VALUE: 3106, DEPTH_CLEAR_VALUE: 2931,
  ACTIVE_TEXTURE: 34016, TEXTURE_BINDING_2D: 32873, TEXTURE0: 33984, TEXTURE_2D: 3553,
  TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
  NEAREST: 9728, CLAMP_TO_EDGE: 33071, DEPTH_TEST: 2929, CULL_FACE: 2884, BLEND: 3042, SCISSOR_TEST: 3089,
  FUNC_ADD: 32774, FUNC_REVERSE_SUBTRACT: 32779, UNSIGNED_INT: 5125, COLOR: 6144, DEPTH_BUFFER_BIT: 256,
  VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
  MAX_DRAW_BUFFERS: 34852, MAX_COLOR_ATTACHMENTS: 36063, MAX_TEXTURE_IMAGE_UNITS: 34930, DEPTH_BITS: 3414,
}

/** Models framebuffer-local buffers and global GL state, not the OIT algorithm. */
class ResourceGL {
  [key: string]: any
  parameters = new Map<number, any>()
  enabled = new Set<number>()
  textures = new Map<number, Handle | null>()
  framebuffers = new Map<Handle | null, Framebuffer>()
  liveTextures = new Set<Handle>(); liveFbos = new Set<Handle>(); livePrograms = new Set<Handle>()
  liveShaders = new Set<Handle>(); liveVaos = new Set<Handle>()
  readFbo: Handle | null = null; drawFbo: Handle | null = null
  initialRead = { id: -3, kind: 'external-read-fbo' }
  serial = 0
  failBlit = false
  draws: { kind: 'mesh' | 'resolve'; fbo: Handle | null; buffers: number[]; program: Handle;
    depth: boolean; depthWrite: boolean; blend: boolean; colorWrite: boolean[]; viewport: number[]; scissor: number[]; vao: Handle }[] = []
  blits: { read: Handle | null; draw: Handle | null; args: number[] }[] = []

  constructor() {
    Object.assign(this, constants)
    this.parameters = new Map([
      [this.CURRENT_PROGRAM, { id: -1, kind: 'previous-program' }], [this.VERTEX_ARRAY_BINDING, { id: -2, kind: 'previous-vao' }],
      [this.VIEWPORT, [10, 20, 320, 240]], [this.SCISSOR_BOX, [0, 0, 100, 100]],
      [this.COLOR_WRITEMASK, [false, true, false, true]], [this.DEPTH_WRITEMASK, false], [this.DEPTH_FUNC, this.GREATER],
      [this.CULL_FACE_MODE, this.FRONT], [this.BLEND_SRC_RGB, this.ONE], [this.BLEND_DST_RGB, this.ZERO],
      [this.BLEND_SRC_ALPHA, this.ZERO], [this.BLEND_DST_ALPHA, this.ONE],
      [this.BLEND_EQUATION_RGB, this.FUNC_REVERSE_SUBTRACT], [this.BLEND_EQUATION_ALPHA, this.FUNC_ADD],
      [this.COLOR_CLEAR_VALUE, [.1, .2, .3, .4]], [this.DEPTH_CLEAR_VALUE, .25], [this.ACTIVE_TEXTURE, this.TEXTURE0 + 3],
    ])
    this.enabled.add(this.SCISSOR_TEST)
    for (const unit of [3, 5, 12, 13, 14, 15]) this.textures.set(this.TEXTURE0 + unit, { id: -10 - unit, kind: 'previous-texture' })
    this.framebuffers.set(null, { draw: [this.BACK], read: this.BACK, attachments: new Map() })
    this.framebuffers.set(this.initialRead, { draw: [this.COLOR_ATTACHMENT0], read: this.COLOR_ATTACHMENT1, attachments: new Map() })
    this.readFbo = this.initialRead
  }

  private handle(kind: string): Handle { return { id: ++this.serial, kind } }
  private fb(handle: Handle | null): Framebuffer { return this.framebuffers.get(handle)! }
  getExtension = vi.fn(() => ({}))
  getParameter = vi.fn((key: number): any => {
    if (key === this.MAX_DRAW_BUFFERS || key === this.MAX_COLOR_ATTACHMENTS) return 4
    if (key === this.MAX_TEXTURE_IMAGE_UNITS) return 16
    if (key === this.DEPTH_BITS) return 24
    if (key === this.READ_FRAMEBUFFER_BINDING) return this.readFbo
    if (key === this.DRAW_FRAMEBUFFER_BINDING) return this.drawFbo
    if (key === this.READ_BUFFER) return this.fb(this.readFbo).read
    if (key === this.DRAW_BUFFER0) return this.fb(this.drawFbo).draw[0]
    if (key === this.TEXTURE_BINDING_2D) return this.textures.get(this.parameters.get(this.ACTIVE_TEXTURE)) ?? null
    return this.parameters.get(key)
  })
  isEnabled = vi.fn((cap: number) => this.enabled.has(cap))
  enable = vi.fn((cap: number) => { this.enabled.add(cap) })
  disable = vi.fn((cap: number) => { this.enabled.delete(cap) })
  createTexture = vi.fn(() => { const item = this.handle('texture'); this.liveTextures.add(item); return item })
  deleteTexture = vi.fn((item: Handle) => { this.liveTextures.delete(item); for (const [unit, bound] of this.textures) if (bound === item) this.textures.set(unit, null) })
  activeTexture = vi.fn((unit: number) => { this.parameters.set(this.ACTIVE_TEXTURE, unit) })
  bindTexture = vi.fn((_target: number, texture: Handle | null) => { this.textures.set(this.parameters.get(this.ACTIVE_TEXTURE), texture) })
  texStorage2D = vi.fn()
  texParameteri = vi.fn()
  createFramebuffer = vi.fn(() => {
    const item = this.handle('framebuffer'); this.liveFbos.add(item)
    this.framebuffers.set(item, { draw: [this.COLOR_ATTACHMENT0], read: this.COLOR_ATTACHMENT0, attachments: new Map() })
    return item
  })
  deleteFramebuffer = vi.fn((item: Handle) => {
    this.liveFbos.delete(item); this.framebuffers.delete(item)
    if (this.readFbo === item) this.readFbo = null
    if (this.drawFbo === item) this.drawFbo = null
  })
  bindFramebuffer = vi.fn((target: number, item: Handle | null) => {
    if (target === this.FRAMEBUFFER || target === this.READ_FRAMEBUFFER) this.readFbo = item
    if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) this.drawFbo = item
  })
  framebufferTexture2D = vi.fn((_target: number, attachment: number, _kind: number, item: Handle) => { this.fb(this.drawFbo).attachments.set(attachment, item) })
  drawBuffers = vi.fn((buffers: number[]) => { this.fb(this.drawFbo).draw = [...buffers] })
  readBuffer = vi.fn((buffer: number) => { this.fb(this.readFbo).read = buffer })
  checkFramebufferStatus = vi.fn(() => this.FRAMEBUFFER_COMPLETE)
  blitFramebuffer = vi.fn((...args: number[]) => { this.blits.push({ read: this.readFbo, draw: this.drawFbo, args }) })
  getError = vi.fn(() => this.failBlit ? this.INVALID_OPERATION : this.NO_ERROR)
  viewport = vi.fn((...values: number[]) => { this.parameters.set(this.VIEWPORT, values) })
  scissor = vi.fn((...values: number[]) => { this.parameters.set(this.SCISSOR_BOX, values) })
  colorMask = vi.fn((...values: boolean[]) => { this.parameters.set(this.COLOR_WRITEMASK, values) })
  depthMask = vi.fn((value: boolean) => { this.parameters.set(this.DEPTH_WRITEMASK, value) })
  depthFunc = vi.fn((value: number) => { this.parameters.set(this.DEPTH_FUNC, value) })
  cullFace = vi.fn((value: number) => { this.parameters.set(this.CULL_FACE_MODE, value) })
  blendEquation = vi.fn((value: number) => { this.blendEquationSeparate(value, value) })
  blendEquationSeparate = vi.fn((rgb: number, alpha: number) => { this.parameters.set(this.BLEND_EQUATION_RGB, rgb); this.parameters.set(this.BLEND_EQUATION_ALPHA, alpha) })
  blendFunc = vi.fn((src: number, dst: number) => { this.blendFuncSeparate(src, dst, src, dst) })
  blendFuncSeparate = vi.fn((src: number, dst: number, srcAlpha: number, dstAlpha: number) => {
    for (const [key, value] of [[this.BLEND_SRC_RGB, src], [this.BLEND_DST_RGB, dst], [this.BLEND_SRC_ALPHA, srcAlpha], [this.BLEND_DST_ALPHA, dstAlpha]]) this.parameters.set(key, value)
  })
  clearColor = vi.fn((...values: number[]) => { this.parameters.set(this.COLOR_CLEAR_VALUE, values) })
  clearDepth = vi.fn((value: number) => { this.parameters.set(this.DEPTH_CLEAR_VALUE, value) })
  clearBufferfv = vi.fn()
  createProgram = vi.fn(() => { const item = { ...this.handle('program'), attached: [] as Handle[] }; this.livePrograms.add(item); return item })
  deleteProgram = vi.fn((item: Handle) => { this.livePrograms.delete(item) })
  createShader = vi.fn((_kind: number) => { const item = this.handle('shader'); this.liveShaders.add(item); return item })
  deleteShader = vi.fn((item: Handle) => { this.liveShaders.delete(item) })
  shaderSource = vi.fn((shader: Handle, text: string) => { shader.source = text })
  compileShader = vi.fn()
  getShaderParameter = vi.fn(() => true)
  attachShader = vi.fn((program: Handle, shader: Handle) => { program.attached!.push(shader) })
  linkProgram = vi.fn()
  getProgramParameter = vi.fn(() => true)
  getAttachedShaders = vi.fn((program: Handle) => program.attached ?? [])
  getUniformLocation = vi.fn((program: Handle, name: string) => ({ program, name }))
  createVertexArray = vi.fn(() => { const item = this.handle('vao'); this.liveVaos.add(item); return item })
  deleteVertexArray = vi.fn((item: Handle) => { this.liveVaos.delete(item) })
  useProgram = vi.fn((item: Handle) => { this.parameters.set(this.CURRENT_PROGRAM, item) })
  bindVertexArray = vi.fn((item: Handle) => { this.parameters.set(this.VERTEX_ARRAY_BINDING, item) })
  uniformMatrix4fv = vi.fn()
  uniform1i = vi.fn()
  uniform1f = vi.fn()
  uniform2i = vi.fn()
  uniform4fv = vi.fn()
  private draw(kind: 'mesh' | 'resolve') {
    this.draws.push({ kind, fbo: this.drawFbo, buffers: [...this.fb(this.drawFbo).draw],
      program: this.parameters.get(this.CURRENT_PROGRAM), vao: this.parameters.get(this.VERTEX_ARRAY_BINDING),
      depth: this.enabled.has(this.DEPTH_TEST), depthWrite: this.parameters.get(this.DEPTH_WRITEMASK),
      blend: this.enabled.has(this.BLEND), colorWrite: [...this.parameters.get(this.COLOR_WRITEMASK)],
      viewport: [...this.parameters.get(this.VIEWPORT)], scissor: [...this.parameters.get(this.SCISSOR_BOX)],
    })
  }
  drawElements = vi.fn(() => { this.draw('mesh') })
  drawArrays = vi.fn(() => { this.draw('resolve') })

  state() {
    return { read: this.readFbo, draw: this.drawFbo, parameters: [...this.parameters], enabled: [...this.enabled].sort(),
      textures: [...this.textures], defaultBuffers: { draw: [...this.fb(null).draw], read: this.fb(null).read },
      originalReadBuffers: { draw: [...this.fb(this.initialRead).draw], read: this.fb(this.initialRead).read } }
  }
}

function fixture() {
  const gl = new ResourceGL()
  const compile = vi.fn((fragment: string, name: string) => {
    const program = gl.createProgram(); program.name = name
    for (const text of ['source mesh vertex', fragment]) { const shader = gl.createShader(0); gl.shaderSource(shader, text); gl.attachShader(program, shader) }
    const names = ['mvpMtx', 'normMtx', 'opacity', 'matCap', 'neuroimageHasCut', 'neuroimageCutPlane', 'neuroimageNearestDepth', 'neuroimageOpaqueDepth', 'neuroimageDepthEpsilon']
    return { Name: name, Frag: fragment, shader: { program, uniforms: Object.fromEntries(names.map(key => [key, gl.getUniformLocation(program, key)])), use: () => gl.useProgram(program) } }
  })
  const viewer = { gl: gl as unknown as WebGL2RenderingContext, createCustomMeshShader: compile, matCapTexture: { id: -99, kind: 'matcap' } } as unknown as Pick<Niivue, 'gl' | 'createCustomMeshShader' | 'matCapTexture'>
  return { gl, compile, oit: new SurfaceOIT(viewer) }
}

function commands(count = 1): SurfaceOITCommand[] {
  return Array.from({ length: count }, (_, id) => ({ fragment: source, alpha: .95, plane: id === 0 ? [1, 0, 0, -2] : undefined,
    mesh: { id: String(id), visible: true, opacity: .95, indexCount: 3, vao: { id, kind: 'source-vao' },
      get pts() { throw Error('OIT must use the original GPU geometry without a CPU vertex walk') },
    } as unknown as NVMesh }))
}

describe('SurfaceOIT resource ownership and actual manager draw pipeline', () => {
  it('copies opaque depth, draws nearest geometry, accumulates three targets and resolves to the original tile', () => {
    const { gl, compile, oit } = fixture(), before = gl.state(), input = commands(3)
    expect(oit.draw(input, identity, identity)).toBe(true)
    expect(gl.blits).toHaveLength(2)
    expect(gl.blits.every(copy => copy.read === null && JSON.stringify(copy.args) === JSON.stringify([10, 20, 330, 260, 0, 0, 320, 240, gl.DEPTH_BUFFER_BIT, gl.NEAREST]))).toBe(true)
    const nearest = gl.draws.slice(0, 3), accumulation = gl.draws.slice(3, 6), resolve = gl.draws[6]
    expect(nearest.every(draw => draw.fbo === gl.blits[0].draw && draw.depth && draw.depthWrite && !draw.blend && draw.colorWrite.every(value => !value))).toBe(true)
    expect(nearest.every(draw => draw.buffers.length === 1 && draw.buffers[0] === gl.NONE)).toBe(true)
    expect(accumulation.every(draw => !draw.depth && !draw.depthWrite && draw.blend && draw.colorWrite.every(Boolean))).toBe(true)
    expect(accumulation.every(draw => JSON.stringify(draw.buffers) === JSON.stringify([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]))).toBe(true)
    expect(resolve).toMatchObject({ kind: 'resolve', fbo: null, depth: true, depthWrite: false, blend: true, viewport: [10, 20, 320, 240], scissor: [10, 20, 90, 80] })
    expect(gl.uniform1f.mock.calls.some(([location, value]) => location.name === 'opacity' && value === .95)).toBe(true)
    expect(gl.uniform4fv.mock.calls.some(([location, value]) => location.name === 'neuroimageCutPlane' && Array.from(value as ArrayLike<number>).join(',') === '1,0,0,-2')).toBe(true)
    expect(compile).toHaveBeenCalledTimes(2)
    expect(gl.state()).toEqual(before)
  })

  it('reuses all resources and keeps state reads constant across 62-mesh and one-mesh camera frames', () => {
    const { gl, compile, oit } = fixture(), input = commands(62)
    expect(oit.draw(input, identity, identity)).toBe(true)
    expect(gl.createTexture).toHaveBeenCalledTimes(5); expect(gl.createFramebuffer).toHaveBeenCalledTimes(3)
    expect(gl.createProgram).toHaveBeenCalledTimes(3); expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(3)
    const beforeSecond = gl.getParameter.mock.calls.length, rotated = new Float32Array(identity); rotated[0] = -1
    expect(oit.draw([...input].reverse(), rotated, identity)).toBe(true)
    const secondQueries = gl.getParameter.mock.calls.length - beforeSecond
    const beforeThird = gl.getParameter.mock.calls.length
    expect(oit.draw(input.slice(0, 1), identity, identity)).toBe(true)
    expect(gl.getParameter.mock.calls.length - beforeThird).toBe(secondQueries)
    expect(gl.createTexture).toHaveBeenCalledTimes(5); expect(gl.createFramebuffer).toHaveBeenCalledTimes(3)
    expect(gl.createProgram).toHaveBeenCalledTimes(3); expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(3)
    expect(gl.getError).toHaveBeenCalledOnce(); expect(compile).toHaveBeenCalledTimes(2)
    expect(gl.drawElements).toHaveBeenCalledTimes(62 * 2 * 2 + 2)
    expect(gl.drawArrays).toHaveBeenCalledTimes(3)
    oit.dispose()
    expect(gl.liveTextures.size).toBe(0); expect(gl.liveFbos.size).toBe(0); expect(gl.livePrograms.size).toBe(0)
    expect(gl.liveShaders.size).toBe(0); expect(gl.liveVaos.size).toBe(0)
  })

  it('replaces only target storage after a viewport resize and retains compiled programs', () => {
    const { gl, compile, oit } = fixture()
    expect(oit.draw(commands(), identity, identity)).toBe(true)
    gl.viewport(30, 40, 640, 480)
    const beforeResize = gl.state()
    expect(oit.draw(commands(), identity, identity)).toBe(true)
    expect(gl.deleteTexture).toHaveBeenCalledTimes(5); expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3)
    expect(gl.createTexture).toHaveBeenCalledTimes(10); expect(gl.createFramebuffer).toHaveBeenCalledTimes(6)
    expect(gl.liveTextures.size).toBe(5); expect(gl.liveFbos.size).toBe(3)
    expect(gl.createProgram).toHaveBeenCalledTimes(3); expect(compile).toHaveBeenCalledTimes(2)
    expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(6); expect(gl.getError).toHaveBeenCalledTimes(2)
    expect(gl.texStorage2D.mock.calls.slice(-5).every(call => call[3] === 640 && call[4] === 480)).toBe(true)
    expect(gl.state()).toEqual(beforeResize)
  })

  it('restores every touched state and frees partial resources after a geometry draw error', () => {
    const { gl, oit } = fixture(), before = gl.state(), input = commands(2)
    gl.drawElements.mockImplementationOnce(() => { throw Error('GPU geometry failed') })
    expect(oit.draw(input, identity, identity)).toBe(false)
    expect(gl.state()).toEqual(before)
    expect(gl.liveTextures.size).toBe(0); expect(gl.liveFbos.size).toBe(0); expect(gl.livePrograms.size).toBe(0)
    expect(gl.liveShaders.size).toBe(0); expect(gl.liveVaos.size).toBe(0)
    const calls = gl.getParameter.mock.calls.length
    expect(oit.draw(input, identity, identity)).toBe(false)
    expect(gl.getParameter).toHaveBeenCalledTimes(calls)
  })

  it.each(['accumulation', 'resolve'])('restores late-pass state and Matcap textures after %s fails', phase => {
    const { gl, oit } = fixture(), before = gl.state(), input = commands(2)
    input.forEach(command => { command.isMatcap = true })
    if (phase === 'accumulation') {
      let count = 0
      gl.drawElements.mockImplementation(() => { if (++count > input.length) throw Error('Accumulation failed') })
    } else gl.drawArrays.mockImplementationOnce(() => { throw Error('Resolve failed') })
    expect(oit.draw(input, identity, identity)).toBe(false)
    expect(gl.bindTexture.mock.calls.some(([, item]) => item?.kind === 'matcap')).toBe(true)
    expect(gl.state()).toEqual(before)
    expect(gl.liveTextures.size).toBe(0); expect(gl.liveFbos.size).toBe(0); expect(gl.livePrograms.size).toBe(0)
    expect(gl.liveShaders.size).toBe(0); expect(gl.liveVaos.size).toBe(0)
  })

  it('rejects unsupported depth blits once and performs no later GPU work', () => {
    const { gl, oit } = fixture(), before = gl.state()
    gl.failBlit = true
    expect(oit.draw(commands(), identity, identity)).toBe(false)
    expect(gl.blits).toHaveLength(2); expect(gl.drawElements).not.toHaveBeenCalled(); expect(gl.drawArrays).not.toHaveBeenCalled()
    expect(gl.state()).toEqual(before)
    expect(gl.deleteTexture).toHaveBeenCalledTimes(5); expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3)
    const queries = gl.getParameter.mock.calls.length, allocations = gl.createTexture.mock.calls.length
    expect(oit.draw(commands(), identity, identity)).toBe(false)
    expect(gl.getParameter).toHaveBeenCalledTimes(queries); expect(gl.createTexture).toHaveBeenCalledTimes(allocations)
    oit.dispose()
    expect(gl.deleteTexture).toHaveBeenCalledTimes(5); expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3)
  })

  it('leaves an external draw framebuffer untouched without allocating or drawing', () => {
    const { gl, oit } = fixture()
    gl.drawFbo = gl.initialRead
    const before = gl.state()
    expect(oit.draw(commands(), identity, identity)).toBe(false)
    expect(gl.state()).toEqual(before)
    expect(gl.createTexture).not.toHaveBeenCalled(); expect(gl.createFramebuffer).not.toHaveBeenCalled()
    expect(gl.drawElements).not.toHaveBeenCalled(); expect(gl.drawArrays).not.toHaveBeenCalled()
  })
})
