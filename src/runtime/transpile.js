import { transform } from 'sucrase';

/** Strip TypeScript types. Sucrase preserves line numbers, so debugger lines still match the editor. */
export function transpileTS(code) {
  return transform(code, {
    transforms: ['typescript'],
    disableESTransforms: true,
  }).code;
}
