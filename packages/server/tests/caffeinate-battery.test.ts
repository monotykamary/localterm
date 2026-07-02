import { describe, expect, it } from "vite-plus/test";
import {
  clampBatteryPercent,
  parsePmsetBatt,
  parseSysfsBattery,
} from "../src/caffeinate-battery.js";
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

describe("parseSysfsBattery", () => {
  it("parses a discharging battery with a time-to-empty estimate", () => {
    // sysfs reports time_to_empty_now in seconds (14400s = 4h = 240min).
    expect(
      parseSysfsBattery({ capacity: "90", status: "Discharging", timeToEmptyNow: "14400" }),
    ).toEqual({ percent: 90, isOnBattery: true, minutesToEmpty: 240 });
  });

  it("treats Charging/Full/Not charging as not-on-battery and drops the estimate", () => {
    // Only Discharging gates the floor; on AC the time-to-empty is meaningless
    // (and absent from sysfs), matching the pmset AC handling.
    expect(
      parseSysfsBattery({ capacity: "80", status: "Charging", timeToEmptyNow: "2520" }),
    ).toEqual({ percent: 80, isOnBattery: false, minutesToEmpty: null });
    expect(parseSysfsBattery({ capacity: "100", status: "Full" })).toEqual({
      percent: 100,
      isOnBattery: false,
      minutesToEmpty: null,
    });
    expect(parseSysfsBattery({ capacity: "77", status: "Not charging" })).toEqual({
      percent: 77,
      isOnBattery: false,
      minutesToEmpty: null,
    });
  });

  it("parses a discharging battery with no time estimate as null minutes", () => {
    expect(parseSysfsBattery({ capacity: "90", status: "Discharging" })).toEqual({
      percent: 90,
      isOnBattery: true,
      minutesToEmpty: null,
    });
  });

  it("ignores a zero time-to-empty as no estimate", () => {
    expect(
      parseSysfsBattery({ capacity: "90", status: "Discharging", timeToEmptyNow: "0" }),
    ).toEqual({ percent: 90, isOnBattery: true, minutesToEmpty: null });
  });

  it("returns null when the capacity is empty, whitespace, or non-numeric", () => {
    // Number("") and Number("  ") would both coerce to 0 (finite), so the
    // parser must reject malformed reads explicitly rather than reading 0%.
    expect(parseSysfsBattery({ capacity: "", status: "Discharging" })).toBeNull();
    expect(parseSysfsBattery({ capacity: "   ", status: "Discharging" })).toBeNull();
    expect(parseSysfsBattery({ capacity: "abc", status: "Discharging" })).toBeNull();
    expect(parseSysfsBattery({ capacity: "12abc", status: "Discharging" })).toBeNull();
  });
});
