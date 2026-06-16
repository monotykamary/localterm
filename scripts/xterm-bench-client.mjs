#!/usr/bin/env node
const CONTROL_URL = process.env.CONTROL_URL || "http://127.0.0.1:8766";

const args = process.argv.slice(2).join("&");
const params = args ? `?${args}` : "";

const response = await fetch(`${CONTROL_URL}/run${params}`);
const body = await response.json();
console.log(JSON.stringify(body, null, 2));
