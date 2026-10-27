#!/usr/bin/env python3
"""Exercise the shipped OIT GLSL with fixed triangles in software EGL/GLES.

This is a source-level shader unit test. It does not launch a browser, load a
website, access a live page, or claim to measure interactive browser FPS.
"""
from __future__ import annotations

import ctypes as c
import itertools
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
os.environ["LIBGL_ALWAYS_SOFTWARE"] = "1"
os.environ["EGL_PLATFORM"] = "surfaceless"
os.environ["__EGL_VENDOR_LIBRARY_FILENAMES"] = "/usr/share/glvnd/egl_vendor.d/50_mesa.json"

P, I, U, F = c.c_void_p, c.c_int, c.c_uint, c.c_float
NONE = 0
TEXTURE_2D, TEXTURE0 = 0x0DE1, 0x84C0
FRAMEBUFFER, READ_FRAMEBUFFER, DRAW_FRAMEBUFFER = 0x8D40, 0x8CA8, 0x8CA9
COLOR_ATTACHMENT0, DEPTH_ATTACHMENT = 0x8CE0, 0x8D00
RGBA, RGBA16F, HALF_FLOAT = 0x1908, 0x881A, 0x140B
DEPTH_COMPONENT, DEPTH_COMPONENT24, UNSIGNED_INT = 0x1902, 0x81A6, 0x1405
COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT = 0x4000, 0x0100
DEPTH_TEST, CULL_FACE, BLEND, SCISSOR_TEST = 0x0B71, 0x0B44, 0x0BE2, 0x0C11
LEQUAL, BACK, FRONT = 0x0203, 0x0405, 0x0404
FUNC_ADD, ONE, ONE_MINUS_SRC_ALPHA = 0x8006, 1, 0x0303
VERTEX_SHADER, FRAGMENT_SHADER = 0x8B31, 0x8B30
WIDTH = HEIGHT = 8


def ints(*items):
    return (I * len(items))(*items)


