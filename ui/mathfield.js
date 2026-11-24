// Loaded only when someone writes an equation.
import { MathfieldElement } from 'mathlive';

MathfieldElement.fontsDirectory = '/fonts/math';
MathfieldElement.soundsDirectory = null;

export function create(value) {
  const mf = new MathfieldElement();
  mf.value = value;
  mf.mathVirtualKeyboardPolicy = 'auto';
  mf.smartFence = true;
  mf.smartSuperscript = true;
  return mf;
}
