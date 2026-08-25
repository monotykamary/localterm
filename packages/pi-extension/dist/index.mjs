import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
//#region src/constants.ts
const LOCALTERM_STATE_DIRNAME = ".localterm";
const SECRETS_FILENAME = "secrets.json";
const PROCESSES_FILENAME = "processes.json";
const PI_SETTINGS_FILENAME = "settings.json";
const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PROCESS_NAME_PATTERN = /^[A-Za-z0-9_.+-]+$/;
const ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const NOTIFICATION_MAX_LENGTH = 1024;
const PI_RETRY_STARTED_EVENT = "pi-retry:started";
const PI_RETRY_COMPLETED_EVENT = "pi-retry:completed";
const PI_RETRY_CANCELLED_EVENT = "pi-retry:cancelled";
//#endregion
//#region src/utils/collapse-whitespace.ts
const WHITESPACE_RUN = /\s+/g;
const collapseWhitespace = (text) => text.replace(WHITESPACE_RUN, " ").trim();
//#endregion
//#region src/utils/agent-notify-body.ts
const ELLIPSIS = "…";
const formatElapsedSeconds = (elapsedMs) => {
	const totalSeconds = elapsedMs / 1e3;
	if (totalSeconds < 60) return `${(Math.floor(totalSeconds * 10) / 10).toFixed(1)}s`;
	return `${Math.floor(totalSeconds / 60)}m ${Math.floor(totalSeconds % 60)}s`;
};
const truncateWithEllipsis = (text, maxChars) => text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}${ELLIPSIS}`;
const extractAssistantExcerpt = (messages) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		const messageText = message.content.map((part) => part.type === "text" ? part.text : "").join(" ");
		const collapsed = collapseWhitespace(messageText);
		if (collapsed) return truncateWithEllipsis(collapsed, 160);
	}
};
const formatAgentEndBody = (elapsedMs, sessionName, excerpt) => {
	const elapsed = formatElapsedSeconds(elapsedMs);
	const identity = [sessionName, excerpt].filter((part) => Boolean(part)).join(" — ");
	return identity ? `pi finished: ${identity} (${elapsed})` : `pi finished (${elapsed})`;
};
//#endregion
//#region src/utils/retry-event-id.ts
const retryEventId = (event) => {
	if (typeof event !== "object" || event === null || !("retryId" in event)) return void 0;
	return typeof event.retryId === "number" ? event.retryId : void 0;
};
//#endregion
//#region src/utils/osc-sequence.ts
const OSC9_PREFIX = "\x1B]9;";
const OSC9_BEL = "\x07";
const isControlOrDel = (char) => {
	const code = char.codePointAt(0) ?? 0;
	return code <= 31 || code === 127;
};
const buildOsc9Sequence = (body, maxLength = NOTIFICATION_MAX_LENGTH) => {
	const sanitized = Array.from(body, (char) => isControlOrDel(char) ? " " : char).join("");
	const capped = collapseWhitespace(sanitized).slice(0, maxLength);
	return `${OSC9_PREFIX}${capped}${OSC9_BEL}`;
};
//#endregion
//#region extensions/agent-notify.ts
const registerAgentNotify = (pi) => {
	let activeRetryId;
	let latestMessages = [];
	let settledContext;
	let turnStartedAt;
	let hasCurrentRunSettled = false;
	const resetNotificationState = () => {
		latestMessages = [];
		settledContext = void 0;
		turnStartedAt = void 0;
		hasCurrentRunSettled = false;
	};
	const emitNotification = () => {
		if (!hasCurrentRunSettled || settledContext === void 0 || turnStartedAt === void 0) return;
		const elapsedMs = Date.now() - turnStartedAt;
		const context = settledContext;
		const messages = latestMessages;
		resetNotificationState();
		if (context.mode !== "tui" || elapsedMs < 3e4) return;
		const body = formatAgentEndBody(elapsedMs, pi.getSessionName(), extractAssistantExcerpt(messages));
		process.stdout.write(buildOsc9Sequence(body));
	};
	const unsubscribeRetryStarted = pi.events.on(PI_RETRY_STARTED_EVENT, (event) => {
		activeRetryId = retryEventId(event);
	});
	const unsubscribeRetryCompleted = pi.events.on(PI_RETRY_COMPLETED_EVENT, (event) => {
		if (retryEventId(event) !== activeRetryId) return;
		activeRetryId = void 0;
		emitNotification();
	});
	const unsubscribeRetryCancelled = pi.events.on(PI_RETRY_CANCELLED_EVENT, (event) => {
		if (retryEventId(event) !== activeRetryId) return;
		activeRetryId = void 0;
		resetNotificationState();
	});
	pi.on("agent_start", () => {
		turnStartedAt ??= Date.now();
		hasCurrentRunSettled = false;
		settledContext = void 0;
	});
	pi.on("agent_end", (event) => {
		latestMessages = event.messages;
	});
	pi.on("agent_settled", (_event, context) => {
		hasCurrentRunSettled = true;
		settledContext = context;
		if (activeRetryId === void 0) emitNotification();
	});
	pi.on("session_shutdown", () => {
		unsubscribeRetryStarted();
		unsubscribeRetryCompleted();
		unsubscribeRetryCancelled();
		resetNotificationState();
	});
};
//#endregion
//#region src/utils/read-localterm-secret-policy.ts
const isRecord$1 = (value) => typeof value === "object" && value !== null;
const readJsonFile$1 = (filePath) => {
	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
};
const parseSecretsFile = (data) => {
	if (!isRecord$1(data) || !Array.isArray(data.secrets)) return [];
	return data.secrets.filter(isRecord$1).map((entry) => ({
		name: String(entry.name ?? ""),
		envVar: String(entry.envVar ?? "")
	})).filter((entry) => SECRET_NAME_PATTERN.test(entry.name) && ENV_VAR_PATTERN.test(entry.envVar));
};
const parseProcessesFile = (data) => {
	if (!isRecord$1(data) || !Array.isArray(data.processes)) return [];
	return data.processes.filter(isRecord$1).map((entry) => ({
		name: String(entry.name ?? ""),
		requestedSecrets: Array.isArray(entry.requestedSecrets) ? entry.requestedSecrets.filter((item) => typeof item === "string") : []
	})).filter((entry) => PROCESS_NAME_PATTERN.test(entry.name));
};
const readLocaltermSecretEnvVarsForPi = (stateDirectory = join(homedir(), LOCALTERM_STATE_DIRNAME)) => {
	const secretsData = readJsonFile$1(join(stateDirectory, SECRETS_FILENAME));
	const processesData = readJsonFile$1(join(stateDirectory, PROCESSES_FILENAME));
	const envVarBySecretName = /* @__PURE__ */ new Map();
	for (const secret of parseSecretsFile(secretsData)) envVarBySecretName.set(secret.name, secret.envVar);
	const piProcess = parseProcessesFile(processesData).find((entry) => entry.name === "pi");
	if (!piProcess) return [];
	const envVars = [];
	for (const secretName of piProcess.requestedSecrets) {
		if (!SECRET_NAME_PATTERN.test(secretName)) continue;
		const envVar = envVarBySecretName.get(secretName);
		if (envVar) envVars.push(envVar);
	}
	return envVars;
};
//#endregion
//#region src/utils/read-secret-values.ts
const readLocaltermSecretValuesForPi = (stateDirectory = join(homedir(), LOCALTERM_STATE_DIRNAME), env = process.env) => {
	const values = [];
	for (const envVar of readLocaltermSecretEnvVarsForPi(stateDirectory)) {
		const value = env[envVar];
		if (typeof value === "string" && value.length >= 4) values.push(value);
	}
	return [...new Set(values)];
};
//#endregion
//#region src/utils/read-pi-shell-settings.ts
const DEFAULT_CONFIG_DIR_NAME = ".pi";
const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const expandTilde = (value) => {
	if (value === "~") return homedir();
	return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
};
const resolveAgentDir = () => {
	const override = process.env[PI_CODING_AGENT_DIR_ENV];
	return override ? expandTilde(override) : join(homedir(), DEFAULT_CONFIG_DIR_NAME, "agent");
};
const isRecord = (value) => typeof value === "object" && value !== null;
const readJsonFile = (filePath) => {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
};
const readNonEmptyString = (settings, key) => {
	const value = settings[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
};
const readPiShellSettings = (cwd, paths = {}) => {
	const globalSettingsPath = paths.globalSettingsPath ?? join(resolveAgentDir(), "settings.json");
	const configDirName = paths.configDirName ?? DEFAULT_CONFIG_DIR_NAME;
	const merged = {
		...readJsonFile(globalSettingsPath),
		...readJsonFile(join(cwd, configDirName, PI_SETTINGS_FILENAME))
	};
	return {
		shellPath: readNonEmptyString(merged, "shellPath"),
		commandPrefix: readNonEmptyString(merged, "shellCommandPrefix")
	};
};
//#endregion
//#region src/utils/redact-output.ts
const redactText = (text, values) => {
	const applicable = values.filter((value) => value.length >= 4);
	if (applicable.length === 0) return text;
	const ordered = [...applicable].sort((valueA, valueB) => valueB.length - valueA.length);
	let redacted = text;
	for (const value of ordered) {
		if (!redacted.includes(value)) continue;
		redacted = redacted.split(value).join("*");
	}
	return redacted;
};
const overlapTailLen = (text, values) => {
	let best = 0;
	for (const value of values) {
		if (value.length <= 1) continue;
		const maxOverlap = Math.min(text.length, value.length);
		for (let overlap = maxOverlap; overlap > best; overlap -= 1) if (text.endsWith(value.slice(0, overlap))) {
			best = overlap;
			break;
		}
	}
	return best;
};
const createStreamingRedactor = (values) => {
	const applicable = values.filter((value) => value.length >= 4);
	if (applicable.length === 0) return {
		push: (chunk) => chunk,
		finish: () => ""
	};
	let pending = "";
	return {
		push(chunk) {
			pending += chunk;
			const safeLen = pending.length - overlapTailLen(pending, applicable);
			if (safeLen <= 0) return "";
			const safe = pending.slice(0, safeLen);
			pending = pending.slice(safeLen);
			return redactText(safe, applicable);
		},
		finish() {
			if (pending.length === 0) return "";
			const redacted = redactText(pending, applicable);
			pending = "";
			return redacted;
		}
	};
};
//#endregion
//#region src/utils/scrub-env.ts
const scrubEnv = (env, strip) => {
	if (strip.size === 0) return env;
	const next = { ...env };
	for (const name of strip) if (Object.prototype.hasOwnProperty.call(next, name)) delete next[name];
	return next;
};
//#endregion
//#region extensions/bash-secret-scrub.ts
const wrapWithRedaction = (operations, getValues) => ({ exec: async (command, cwd, options) => {
	const values = getValues();
	if (values.length === 0) return operations.exec(command, cwd, options);
	const redactor = createStreamingRedactor(values);
	const decoder = new TextDecoder("utf-8", { fatal: false });
	const { onData, ...rest } = options;
	const emit = (text) => {
		if (text.length > 0) onData(Buffer.from(text, "utf8"));
	};
	const result = await operations.exec(command, cwd, {
		...rest,
		onData: (data) => emit(redactor.push(decoder.decode(data, { stream: true })))
	});
	emit(redactor.push(decoder.decode()));
	emit(redactor.finish());
	return result;
} });
const registerBashSecretScrub = (pi) => {
	const cwd = process.cwd();
	const { shellPath, commandPrefix } = readPiShellSettings(cwd);
	let stripSet = new Set(readLocaltermSecretEnvVarsForPi());
	let redactionValues = readLocaltermSecretValuesForPi();
	let installed = false;
	const spawnHook = ({ command, cwd: spawnCwd, env }) => ({
		command,
		cwd: spawnCwd,
		env: scrubEnv(env, stripSet)
	});
	const install = () => {
		if (installed) return;
		installed = true;
		import("@earendil-works/pi-coding-agent").then(({ createBashToolDefinition, createLocalBashOperations }) => {
			const operations = wrapWithRedaction(createLocalBashOperations({ shellPath }), () => redactionValues);
			pi.registerTool(createBashToolDefinition(cwd, {
				operations,
				spawnHook,
				commandPrefix,
				shellPath
			}));
		}).catch(() => {});
	};
	pi.on("session_start", () => {
		stripSet = new Set(readLocaltermSecretEnvVarsForPi());
		redactionValues = readLocaltermSecretValuesForPi();
		install();
	});
};
//#endregion
//#region extensions/kitty-images.ts
const KITTY_IDENTITY_ENV = "KITTY_WINDOW_ID";
const LOCALTERM_MARKER = "localterm";
const plantKittyIdentityEnv = () => {
	if (!process.env.LOCALTERM && !process.env.LOCALTERM_SESSION_ID) return;
	process.env[KITTY_IDENTITY_ENV] ||= LOCALTERM_MARKER;
};
const enableKittyImages = () => {
	plantKittyIdentityEnv();
	const capabilities = getCapabilities();
	if (capabilities.images === "kitty" && capabilities.hyperlinks) return;
	setCapabilities({
		...capabilities,
		images: "kitty",
		hyperlinks: true
	});
};
//#endregion
//#region extensions/activation.ts
const activate = (pi) => {
	enableKittyImages();
	registerBashSecretScrub(pi);
	registerAgentNotify(pi);
};
//#endregion
//#region extensions/index.ts
var extensions_default = async (pi) => {
	if (process.env.LOCALTERM !== "1") return;
	activate(pi);
};
//#endregion
export { extensions_default as default };

//# sourceMappingURL=index.mjs.map