class SoftwareGL:
    def __init__(self, samples=0):
        self.egl = c.CDLL("libEGL.so.1")
        self.gl = c.CDLL("libGLESv2.so.2")
        for name, ret, args in [
            ("eglGetDisplay", P, [P]), ("eglInitialize", U, [P, c.POINTER(I), c.POINTER(I)]),
            ("eglChooseConfig", U, [P, c.POINTER(I), c.POINTER(P), I, c.POINTER(I)]),
            ("eglBindAPI", U, [U]), ("eglCreatePbufferSurface", P, [P, P, c.POINTER(I)]),
            ("eglCreateContext", P, [P, P, P, c.POINTER(I)]), ("eglMakeCurrent", U, [P, P, P, P]),
        ]:
            fn = getattr(self.egl, name); fn.restype = ret; fn.argtypes = args
        self.display = self.egl.eglGetDisplay(None)
        major, minor = I(), I()
        assert self.egl.eglInitialize(self.display, c.byref(major), c.byref(minor)), "Software EGL unavailable"
        config, count = P(), I()
        attrs = ints(0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3022, 8,
                     0x3021, 8, 0x3025, 24, 0x3032, int(samples > 0), 0x3031, samples, 0x3038)
        assert self.egl.eglChooseConfig(self.display, attrs, c.byref(config), 1, c.byref(count)) and count.value
        assert self.egl.eglBindAPI(0x30A0)
        self.surface = self.egl.eglCreatePbufferSurface(self.display, config, ints(0x3057, WIDTH * 2, 0x3056, HEIGHT * 2, 0x3038))
        self.context = self.egl.eglCreateContext(self.display, config, None, ints(0x3098, 3, 0x3038))
        assert self.surface and self.context
        assert self.egl.eglMakeCurrent(self.display, self.surface, self.surface, self.context)
        signatures = {
            "glGetString": (c.c_char_p, [U]), "glGetError": (U, []), "glGetIntegerv": (None, [U, c.POINTER(I)]),
            "glCreateShader": (U, [U]), "glShaderSource": (None, [U, I, c.POINTER(c.c_char_p), c.POINTER(I)]),
            "glCompileShader": (None, [U]), "glGetShaderiv": (None, [U, U, c.POINTER(I)]),
            "glGetShaderInfoLog": (None, [U, I, c.POINTER(I), c.c_char_p]),
            "glCreateProgram": (U, []), "glAttachShader": (None, [U, U]), "glLinkProgram": (None, [U]),
            "glGetProgramiv": (None, [U, U, c.POINTER(I)]), "glGetProgramInfoLog": (None, [U, I, c.POINTER(I), c.c_char_p]),
            "glUseProgram": (None, [U]), "glGetUniformLocation": (I, [U, c.c_char_p]),
            "glUniform1f": (None, [I, F]), "glUniform1i": (None, [I, I]),
            "glUniform2f": (None, [I, F, F]), "glUniform2i": (None, [I, I, I]), "glUniform4f": (None, [I, F, F, F, F]),
            "glGenTextures": (None, [I, c.POINTER(U)]), "glBindTexture": (None, [U, U]),
            "glTexImage2D": (None, [U, I, I, I, I, I, U, U, P]), "glTexParameteri": (None, [U, U, I]),
            "glActiveTexture": (None, [U]), "glGenFramebuffers": (None, [I, c.POINTER(U)]),
            "glBindFramebuffer": (None, [U, U]), "glFramebufferTexture2D": (None, [U, U, U, U, I]),
            "glDrawBuffers": (None, [I, c.POINTER(U)]), "glReadBuffer": (None, [U]),
            "glCheckFramebufferStatus": (U, [U]), "glBlitFramebuffer": (None, [I, I, I, I, I, I, I, I, U, U]),
            "glViewport": (None, [I, I, I, I]), "glEnable": (None, [U]), "glDisable": (None, [U]),
            "glDepthFunc": (None, [U]), "glDepthMask": (None, [U]), "glCullFace": (None, [U]),
            "glBlendFuncSeparate": (None, [U, U, U, U]), "glBlendEquation": (None, [U]),
            "glClearColor": (None, [F, F, F, F]), "glClearDepthf": (None, [F]), "glClear": (None, [U]),
            "glClearBufferfv": (None, [U, I, c.POINTER(F)]), "glColorMask": (None, [U, U, U, U]),
            "glGenVertexArrays": (None, [I, c.POINTER(U)]), "glBindVertexArray": (None, [U]),
            "glDrawArrays": (None, [U, I, I]), "glReadPixels": (None, [I, I, I, I, U, U, P]),
        }
        for name, (ret, args) in signatures.items():
            fn = getattr(self.gl, name); fn.restype = ret; fn.argtypes = args; setattr(self, name, fn)
        self.renderer = self.glGetString(0x1F01).decode()
        assert "llvmpipe" in self.renderer.lower() or "softpipe" in self.renderer.lower(), self.renderer
        assert b"GL_EXT_color_buffer_float" in self.glGetString(0x1F03)
        actual_samples = I(); self.glGetIntegerv(0x80A9, c.byref(actual_samples))
        self.samples = actual_samples.value
        self.vao = U(); self.glGenVertexArrays(1, c.byref(self.vao)); self.glBindVertexArray(self.vao)

    def assert_clean(self, where):
        error = self.glGetError()
        assert error == 0, f"GL error {error:#x} at {where}"

    def program(self, vertex, fragment):
        compiled = []
        for kind, source in [(VERTEX_SHADER, vertex), (FRAGMENT_SHADER, fragment)]:
            shader = self.glCreateShader(kind); encoded = source.encode(); data = c.c_char_p(encoded)
            self.glShaderSource(shader, 1, c.byref(data), None); self.glCompileShader(shader)
            ok = I(); self.glGetShaderiv(shader, 0x8B81, c.byref(ok))
            if not ok.value:
                log = c.create_string_buffer(16000); self.glGetShaderInfoLog(shader, len(log), None, log)
                raise AssertionError(log.value.decode() + "\n" + source)
            compiled.append(shader)
        program = self.glCreateProgram()
        for shader in compiled: self.glAttachShader(program, shader)
        self.glLinkProgram(program); ok = I(); self.glGetProgramiv(program, 0x8B82, c.byref(ok))
        if not ok.value:
            log = c.create_string_buffer(16000); self.glGetProgramInfoLog(program, len(log), None, log)
            raise AssertionError(log.value.decode())
        return program

    def loc(self, program, name):
        return self.glGetUniformLocation(program, name.encode())

    def f(self, program, name, value):
        location = self.loc(program, name)
        if location >= 0: self.glUniform1f(location, value)

    def i(self, program, name, value):
        location = self.loc(program, name)
        if location >= 0: self.glUniform1i(location, value)

    def v4(self, program, name, value):
        location = self.loc(program, name)
        if location >= 0: self.glUniform4f(location, *value)

    def texture(self, depth=False):
        texture = U(); self.glGenTextures(1, c.byref(texture)); self.glBindTexture(TEXTURE_2D, texture.value)
        for key in (0x2801, 0x2800): self.glTexParameteri(TEXTURE_2D, key, 0x2600)
        for key in (0x2802, 0x2803): self.glTexParameteri(TEXTURE_2D, key, 0x812F)
        self.glTexImage2D(TEXTURE_2D, 0, DEPTH_COMPONENT24 if depth else RGBA16F,
                          WIDTH, HEIGHT, 0, DEPTH_COMPONENT if depth else RGBA,
                          UNSIGNED_INT if depth else HALF_FLOAT, None)
        return texture.value

    def framebuffer(self, colors=(), depth=0):
        fb = U(); self.glGenFramebuffers(1, c.byref(fb)); self.glBindFramebuffer(FRAMEBUFFER, fb.value)
        for index, texture in enumerate(colors):
            self.glFramebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0 + index, TEXTURE_2D, texture, 0)
        if depth: self.glFramebufferTexture2D(FRAMEBUFFER, DEPTH_ATTACHMENT, TEXTURE_2D, depth, 0)
        targets = (U * max(1, len(colors)))(*([COLOR_ATTACHMENT0 + i for i in range(len(colors))] or [NONE]))
        self.glDrawBuffers(len(targets), targets); self.glReadBuffer(COLOR_ATTACHMENT0 if colors else NONE)
        assert self.glCheckFramebufferStatus(FRAMEBUFFER) == 0x8CD5
        return fb.value

    def bind_texture(self, unit, texture):
        self.glActiveTexture(TEXTURE0 + unit); self.glBindTexture(TEXTURE_2D, texture)


