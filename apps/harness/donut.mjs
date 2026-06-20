#!/usr/bin/env node

// Full-screen rotating 3D torus renderer. Emits ~200–250KB of truecolor ANSI
// per animation frame at 60fps, reproducing the heavy-output burst pattern
// observed in localterm microstutter traces (heavy TUI clients, fullscreen
// ANSI animation). Run inside a localterm session and capture a devtools
// timeline trace to study the server → OutputBatcher → xterm → compositor
// pipeline under steady-state load.
//
// Usage: node donut.mjs [--cols N] [--rows N] [--fps N]

const DEFAULT_COLUMNS_COUNT = 120;
const DEFAULT_ROWS_COUNT = 40;
const DEFAULT_FRAMES_PER_SECOND = 60;

const TORUS_TUBE_RADIUS = 1;
const TORUS_CENTER_RADIUS = 2;
const CAMERA_DISTANCE = 5;
const PROJECTION_SCALE = 14;
const ROTATION_DELTA_A_RADIANS = 0.04;
const ROTATION_DELTA_B_RADIANS = 0.02;
const THETA_STEP_RADIANS = 0.07;
const PHI_STEP_RADIANS = 0.02;
const TWO_PI_RADIANS = Math.PI * 2;
const HALF_PI_RADIANS = Math.PI / 2;
const CELL_ASPECT_RATIO_HEIGHT_TO_WIDTH = 0.5;
const LIGHT_VECTOR_Y_COMPONENT = 0.7071;
const LIGHT_VECTOR_Z_COMPONENT = -0.7071;
const FRAME_INDEX_WARMUP_COUNT = 1;

const LUMINANCE_RAMP = ".,-~:;=!*#$@";

const ANSI_HOME_CURSOR = "\x1b[H";
const ANSI_CLEAR_SCREEN = "\x1b[2J";
const ANSI_HIDE_CURSOR = "\x1b[?25l";
const ANSI_SHOW_CURSOR = "\x1b[?25h";
const ANSI_RESET_SGR = "\x1b[0m";
const FG_TRUECOLOR_PREFIX = "\x1b[38;2;";
const BG_TRUECOLOR_PREFIX = "\x1b[48;2;";
const NEWLINE_CHARACTER = "\n";
const BACKGROUND_PLACEHOLDER_CHARACTER = " ".charCodeAt(0);
const COLOR_COMPONENT_COUNT = 3;
const COLOR_BYTE_MAX = 255;
const COLOR_BYTE_HALF = 128;

const parsePositiveIntArg = (flagName, fallbackValue) => {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) return fallbackValue;
  const parsedValue = Number.parseInt(process.argv[flagIndex + 1] ?? "", 10);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallbackValue;
};

const resolveDimensions = () => {
  const columnsCount = parsePositiveIntArg(
    "--cols",
    process.stdout.columns ?? DEFAULT_COLUMNS_COUNT,
  );
  const rowsCount = parsePositiveIntArg(
    "--rows",
    process.stdout.rows ?? DEFAULT_ROWS_COUNT,
  );
  const framesPerSecond = parsePositiveIntArg(
    "--fps",
    DEFAULT_FRAMES_PER_SECOND,
  );
  return { columnsCount, rowsCount, framesPerSecond };
};

const normalizeToColorByte = (signedUnitValue) => {
  const scaled = (signedUnitValue * 0.5 + 0.5) * COLOR_BYTE_MAX;
  const clamped = Math.max(0, Math.min(COLOR_BYTE_MAX, Math.round(scaled)));
  return clamped;
};

// Symmetric 3x3 rotation matrix entries for X-then-Z rotation (X by angleA,
// Z by angleB). Precomputed once per frame, used for every torus surface
// point and surface normal — avoids re-cos/sin inside the inner loop.
const computeRotationMatrix = (angleA, angleB) => {
  const cosA = Math.cos(angleA);
  const sinA = Math.sin(angleA);
  const cosB = Math.cos(angleB);
  const sinB = Math.sin(angleB);
  return {
    m11: cosB,
    m12: -sinB * cosA,
    m13: sinB * sinA,
    m21: sinB,
    m22: cosB * cosA,
    m23: -cosB * sinA,
    m31: 0,
    m32: sinA,
    m33: cosA,
  };
};

const applyRotation = (matrix, pointX, pointY, pointZ) => ({
  x: matrix.m11 * pointX + matrix.m12 * pointY + matrix.m13 * pointZ,
  y: matrix.m21 * pointX + matrix.m22 * pointY + matrix.m23 * pointZ,
  z: matrix.m31 * pointX + matrix.m32 * pointY + matrix.m33 * pointZ,
});

