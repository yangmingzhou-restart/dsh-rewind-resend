/**
 * dsh-rewind-resend — client half.
 *
 * Codex-style "edit the message I already sent":
 *
 *   1. find the newest human `user/message` in the session log,
 *   2. stop the source turn if it is still running,
 *   3. fork the session at the previous *completed* turn boundary, so the child
 *      keeps every older turn but not the message being retracted,
 *   4. prefill the child's composer draft with the original prompt text and open
 *      the child, leaving the user free to edit and send.
 *
 * Everything runs through public client services (`sessions`, `uiWorkspace`,
 * `conversation`); no host-side work is needed.
 */

window.__ModuleLoader__.load({
	id: "dsh-rewind-resend",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const react = require("react");
		const h = react.createElement;

		const TAG = "dsh-rewind-resend";

		const CSS = `
.dshRw_pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 24px;
	padding: 0 10px;
	border: 0;
	border-radius: 999px;
	background: var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, 0.12));
	color: var(--dsw-alias-label-secondary, #8a8f98);
	font: var(--dsw-font-xxs-12, 12px/18px system-ui, sans-serif);
	cursor: pointer;
	white-space: nowrap;
	transition: background-color .1s, color .1s;
}
.dshRw_pill:hover:not([disabled]) {
	background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.2));
	color: var(--dsw-alias-label-primary, #e6e8ea);
}
.dshRw_pill[disabled] { cursor: default; opacity: .6; }
.dshRw_pill[data-tone="error"] { color: var(--dsw-alias-state-warn-primary, #e5484d); }
.dshRw_glyph { font-size: 13px; line-height: 1; }
`;

		/** Attach the plugin stylesheet once per document. */
		function installCss() {
			if (typeof document === "undefined") return;
			const key = `@${TAG}/client.css`;
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(key)}]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = TAG;
			tag.dataset.pluginCss = key;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/** Flatten one `user/message` payload into plain text (non-text blocks are dropped). */
		function textOf(message) {
			const content = message?.content;
			if (!Array.isArray(content)) return "";
			const parts = [];
			for (const block of content) {
				if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
			}
			return parts.join("\n");
		}

		/** Unwrap one event-window entry (`{type, event}`) down to its session event. */
		function entryEvent(entry) {
			return entry?.event ?? entry;
		}

		/**
		 * Find the newest human prompt and the boundary that precedes its turn.
		 * @param entries - the session's contiguous event window.
		 * @returns the prompt text plus the inclusive seq of the last completed turn
		 *   end before it (`boundarySeq` is absent when the prompt opened turn 1), or
		 *   undefined when nothing is rewritable.
		 */
		function findRewind(entries) {
			if (!Array.isArray(entries) || entries.length === 0) return undefined;
			let index = -1;
			for (let i = entries.length - 1; i >= 0; i -= 1) {
				const event = entryEvent(entries[i]);
				if (event?.type !== "user/message") continue;
				if (event.data?.source?.kind !== "user") continue;
				index = i;
				break;
			}
			if (index < 0) return undefined;
			const text = textOf(entryEvent(entries[index]).data);
			if (text.trim() === "") return undefined;
			let boundarySeq;
			for (let i = index - 1; i >= 0; i -= 1) {
				const event = entryEvent(entries[i]);
				if (event?.type !== "turn/end") continue;
				boundarySeq = event.seq;
				break;
			}
			return { text, boundarySeq };
		}

		/**
		 * Stable snapshot source over one session's event window.
		 * @param ctx - client root context.
		 * @param sessionId - the session being observed.
		 */
		function rewindStore(ctx, sessionId) {
			let revision;
			let value = null;
			const session = () => ctx.sessions.binding(sessionId)?.session;
			return {
				getSnapshot: () => {
					const live = session();
					if (live === void 0) {
						revision = void 0;
						value = null;
						return value;
					}
					const window = live.eventSource.getSnapshot();
					if (revision !== window.revision) {
						revision = window.revision;
						value = findRewind(window.entries) ?? null;
					}
					return value;
				},
				subscribe: (listener) => {
					const live = session();
					if (live === void 0) return () => {};
					return live.eventSource.subscribe(listener);
				}
			};
		}

		/**
		 * Run one rewind for a session: stop, fork, prefill, open.
		 * @param ctx - client root context.
		 * @param sessionId - the session being rewound.
		 * @param info - `findRewind` result.
		 * @returns a short failure message, or undefined on success.
		 */
		async function rewindSession(ctx, sessionId, info) {
			const source = ctx.sessions.binding(sessionId)?.session;
			if (source !== void 0 && source.getSnapshot().running === true) {
				try {
					await source.cancel();
				} catch {
					// A turn that finished in the meantime is not a failure.
				}
			}

			if (info.boundarySeq === void 0) {
				// The prompt opened the very first turn: there is no prefix to fork, so
				// start a fresh session carrying the same text instead.
				ctx.uiWorkspace.startSession(void 0, { prompt: info.text, clearPreviousDraft: true });
				return void 0;
			}

			const childId = await ctx.sessions.fork({
				sessionId,
				atSeq: info.boundarySeq,
				increaseTitle: true
			});

			// Seed the draft *before* opening, mirroring `startSession`: the shell is
			// created lazily off the retained binding and imports the draft once, so a
			// draft written after the composer mounts can be dropped. Holding our own
			// reference keeps the scope alive until the workspace takes its own.
			const reference = ctx.sessions.retain(childId, { source: TAG });
			try {
				const childBinding = await reference.ready;
				const conversation = ctx.get?.("conversation") ?? ctx.sessions.scope(childId)?.get("conversation");
				if (conversation === void 0) return "输入框服务不可用（conversation 未加载）";
				const outcome = conversation.input.requestDraftInitialization(childBinding, {
					prompt: info.text,
					clearPreviousDraft: true
				});
				if (outcome === "blocked") return "新会话的输入框正忙，稍后再试";
				ctx.uiWorkspace.openSession(childId);
				return void 0;
			} finally {
				// `openSession` retained the child for the main view; ours is redundant.
				// If the hand-over never happened, dropping the child is the right cleanup.
				reference.release();
			}
		}

		/**
		 * Build the composer-dock pill bound to one session.
		 * @param ctx - client root context.
		 * @returns a React component.
		 */
		function createRewindPill(ctx) {
			return function RewindPill({ rewindStore, rewind }) {
				const info = react.useSyncExternalStore(rewindStore.subscribe, rewindStore.getSnapshot, rewindStore.getSnapshot);
				const [state, setState] = react.useState({ busy: false, error: void 0 });
				const timer = react.useRef(void 0);

				react.useEffect(() => () => {
					if (timer.current !== void 0) clearTimeout(timer.current);
				}, []);

				if (info === null) return null;

				const flash = (message) => {
					setState({ busy: false, error: message });
					if (timer.current !== void 0) clearTimeout(timer.current);
					timer.current = setTimeout(() => setState({ busy: false, error: void 0 }), 5000);
				};

				const onClick = () => {
					if (state.busy) return;
					setState({ busy: true, error: void 0 });
					Promise.resolve()
						.then(() => rewind.run())
						.then((failure) => {
							if (failure === void 0) setState({ busy: false, error: void 0 });
							else flash(failure);
						})
						.catch((error) => flash(error instanceof Error ? error.message : String(error)));
				};

				const label = state.busy ? "处理中…" : state.error !== void 0 ? `失败：${state.error}` : "改上一条并重发";
				const title = state.error !== void 0
					? state.error
					: "停掉正在跑的回合，在保留历史的新会话里把这条消息放回输入框，改完再发";

				return h("button", {
					type: "button",
					className: "dshRw_pill",
					title,
					disabled: state.busy,
					"data-tone": state.error === void 0 ? void 0 : "error",
					"data-rewind": "",
					onClick
				}, [
					h("span", { key: "glyph", className: "dshRw_glyph", "aria-hidden": true }, "↩"),
					h("span", { key: "label" }, label)
				]);
			};
		}

		/**
		 * Mount the composer-dock pill.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			installCss();
			const RewindPill = createRewindPill(ctx);
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "rewind",
				order: 2,
				registrant: TAG,
				inject: (sessionId) => {
					const store = rewindStore(ctx, sessionId);
					return {
						rewindStore: store,
						rewind: {
							run: () => {
								const info = store.getSnapshot();
								if (info === null) return void 0;
								return rewindSession(ctx, sessionId, info);
							}
						}
					};
				}
			}, RewindPill));
		}

		exports.apply = apply;
		exports.inject = ["slots", "sessions", "uiWorkspace"];
		return module.exports;
	}
});