VERTEX = """#version 300 es
precision highp float;
uniform float uDepth;
uniform vec4 uColor;
out vec4 vP;
out vec4 vClr;
out vec3 vN;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  gl_Position = vec4(p, uDepth, 1.0);
  vP = gl_Position; vClr = uColor; vN = vec3(0.0, 0.0, 1.0);
}
"""
SOURCE_FRAGMENT = """#version 300 es
precision highp float;
uniform float opacity;
in vec4 vP;
in vec4 vClr;
out vec4 color;
void main() { color = vec4(vClr.rgb, opacity); }
"""


def sources():
    code = """
      import * as oit from './web/src/surfaceOIT.ts';
      import {readFileSync} from 'node:fs';
      import {stripTypeScriptTypes} from 'node:module';
      const nativeModule = stripTypeScriptTypes(readFileSync('./node_modules/@niivue/niivue/src/shader-srcs.ts','utf8'), {mode:'transform'});
      const native = await import('data:text/javascript;base64,' + Buffer.from(nativeModule).toString('base64'));
      const source = process.argv[1];
      process.stdout.write(JSON.stringify({depth:oit.OIT_DEPTH_FRAGMENT,
        resolveVertex:oit.OIT_RESOLVE_VERTEX, resolve:oit.OIT_RESOLVE_FRAGMENT,
        accumulation:oit.oitAccumulationFragment(source), nativeVertex:native.vertMeshShader,
        nativePhong:native.fragMeshShader,
        nativeAccumulation:oit.oitAccumulationFragment(native.fragMeshShader)}));
    """
    node = "/home/server/.nvm/versions/node/v24.21.0/bin/node"
    return json.loads(subprocess.check_output([node, "--experimental-transform-types", "--input-type=module", "-e", code, SOURCE_FRAGMENT], cwd=ROOT, text=True))


