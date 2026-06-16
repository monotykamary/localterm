import { LAUNCHD_LABEL } from "../constants.js";

export const isRunningUnderLaunchd = (): boolean => process.env.XPC_SERVICE_NAME === LAUNCHD_LABEL;