// Ground fog filling every cell the torus misses: a 3-frequency sine plasma
// over row+col+frame so the background has truecolor output every frame,
// matching the heavy-output burst volume in the trace.
const computeBackgroundRgb = (frameIndex, rowIndex, columnIndex) => {
  const timeScalar = frameIndex * 0.1;
  const redUnit =
    Math.sin(timeScalar + rowIndex * 0.15 + columnIndex * 0.08) * 0.5 + 0.5;
  const greenUnit =
    Math.sin(timeScalar * 1.3 + columnIndex * 0.12) * 0.5 + 0.5;
  const blueUnit =
    Math.sin(timeScalar * 0.7 + (rowIndex + columnIndex) * 0.05) * 0.5 + 0.5;
  return [
    normalizeToColorByte(redUnit),
    normalizeToColorByte(greenUnit),
    normalizeToColorByte(blueUnit),
  ];
};

const formatRgbSuffix = (redByte, greenByte, blueByte) =>
  `${redByte};${greenByte};${blueByte}m`;

const renderDonutFrame = (
  charBuffer,
  depthBuffer,
  foregroundRedBuffer,
  foregroundGreenBuffer,
  foregroundBlueBuffer,
  backgroundRedBuffer,
  backgroundGreenBuffer,
  backgroundBlueBuffer,
  columnsCount,
  rowsCount,
  angleA,
  angleB,
  frameIndex,
) => {
  depthBuffer.fill(0);
  const matrix = computeRotationMatrix(angleA, angleB);
  const centerColumn = columnsCount / 2;
  const centerRow = rowsCount / 2;

  for (let theta = 0; theta < TWO_PI_RADIANS; theta += THETA_STEP_RADIANS) {
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const torusCircle = TORUS_CENTER_RADIUS + TORUS_TUBE_RADIUS * cosTheta;
    for (let phi = 0; phi < TWO_PI_RADIANS; phi += PHI_STEP_RADIANS) {
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      // Unrotated torus surface point.
      const pointX = torusCircle * cosPhi;
      const pointY = torusCircle * sinPhi;
      const pointZ = TORUS_TUBE_RADIUS * sinTheta;

      const rotated = applyRotation(matrix, pointX, pointY, pointZ);
      const denominator = CAMERA_DISTANCE + rotated.z;
      if (denominator <= 0.1) continue;
      const projectedColumn = Math.round(
        centerColumn + (PROJECTION_SCALE * rotated.x) / denominator,
      );
      const projectedRow = Math.round(
        centerRow -
          (PROJECTION_SCALE * rotated.y * CELL_ASPECT_RATIO_HEIGHT_TO_WIDTH) /
            denominator,
      );
      if (projectedColumn < 0 || projectedColumn >= columnsCount) continue;
      if (projectedRow < 0 || projectedRow >= rowsCount) continue;

      const cellIndex = projectedRow * columnsCount + projectedColumn;
      const inverseDepth = 1 / denominator;
      if (inverseDepth <= depthBuffer[cellIndex]) continue;
      depthBuffer[cellIndex] = inverseDepth;

      // Surface normal (cosTheta*cosPhi, cosTheta*sinPhi, sinTheta) rotated
      // by the same matrix; luminance = dot(n, light=(0, 0.7071, -0.7071)).
      const normal = applyRotation(
        matrix,
        cosTheta * cosPhi,
        cosTheta * sinPhi,
        sinTheta,
      );
      const luminance =
        LIGHT_VECTOR_Y_COMPONENT * normal.y +
        LIGHT_VECTOR_Z_COMPONENT * normal.z;
      if (luminance < 0) continue;

      const rampIndex = Math.min(
        LUMINANCE_RAMP.length - 1,
        Math.floor(luminance * LUMINANCE_RAMP.length),
      );
      charBuffer[cellIndex] = LUMINANCE_RAMP.charCodeAt(rampIndex);

      const colorByte = normalizeToColorByte(luminance);
      const shadeByte = colorByte >> 1;
      foregroundRedBuffer[cellIndex] = colorByte;
      foregroundGreenBuffer[cellIndex] = shadeByte;
      foregroundBlueBuffer[cellIndex] = COLOR_BYTE_MAX - shadeByte;
      backgroundRedBuffer[cellIndex] = 0;
      backgroundGreenBuffer[cellIndex] = 0;
      backgroundBlueBuffer[cellIndex] = shadeByte;
    }
  }

  // Build the output frame: cursor home, then per-cell truecolor SGR+char,
  // with per-row newlines. Per-cell positioning is omitted (rows are
  // contiguous) to match the row-by-row repaint pattern real TUIs use.
  let output = ANSI_HOME_CURSOR;
  for (let rowIndex = 0; rowIndex < rowsCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnsCount; columnIndex += 1) {
      const cellIndex = rowIndex * columnsCount + columnIndex;
      let redByte = backgroundRedBuffer[cellIndex];
      let greenByte = backgroundGreenBuffer[cellIndex];
      let blueByte = backgroundBlueBuffer[cellIndex];
      let cellChar = BACKGROUND_PLACEHOLDER_CHARACTER;
      if (depthBuffer[cellIndex] > 0) {
        redByte = foregroundRedBuffer[cellIndex];
        greenByte = foregroundGreenBuffer[cellIndex];
        blueByte = foregroundBlueBuffer[cellIndex];
        cellChar = charBuffer[cellIndex];
      } else {
        [redByte, greenByte, blueByte] = computeBackgroundRgb(
          frameIndex,
          rowIndex,
          columnIndex,
        );
      }
      output +=
        BG_TRUECOLOR_PREFIX +
        formatRgbSuffix(redByte, greenByte, blueByte) +
        FG_TRUECOLOR_PREFIX +
        formatRgbSuffix(
          COLOR_BYTE_MAX - redByte,
          COLOR_BYTE_MAX - greenByte,
          COLOR_BYTE_MAX - blueByte,
        ) +
        String.fromCharCode(cellChar);
    }
    output += NEWLINE_CHARACTER;
  }
  return output;
};