class ShaderPipeline:
    def __init__(self, gl, shader_sources):
        self.g = gl
        self.depth = gl.program(VERTEX, shader_sources["depth"])
        self.accumulation = gl.program(VERTEX, shader_sources["accumulation"])
        self.resolve = gl.program(shader_sources["resolveVertex"], shader_sources["resolve"])
        self.opaque_shader = gl.program(VERTEX, SOURCE_FRAGMENT)
        self.nearest, self.opaque = gl.texture(True), gl.texture(True)
        self.front, self.behind, self.layers = gl.texture(), gl.texture(), gl.texture()
        self.nearest_fb = gl.framebuffer(depth=self.nearest)
        self.opaque_fb = gl.framebuffer(depth=self.opaque)
        self.accumulation_fb = gl.framebuffer((self.front, self.behind, self.layers))
        gl.assert_clean("shader and target creation")

    def draw_triangle(self, program, triangle, plane):
        z, color, alpha = triangle
        g = self.g
        g.f(program, "uDepth", z); g.v4(program, "uColor", [*color, 1])
        g.f(program, "opacity", alpha)
        g.i(program, "neuroimageHasCut", int(plane is not None))
        if plane is not None: g.v4(program, "neuroimageCutPlane", plane)
        g.glDrawArrays(4, 0, 3)

    def render(self, triangles, opaque_depth=1, background=(.1, .2, .3), plane=None, origin=(0, 0)):
        g = self.g
        x, y = origin
        g.glBindFramebuffer(FRAMEBUFFER, 0); g.glViewport(x, y, WIDTH, HEIGHT)
        g.glDisable(SCISSOR_TEST); g.glDisable(BLEND); g.glEnable(DEPTH_TEST)
        g.glDepthMask(True); g.glColorMask(True, True, True, True)
        g.glClearColor(*background, 1); g.glClearDepthf(1); g.glClear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)
        if opaque_depth < 1:
            g.glDepthFunc(LEQUAL); g.glEnable(CULL_FACE); g.glCullFace(BACK)
            g.glUseProgram(self.opaque_shader)
            self.draw_triangle(self.opaque_shader, (2 * opaque_depth - 1, background, 1), None)
        g.glBindFramebuffer(READ_FRAMEBUFFER, 0)
        for framebuffer in [self.nearest_fb, self.opaque_fb]:
            g.glBindFramebuffer(DRAW_FRAMEBUFFER, framebuffer)
            g.glBlitFramebuffer(x, y, x + WIDTH, y + HEIGHT, 0, 0, WIDTH, HEIGHT, DEPTH_BUFFER_BIT, 0x2600)
        g.assert_clean("copy default opaque depth")
        g.glBindFramebuffer(FRAMEBUFFER, self.nearest_fb)
        g.glViewport(0, 0, WIDTH, HEIGHT)
        g.glEnable(CULL_FACE); g.glCullFace(BACK); g.glEnable(DEPTH_TEST); g.glDepthFunc(LEQUAL)
        g.glDepthMask(True); g.glDisable(BLEND); g.glUseProgram(self.depth)
        for triangle in triangles:
            if triangle[2] > 0: self.draw_triangle(self.depth, triangle, plane)
        g.assert_clean("nearest-depth pass")
        g.glBindFramebuffer(FRAMEBUFFER, self.accumulation_fb)
        g.glColorMask(True, True, True, True); g.glDisable(DEPTH_TEST); g.glDepthMask(False)
        zero = (F * 4)(0, 0, 0, 0)
        for index in range(3): g.glClearBufferfv(0x1800, index, zero)
        g.glEnable(BLEND); g.glBlendEquation(FUNC_ADD); g.glBlendFuncSeparate(ONE, ONE, ONE, ONE)
        g.glUseProgram(self.accumulation)
        g.bind_texture(12, self.nearest); g.bind_texture(13, self.opaque)
        g.i(self.accumulation, "neuroimageNearestDepth", 12); g.i(self.accumulation, "neuroimageOpaqueDepth", 13)
        g.f(self.accumulation, "neuroimageDepthEpsilon", 2 / 16777215)
        for triangle in triangles:
            if triangle[2] > 0: self.draw_triangle(self.accumulation, triangle, plane)
        g.assert_clean("float MRT accumulation")
        g.glBindFramebuffer(FRAMEBUFFER, 0); g.glViewport(x, y, WIDTH, HEIGHT)
        g.glEnable(DEPTH_TEST); g.glDepthFunc(LEQUAL); g.glDepthMask(False); g.glDisable(CULL_FACE)
        g.glEnable(BLEND); g.glBlendEquation(FUNC_ADD); g.glBlendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)
        g.glUseProgram(self.resolve)
        for unit, texture, name in [(12, self.nearest, "neuroimageNearestDepth"), (13, self.front, "neuroimageFront"),
                                    (14, self.behind, "neuroimageBehind"), (15, self.layers, "neuroimageLayers")]:
            g.bind_texture(unit, texture); g.i(self.resolve, name, unit)
        location = g.loc(self.resolve, "neuroimageViewportOrigin")
        if location >= 0: g.glUniform2i(location, x, y)
        g.glDrawArrays(4, 0, 3)
        pixel = (c.c_ubyte * 4)()
        g.glReadPixels(x + 4, y + 4, 1, 1, RGBA, 0x1401, pixel)
        g.assert_clean("resolve/readback")
        return [item / 255 for item in pixel]


def close(actual, expected, tolerance=2 / 255):
    assert len(actual) == len(expected)
    assert max(abs(a - b) for a, b in zip(actual, expected)) <= tolerance, (actual, expected)


