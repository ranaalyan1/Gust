/**
 * A stand-in for @pmndrs/uikit.
 *
 * IWSDK imports uikit at module scope for its spatial-UI feature, which this
 * project does not use (`features.spatialUI: false` in iwsdk.config.json) and
 * which no file in src/ references. The library is 714 kB minified — 242 kB
 * gzipped, a third of the whole application — plus a 456 kB MSDF font worker,
 * all of it shipped to draw panels that are never drawn.
 *
 * The SDK needs exactly four names from it, and none of them is reachable at
 * run time when spatial UI is off:
 *
 *   Component                  subclassed by the panel document types
 *   StyleSheet                 read when a panel is laid out
 *   reversePainterSortStable   a sort comparator for panel draw order
 *   setPreferredColorScheme    called from the UI system's init
 *
 * So they exist here as empty shapes. If spatial UI is ever switched on, delete
 * this file and the alias in vite.config.ts, and the real library comes back.
 */
export class Component {
  constructor(..._args: unknown[]) {}
}

export interface Style {
  [key: string]: unknown;
}

/** The panel node types @drawcall/uikitml subclasses. Never constructed here. */
export class Container extends Component {}
export class Image extends Component {}
export class Input extends Component {}
export class Svg extends Component {}
export class Textarea extends Component {}
export class Video extends Component {}
export class Text extends Component {}

/** Property schemas: objects, because nothing in this game parses them. */
const emptySchema = { parse: <T,>(v: T): T => v, safeParse: (v: unknown) => ({ success: true, data: v }) };
export const ContainerPropertiesSchema = emptySchema;
export const ImagePropertiesSchema = emptySchema;
export const InputPropertiesSchema = emptySchema;
export const SvgPropertiesSchema = emptySchema;
export const TextareaPropertiesSchema = emptySchema;
export const VideoPropertiesSchema = emptySchema;

/** The MSDF font loader — the reason a 456 kB font worker used to ship. */
export class TTFLoader {
  load(_url: string, onLoad?: (font: unknown) => void): void {
    if (onLoad) onLoad({});
  }
  loadAsync(url: string): Promise<unknown> {
    return Promise.resolve({ url, empty: true });
  }
}

export const StyleSheet = {
  create: <T extends Style>(style: T): T => style,
  flatten: <T extends Style>(style: T): T => style,
  compose: (...styles: Style[]): Style => Object.assign({}, ...styles),
};

/** Theme helpers used by @pmndrs/uikit-horizon when it builds its palettes. */
export const isDarkMode = { value: false, get: () => false, subscribe: () => () => {} };

export function withOpacity(color: string, _opacity: number): string {
  return color;
}

export function reversePainterSortStable(): number {
  return 0;
}

export function setPreferredColorScheme(): void {
  /* no panels, no scheme */
}

export default {
  Component,
  Container,
  Image,
  Input,
  Svg,
  Textarea,
  Video,
  Text,
  TTFLoader,
  StyleSheet,
  isDarkMode,
  withOpacity,
  reversePainterSortStable,
  setPreferredColorScheme,
};

/** Stubbed because spatial UI is off. */
export const componentDefaults: Record<string, unknown> = {};

/** Stubbed because spatial UI is off. */
export function defineSchema(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}

/** Stubbed because spatial UI is off. */
export function baseOutPropertyShape(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}

/** Stubbed because spatial UI is off. */
export function createInPropertiesSchema(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}

/** Stubbed because spatial UI is off. */
export function baseOutPropertiesSchema(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}

/** Stubbed because spatial UI is off. */
export function numberOrPercentageValueSchema(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}

/** Stubbed because spatial UI is off. */
export function numberValueSchema(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}

/** Stubbed because spatial UI is off. */
export function abortableEffect(..._args: unknown[]): any {
  return { parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }), value: undefined };
}
