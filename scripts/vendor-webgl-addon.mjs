#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ADDON_FILE_PATH = resolve(
  "apps/terminal/node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs",
);
const VENDOR_OUTPUT_PATH = resolve("apps/terminal/vendor/xterm-addon-webgl.mjs");

const RESOLVE_FG_COLOR_FUNCTION =
  "function resolveFgColor(fg,bg,theme){let useBg=fg&67108864,colAttr=useBg?bg:fg,cm=colAttr&50331648,rgb;if(cm===50331648)rgb=colAttr&16777215;else if(cm===16777216||cm===33554432){let c=theme.colors.ansi[colAttr&255];rgb=c?(c.rgba>>8)&16777215:0}else rgb=((useBg?theme.colors.background.rgba:theme.colors.foreground.rgba)>>8)&16777215;return rgb}";

const VENDOR_TRANSFORMS = [
  {
    name: "module-level c variable",
    from: "var N=0,S,Ie=0,k0=0,re=class extends W{",
    to: "var N=0,S,Ie=0,k0=0,c=0,re=class extends W{",
  },
  {
    name: "clipped glyph color attributes",
    from: ",t[N+8]=S.sizeClipSpace.y):(",
    to: ",t[N+8]=S.sizeClipSpace.y,c=resolveFgColor(n,o,this._terminal._core._themeService),t[N+9]=((c>>>16)&255)/255,t[N+10]=((c>>>8)&255)/255,t[N+11]=(c&255)/255):(",
  },
  {
    name: "unclipped glyph color attributes",
    from: ",t[N+8]=S.sizeClipSpace.y,t[N+9]=((n>>>24)&255)/255,t[N+10]=((n>>>16)&255)/255,t[N+11]=((n>>>8)&255)/255",
    to: ",t[N+8]=S.sizeClipSpace.y,c=resolveFgColor(n,o,this._terminal._core._themeService),t[N+9]=((c>>>16)&255)/255,t[N+10]=((c>>>8)&255)/255,t[N+11]=(c&255)/255",
  },
  {
    name: "resolveFgColor helper",
    from: "setDimensions(t){this._dimensions=t}};var Fe=class{",
    to: `setDimensions(t){this._dimensions=t}};${RESOLVE_FG_COLOR_FUNCTION};var Fe=class{`,
  },
  {
    name: "glyph fragment shader luma alpha",
    from: "outColor = vec4(v_color, texel.a);",
    to: "outColor = vec4(v_color, dot(texel.rgb, vec3(0.299, 0.587, 0.114)));",
  },
  {
    name: "custom glyph background opaque black",
    from: 'K={css:"#00000000",rgba:0},',
    to: 'K={css:"#000000ff",rgba:255},',
  },
];

async function applyVendorTransforms() {
  let addonSource = await readFile(ADDON_FILE_PATH, "utf8");

  for (const transform of VENDOR_TRANSFORMS) {
    const occurrences = addonSource.split(transform.from).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Expected exactly one "${transform.name}" pattern, found ${occurrences}`);
    }
    addonSource = addonSource.replace(transform.from, transform.to);
  }

  const sourceWithoutMap = addonSource.replace(/\/\/[#]\s*sourceMappingURL=[^\n]+\n?/, "");
  await mkdir(dirname(VENDOR_OUTPUT_PATH), { recursive: true });
  await writeFile(VENDOR_OUTPUT_PATH, sourceWithoutMap);
  console.log(`Vendored ${ADDON_FILE_PATH} -> ${VENDOR_OUTPUT_PATH}`);
}

applyVendorTransforms().catch((error) => {
  console.error(error);
  process.exit(1);
});