def main():
    gl = SoftwareGL(); shader_sources = sources(); pipeline = ShaderPipeline(gl, shader_sources); cases = {}
    native_programs = [
        gl.program(shader_sources["nativeVertex"], shader_sources["nativePhong"]),
        gl.program(shader_sources["nativeVertex"], shader_sources["nativeAccumulation"]),
        gl.program(shader_sources["nativeVertex"], shader_sources["depth"]),
    ]
    assert all(native_programs)
    gl.assert_clean("pinned native Phong and OIT material compile/link")
    cases["native_phong_shader_compile_link"] = {"reference": "passed", "OIT_accumulation": "passed", "OIT_depth": "passed",
        "source": "pinned Niivue vertMeshShader and fragMeshShader exports"}
    red, blue, green = [1, 0, 0], [0, 0, 1], [0, 1, 0]
    for alpha in [.95, .99, 1]:
        triangles = [(-.5, red, alpha), (.4, blue, alpha)]
        forward = pipeline.render(triangles); reverse = pipeline.render(list(reversed(triangles)))
        close(forward, reverse, 1 / 255)
        # The exact nearest layer dominates continuously as alpha approaches1.
        expected = [alpha + .1 * (1 - alpha) ** 2, .2 * (1 - alpha) ** 2,
                    alpha * (1 - alpha) + .3 * (1 - alpha) ** 2, 1]
        close(forward, expected)
        cases[f"nearest_alpha_{alpha}"] = forward
    # Non-binary depth coordinates expose accidental lowp sampler precision:
    # the true nearest fragment must not be mistaken for a deeper fragment.
    varied_depths = {}
    for depth in [-.9, -.74, -.3, .13, .3, .73]:
        pixel = pipeline.render([(depth, blue, .5)])
        close(pixel, [.05, .1, .65, 1])
        varied_depths[str(depth)] = pixel
    cases["nearest_nonbinary_depths"] = varied_depths
    triangles = [(-.5, red, .5), (0, green, .35), (.5, blue, .55)]
    permutations = [pipeline.render(list(order)) for order in itertools.permutations(triangles)]
    for value in permutations: close(value, permutations[0], 1 / 255)
    cases["six_triangle_orders"] = permutations[0]
    shifted = pipeline.render(triangles, origin=(3, 2))
    close(shifted, permutations[0], 1 / 255); cases["nonzero_viewport_origin"] = shifted
    blocked = pipeline.render([(-.5, red, .5), (.5, green, .9)], opaque_depth=.5, background=blue)
    close(blocked, [.5, 0, .5, 1]); cases["opaque_depth_blocks_green"] = blocked
    empty = pipeline.render([(-.5, red, 0), (.5, blue, 0)])
    close(empty, [.1, .2, .3, 1]); cases["opacity_zero"] = empty
    clipped = pipeline.render([(-.5, red, .9), (.3, blue, .5)], plane=[0, 0, -1, -.2])
    close(clipped, [.05, .1, .65, 1]); cases["clipped_nearest_removed"] = clipped
    # Browser default framebuffers may be multisampled. Resolve their depth
    # into the single-sample OIT targets without reading pixels back to CPU.
    multisample_gl = SoftwareGL(samples=4)
    assert multisample_gl.samples == 4
    multisample_pipeline = ShaderPipeline(multisample_gl, sources())
    multisample = multisample_pipeline.render([(-.5, red, .95), (.4, blue, .95)])
    close(multisample, cases["nearest_alpha_0.95"], 1 / 255)
    blocked_multisample = multisample_pipeline.render([(-.5, red, .5), (.5, green, .9)], opaque_depth=.5, background=blue)
    close(blocked_multisample, [.5, 0, .5, 1])
    cases["multisample_depth_resolve"] = {"samples": multisample_gl.samples,
        "opaque_depth_source": "opaque triangle drawn at window depth0.5 in the default framebuffer",
        "nearest_alpha_0.95": multisample, "opaque_depth_blocks_green": blocked_multisample}
    result = {"status": "passed", "renderer": gl.renderer, "api": gl.glGetString(0x1F02).decode(),
              "test_kind": "standalone source GLSL software EGL raster unit test; no browser or live webpage",
              "shader_source": "exports from web/src/surfaceOIT.ts", "tolerance": "2/255 channel value; order1/255",
              "cases": cases}
    output = ROOT / ".internal/surface-opacity-stability-2026-10-25/software-gl-verification.json"
    output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
