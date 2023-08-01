import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";

import * as lib0 from "lib0";
import debounce from "lodash.debounce";
import { callbackHandler, isCallbackSet } from "./callback";
import { WebSocket } from "ws";
import { IncomingMessage } from "http";
import {
	CustomAwareness,
	applyAwarenessUpdate,
	encodeAwarenessUpdate,
	removeAwarenessStates,
} from "../../common/yjs/custom_awareness";
import { getUsername } from "./usernames";
import { RedisChannelType } from "../../common/redis/redis";
import { CustomMessage, UserPresence } from "./types";
import { logger } from "../../common/logging/log";
import { WsRedisType } from "./server";

const hexColors = [
	"#D48C8C",
	"#49453E",
	"#D6D2B5",
	"#C4BC84",
	"#93AE88",
	"#767A8A",
	"#A1B9C5",
	"#776F5F",
	"#6D8165",
	"#51604B",
];

const encoding = lib0.encoding;
const decoding = lib0.decoding;
const map = lib0.map;

const CALLBACK_DEBOUNCE_WAIT = process.env.CALLBACK_DEBOUNCE_WAIT
	? parseInt(process.env.CALLBACK_DEBOUNCE_WAIT)
	: 2000;
const CALLBACK_DEBOUNCE_MAXWAIT = process.env.CALLBACK_DEBOUNCE_MAXWAIT
	? parseInt(process.env.CALLBACK_DEBOUNCE_MAXWAIT)
	: 10000;

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;
const wsReadyStateClosing = 2; // eslint-disable-line
const wsReadyStateClosed = 3; // eslint-disable-line

// disable gc when using snapshots!
const gcEnabled = process.env.GC !== "false" && process.env.GC !== "0";

export const docs = new Map<string, WSSharedDoc>();

const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2

export class WSSharedDoc extends Y.Doc {
	/**
	 * Maps from conn to set of controlled client ids. Delete all client ids from awareness when this conn is closed
	 */
	// conns: Map<WebSocket, Set<number>>;
	conns: Map<WebSocket, { userId: string; clientInfo: UserPresence }>;
	connCount: number;
	allowEveryoneToEdit: boolean;
	creatorId: string;

