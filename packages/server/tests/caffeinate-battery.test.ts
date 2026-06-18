import { describe, expect, it } from "vite-plus/test";
import { clampBatteryPercent, parsePmsetBatt } from "../src/caffeinate-battery.js";
import {
  CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT,
} from "../src/constants.js";

describe("parsePmsetBatt", () => {
  it("parses a discharging battery with a time estimate", () => {
    const stdout = [
      "Now drawing from 'Battery Power'",
      " -InternalBattery-0 (id=25624675)\t90%; discharging; 4:27 remaining present: true",
      "",
    ].join("\n");
    expect(parsePmsetBatt(stdout)).toEqual({
      percent: 90,
      isOnBattery: true,
      // 4h27m -> 267 minutes.
      minutesToEmpty: 267,
    });
  });

  it("treats AC power as not-on-battery and drops the time estimate", () => {
    // The "X:YY remaining" on AC is time to full charge, not to empty, so it
    // must not feed the adaptive scheduler.
    const stdout = [
      "Now drawing from 'AC Power'",
      " -InternalBattery-0 (id=1)\t80%; charging; 0:42 remaining present: true",
      "",
    ].join("\n");
    expect(parsePmsetBatt(stdout)).toEqual({
      percent: 80,
      isOnBattery: false,
      minutesToEmpty: null,
    });
  });

  it("parses a discharging battery with no estimate as null minutes", () => {
    const stdout = [
      "Now drawing from 'Battery Power'",
      " -InternalBattery-0 (id=1)\t90%; discharging; (no estimate) present: true",
      "",
    ].join("\n");
    expect(parsePmsetBatt(stdout)).toEqual({
      percent: 90,
      isOnBattery: true,
      minutesToEmpty: null,
    });
  });

  it("returns null when the battery is not present", () => {
    // The "No Batteries Available" desktop case.
    const stdout = "No Batteries Available\n";
    expect(parsePmsetBatt(stdout)).toBeNull();
  });

  it("returns null when `present: false`", () => {
    const stdout = [
      "Now drawing from 'AC Power'",
      " -No Batteries Available-\t0%; no estimate; 0:00 remaining present: false",
      "",
    ].join("\n");
    expect(parsePmsetBatt(stdout)).toBeNull();
  });

  it("returns null when no percent appears in the output", () => {
    expect(parsePmsetBatt("Now drawing from 'AC Power'\n")).toBeNull();
  });
});

describe("clampBatteryPercent", () => {
  it("clamps to the configured min and max", () => {
    expect(clampBatteryPercent(1)).toBe(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT);
    expect(clampBatteryPercent(75)).toBe(CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT);
  });

  it("floors fractional input", () => {
    expect(clampBatteryPercent(20.9)).toBe(20);
  });

  it("falls back to the minimum for non-finite input", () => {
    expect(clampBatteryPercent(Number.NaN)).toBe(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT);
  });

  it("passes through in-range integers", () => {
    expect(clampBatteryPercent(20)).toBe(20);
  });
});
