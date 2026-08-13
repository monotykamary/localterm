//#region extensions/index.ts
var extensions_default = async (pi) => {
	if (process.env.LOCALTERM !== "1") return;
	const { activate } = await import("./activation-By6TjYp_.mjs");
	activate(pi);
};
//#endregion
export { extensions_default as default };

//# sourceMappingURL=index.mjs.map