	name: string;
	awareness: CustomAwareness;
	constructor(name: string, allowEveryoneToEdit: boolean, creatorId: string) {
		super({ gc: gcEnabled });
		this.name = name;
		this.connCount = 0;

		this.allowEveryoneToEdit = allowEveryoneToEdit;
		this.creatorId = creatorId;

		this.conns = new Map();
		this.awareness = new CustomAwareness(this);
		this.awareness.setLocalState(null);

		const awarenessChangeHandler = (
			{
				added,
				updated,
				removed,
			}: {
				added: Array<number>;
				updated: Array<number>;
				removed: Array<number>;
			},
			conn: WebSocket | null
		) => {
			const addId = added[0];
			const updatedId = added[0];
			const removedId = removed[0];

			const changedClients = added.concat(updated, removed);
			if (conn !== null) {
				const connDescriptor = this.conns.get(conn);

				if (!connDescriptor) {
					logger.warn("No conn descriptor found!");
					return;
				}

				if (addId) {
					connDescriptor.clientInfo.clientId = addId;
				}

				if (
					removedId &&
					removedId === connDescriptor.clientInfo.clientId
				) {
					connDescriptor.clientInfo.clientId = undefined;
				}

				if (addId || removedId) {
					this.broadcastPresenceUpdate();
				}
			}
			// broadcast awareness update
			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, messageAwareness);
			encoding.writeVarUint8Array(
				encoder,
				encodeAwarenessUpdate(this.awareness, changedClients)
			);
			const buff = encoding.toUint8Array(encoder);

			this.conns.forEach((_, c) => {
				this.send(c, buff);
			});
		};
		this.awareness.on("update", awarenessChangeHandler);
		this.on("update", this.updateHandler);
		if (isCallbackSet) {
			this.on(
				"update",
				debounce(callbackHandler, CALLBACK_DEBOUNCE_WAIT, {
					maxWait: CALLBACK_DEBOUNCE_MAXWAIT,
				})
			);
		}
	}

	updateHandler = (update: Uint8Array, origin: WebSocket) => {
		// TODO: origin is a websocket connection that originates the update.

		const user = this.conns.get(origin);

		if (!user) {
			logger.warn("No user found in updateHandler");
			return;
		}

		const canEdit =
			this.allowEveryoneToEdit || user.userId === this.creatorId;

		if (!canEdit) {
			logger.warn("Edit attempt by user who can not edit");
			return;
		}

		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, messageSync);
		syncProtocol.writeUpdate(encoder, update);
		const message = encoding.toUint8Array(encoder);
		this.conns.forEach((_, conn) => this.send(conn, message));
	};

	broadcastPresenceUpdate() {
		this.broadcastAll({
			type: "presencesUpdated",
			users: [...this.conns.values()].map((val) => val.clientInfo),
		});
	}

	messageListener = (conn: WebSocket, message: Uint8Array) => {
		try {
			const encoder = encoding.createEncoder();
			const decoder = decoding.createDecoder(message);
			const messageType = decoding.readVarUint(decoder);
			switch (messageType) {
				case messageSync:
					encoding.writeVarUint(encoder, messageSync);
					syncProtocol.readSyncMessage(decoder, encoder, this, conn);

					// If the `encoder` only contains the type of reply message and no
					// message, there is no need to send the message. When `encoder` only
					// contains the type of reply, its length is 1.
					if (encoding.length(encoder) > 1) {
						this.send(conn, encoding.toUint8Array(encoder));
					}
					break;
				case messageAwareness: {
					applyAwarenessUpdate(
						this.awareness,
						decoding.readVarUint8Array(decoder),
						conn
					);
					break;
				}
			}
		} catch (err) {
			console.error(err);
			this.emit("error", [err]);
		}
	};

	addConnection(conn: WebSocket, userId: string) {
		this.conns.set(conn, {
			userId,
			clientInfo: {
				name: getUsername(
					[...this.conns.values()].map((val) => val.clientInfo.name)
				),
				color: hexColors[this.connCount++ % hexColors.length],
				clientId: undefined,
			},
		});

		conn.on("message", (message: ArrayBuffer) =>
			this.messageListener(conn, new Uint8Array(message))
		);

		// Check if connection is still alive
		let pongReceived = true;
		const pingInterval = setInterval(() => {
			if (!pongReceived) {
				if (this.conns.has(conn)) {
					this.closeConn(conn);
				}
				clearInterval(pingInterval);
			} else if (this.conns.has(conn)) {
				pongReceived = false;
				try {
					conn.ping();
				} catch (e) {
					this.closeConn(conn);
					clearInterval(pingInterval);
				}
			}
		}, pingTimeout);
		conn.on("close", () => {
			this.closeConn(conn);
			clearInterval(pingInterval);
		});
		conn.on("pong", () => {
			pongReceived = true;
		});
		// put the following in a variables in a block so the interval handlers don't keep in in
		// scope
		{
			// send sync step 1
			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, messageSync);
			syncProtocol.writeSyncStep1(encoder, this);
			this.send(conn, encoding.toUint8Array(encoder));
			const awarenessStates = this.awareness.getStates();

			if (awarenessStates.size > 0) {
				const encoder = encoding.createEncoder();
				encoding.writeVarUint(encoder, messageAwareness);
				encoding.writeVarUint8Array(
					encoder,
					encodeAwarenessUpdate(
						this.awareness,
						Array.from(awarenessStates.keys())
					)
				);

				this.send(conn, encoding.toUint8Array(encoder));
			}
		}

		this.broadcastPresenceUpdate();
	}

	broadcastAll(message: CustomMessage) {
		for (const ws of this.conns.keys()) {
			this.send(ws, JSON.stringify(message));
		}
	}

	send(conn: WebSocket, m: Uint8Array | string) {
		if (
			conn.readyState !== wsReadyStateConnecting &&
			conn.readyState !== wsReadyStateOpen
		) {
			this.closeConn(conn);
		}
		try {
			conn.send(m, (err: any) => {
				err != null && this.closeConn(conn);
			});
		} catch (e) {
			this.closeConn(conn);
		}
	}

	closeConn = (conn: WebSocket) => {
		if (this.conns.has(conn)) {
			const controlledId = this.conns.get(conn)?.clientInfo?.clientId;
			this.conns.delete(conn);

			if (this.conns.size === 0) {
				docs.delete(this.name);
			}

			if (controlledId) {
				removeAwarenessStates(this.awareness, [controlledId], null);
			}
			this.broadcastPresenceUpdate();
		}

		console.log(docs.size);
		conn.close();
	};
}

/**
 * Gets a Y.Doc by name, whether in memory or on disk
 *
 * @param docname - the name of the Y.Doc to find or create
 * @param gc - whether to allow gc on the doc (applies only when created)
 */
export const getOrCreateYDoc = async (
	docname: string,
	redis: WsRedisType,
	gc: boolean = true
): Promise<WSSharedDoc> => {
	const existingDoc = docs.get(docname);
	if (existingDoc) {
		return existingDoc;
	}

	const permissions = await redis.rpc("App", "GetNotePermissions", {
		slug: docname,
	});

	const newDoc = new WSSharedDoc(
		docname,
		permissions.allowAnyoneToEdit,
		permissions.creatorId
	);
	newDoc.gc = gc;
	docs.set(docname, newDoc);
	return newDoc;
};

export const setupWSConnection = async (
	redis: WsRedisType,
	conn: WebSocket,
	userId: string,
	req: IncomingMessage,
	{ docName = req.url?.slice(1).split("?")[0], gc = true }: any = {}
) => {
	console.log("setting up WS connection");

	conn.binaryType = "arraybuffer";
	// get doc, initialize if it does not exist yet
	const doc = await getOrCreateYDoc(docName, redis, gc);
	doc.addConnection(conn, userId);
	// listen and reply to events
};

const pingTimeout = 5000;
