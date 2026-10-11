/*
  A coloured rim on a body material (figures.js 'figure'): toward the silhouette, where the surface
  turns away from the eye, the lit colour sinks into this colour - a raw orange-red body shading
  off into deep blue-black at its edges. Put on the base material (userData.rim) and carried over
  onto the stainable clone every body part gets (stain.js).
*/
export function rimGLSL(hex, k = 0.9) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return `
    {
      // (toward the silhouette, and wherever the light doesn't reach)
      float rimF = smoothstep(0.12, 0.75, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))));
      float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
      float shF = 1.0 - smoothstep(0.1, 0.5, lum);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}), clamp(max(rimF, shF * 0.85) * ${k.toFixed(2)}, 0.0, 1.0));
    }
    #include <dithering_fragment>`;
}
/** Give a material a rim of its own (and mark it, so its stainable clone keeps it). */
export function withRim(mat, hex, k) {
  mat.userData.rim = [hex, k];
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', rimGLSL(hex, k)); };
  mat.customProgramCacheKey = () => 'rim-' + hex + '-' + k;
  return mat;
}
