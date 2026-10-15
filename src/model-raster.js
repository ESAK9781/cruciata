/* Small orthographic depth rasterizer for cached canvas model sprites.
   Faces and details share a depth buffer: average painter depth is insufficient
   for long roofs, intersecting braces and capital towers. No GPU dependency. */
(() => {
  "use strict";
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  const colors = new Map();
  let depths = new Float32Array(0),
    renders = 0;
  function accelerated() {
    const surface = document.createElement("canvas");
    let gl;
    try {
      gl = surface.getContext("webgl", {
        alpha: true,
        depth: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      return null;
    }
    if (!gl) return null;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      return shader;
    };
    const vs = compile(
      gl.VERTEX_SHADER,
      "attribute vec3 position;attribute vec3 color;varying vec3 tint;void main(){gl_Position=vec4(position,1.0);tint=color;}",
    );
    const fs = compile(
      gl.FRAGMENT_SHADER,
      "precision mediump float;varying vec3 tint;void main(){gl_FragColor=vec4(tint,1.0);}",
    );
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const buffer = gl.createBuffer(),
      position = gl.getAttribLocation(program, "position"),
      color = gl.getAttribLocation(program, "color");
    return (g, commands, left, top, w, h, scale) => {
      if (gl.isContextLost()) return false;
      let near = -Infinity,
        far = Infinity;
      for (const c of commands)
        for (const p of c.vertices) {
          near = Math.max(near, p[2]);
          far = Math.min(far, p[2]);
        }
      const range = Math.max(1, near - far + 2),
        body = [],
        details = [];
      function point(target, p, tint, bias = 0) {
        target.push(
          (((p[0] - left) * scale) / w) * 2 - 1,
          1 - (((p[1] - top) * scale) / h) * 2,
          ((near + far - 2 * (p[2] + bias)) / range) * 0.95,
          tint[0] / 255,
          tint[1] / 255,
          tint[2] / 255,
        );
      }
      function line(a, b, width, tint) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = Math.hypot(dx, dy) || 1,
          r = width / 2;
        const nx = (-dy / length) * r,
          ny = (dx / length) * r,
          ex = (dx / length) * r,
          ey = (dy / length) * r;
        const v = [
          [a[0] - ex + nx, a[1] - ey + ny, a[2]],
          [a[0] - ex - nx, a[1] - ey - ny, a[2]],
          [b[0] + ex - nx, b[1] + ey - ny, b[2]],
          [b[0] + ex + nx, b[1] + ey + ny, b[2]],
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) point(details, v[i], tint, 0.35);
      }
      for (const c of commands) {
        const v = c.vertices;
        if (c.width) {
          const tint = rgb(c.color);
          for (let i = 1; i < v.length; i++)
            line(v[i - 1], v[i], c.width, tint);
        } else {
          const tint = rgb(c.color);
          for (let i = 1; i < v.length - 1; i++)
            for (const p of [v[0], v[i], v[i + 1]]) point(body, p, tint);
          if (c.outline || c.stroke) {
            const edge = rgb(c.stroke || "#3d4033");
            for (let i = 0; i < v.length; i++)
              line(v[i], v[(i + 1) % v.length], c.outlineWidth || 0.65, edge);
          }
        }
      }
      if (surface.width !== w) surface.width = w;
      if (surface.height !== h) surface.height = h;
      gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.enableVertexAttribArray(color);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
      for (const vertices of [body, details]) {
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array(vertices),
          gl.STREAM_DRAW,
        );
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
      }
      g.drawImage(surface, left, top, w / scale, h / scale);
      return true;
    };
  }
  const gpuPaint = accelerated();
  let backend = gpuPaint ? "webgl" : "software";
  function rgb(color) {
    if (colors.has(color)) return colors.get(color);
    const n = parseInt(color.slice(1, 7), 16),
      v = [n >> 16, (n >> 8) & 255, n & 255];
    colors.set(color, v);
    return v;
  }
  function paint(g, commands) {
    if (!commands.length) return;
    renders++;
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const c of commands)
      for (const p of c.vertices) {
        left = Math.min(left, p[0] - 3);
        right = Math.max(right, p[0] + 3);
        top = Math.min(top, p[1] - 3);
        bottom = Math.max(bottom, p[1] + 3);
      }
    left = Math.floor(left);
    top = Math.floor(top);
    const transform = g.getTransform(),
      scale = Math.max(2, Math.min(3, Math.hypot(transform.a, transform.b)));
    const w = Math.ceil((right - left) * scale),
      h = Math.ceil((bottom - top) * scale),
      size = w * h;
    if (!size || size > 12000000) return;
    if (gpuPaint && gpuPaint(g, commands, left, top, w, h, scale)) return;
    backend = "software";
    canvas.width = w;
    canvas.height = h;
    if (depths.length < size) depths = new Float32Array(size);
    depths.fill(-Infinity, 0, size);
    const data = ctx.createImageData(w, h),
      pixels = data.data;
    const vertex = (p) => [(p[0] - left) * scale, (p[1] - top) * scale, p[2]];
    function put(x, y, z, color) {
      const i = y * w + x;
      if (z < depths[i] - 0.001) return;
      depths[i] = z;
      const k = i * 4;
      pixels[k] = color[0];
      pixels[k + 1] = color[1];
      pixels[k + 2] = color[2];
      pixels[k + 3] = 255;
    }
    function triangle(a, b, c, color) {
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(den) < 0.0001) return;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
        maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
        maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const u =
            ((b[1] - c[1]) * (x + 0.5 - c[0]) +
              (c[0] - b[0]) * (y + 0.5 - c[1])) /
            den;
          const v =
            ((c[1] - a[1]) * (x + 0.5 - c[0]) +
              (a[0] - c[0]) * (y + 0.5 - c[1])) /
            den;
          const t = 1 - u - v;
          if (u < -0.00001 || v < -0.00001 || t < -0.00001) continue;
          put(x, y, u * a[2] + v * b[2] + t * c[2], color);
        }
    }
    function line(a, b, width, color, bias = 0.35) {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        len = dx * dx + dy * dy,
        r = (width * scale) / 2;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)),
        maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)),
        maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const t = len
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / len,
                ),
              )
            : 0;
          if (
            (x + 0.5 - a[0] - t * dx) ** 2 + (y + 0.5 - a[1] - t * dy) ** 2 <=
            r * r
          )
            put(x, y, a[2] + t * (b[2] - a[2]) + bias, color);
        }
    }
    for (const c of commands)
      if (!c.width) {
        const v = c.vertices.map(vertex),
          color = rgb(c.color);
        for (let i = 1; i < v.length - 1; i++)
          triangle(v[0], v[i], v[i + 1], color);
      }
    for (const c of commands) {
      const v = c.vertices.map(vertex);
      if (c.width) {
        for (let i = 1; i < v.length; i++)
          line(v[i - 1], v[i], c.width, rgb(c.color));
      } else if (c.outline || c.stroke) {
        for (let i = 0; i < v.length; i++)
          line(
            v[i],
            v[(i + 1) % v.length],
            c.outlineWidth || 0.65,
            rgb(c.stroke || "#3d4033"),
          );
      }
    }
    ctx.putImageData(data, 0, 0);
    g.drawImage(canvas, left, top, w / scale, h / scale);
  }
  window.CruciataModelRaster = {
    paint,
    stats: () => ({ renders, scratchPixels: depths.length, backend }),
  };
})();