const installSignalHandlers = () => {
  // process.exit() returns before stdout drains when stdout is piped, leaving
  // the cursor-restore escapes unflushed and the terminal stuck in hide-cursor.
  // Write synchronously, then exit on the drain callback; if it never fires
  // (broken pipe), the raw exit keeps the process from hanging.
  const cleanupSequence =
    ANSI_SHOW_CURSOR + ANSI_RESET_SGR + ANSI_CLEAR_SCREEN + ANSI_HOME_CURSOR;
  const cleanup = () => {
    process.stdout.write(cleanupSequence, () => process.exit(0));
    setTimeout(() => process.exit(0), 100);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
};

const instantiateFrameBuffers = (columnsCount, rowsCount) => {
  const totalCellCount = columnsCount * rowsCount;
  return {
    charBuffer: new Uint16Array(totalCellCount),
    depthBuffer: new Float32Array(totalCellCount),
    foregroundRedBuffer: new Uint8Array(totalCellCount),
    foregroundGreenBuffer: new Uint8Array(totalCellCount),
    foregroundBlueBuffer: new Uint8Array(totalCellCount),
    backgroundRedBuffer: new Uint8Array(totalCellCount),
    backgroundGreenBuffer: new Uint8Array(totalCellCount),
    backgroundBlueBuffer: new Uint8Array(totalCellCount),
  };
};

const startDonut = () => {
  const { columnsCount, rowsCount, framesPerSecond } = resolveDimensions();
  const frameIntervalMs = 1000 / framesPerSecond;
  const frameBuffers = instantiateFrameBuffers(columnsCount, rowsCount);

  process.stdout.write(ANSI_HIDE_CURSOR);
  installSignalHandlers();

  let angleA = 0;
  let angleB = 0;
  let frameIndex = 0;
  setInterval(() => {
    const output = renderDonutFrame(
      frameBuffers.charBuffer,
      frameBuffers.depthBuffer,
      frameBuffers.foregroundRedBuffer,
      frameBuffers.foregroundGreenBuffer,
      frameBuffers.foregroundBlueBuffer,
      frameBuffers.backgroundRedBuffer,
      frameBuffers.backgroundGreenBuffer,
      frameBuffers.backgroundBlueBuffer,
      columnsCount,
      rowsCount,
      angleA,
      angleB,
      frameIndex,
    );
    process.stdout.write(output);
    angleA += ROTATION_DELTA_A_RADIANS;
    angleB += ROTATION_DELTA_B_RADIANS;
    frameIndex += 1;
  }, frameIntervalMs);
};

if (process.argv[1] && process.argv[1].endsWith("donut.mjs")) {
  startDonut();
}

export {
  renderDonutFrame,
  resolveDimensions,
  instantiateFrameBuffers,
  startDonut,
};
