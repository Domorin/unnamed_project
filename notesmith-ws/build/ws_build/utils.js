"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateYDoc = exports.WSSharedDoc = exports.saveDoc = exports.docs = void 0;
const syncProtocol = __importStar(require("y-protocols/sync"));
const Y = __importStar(require("yjs"));
const lib0 = __importStar(require("lib0"));
const lodash_debounce_1 = __importDefault(require("lodash.debounce"));
const superjson_1 = __importDefault(require("superjson"));
const yjs_1 = require("yjs");
const Logger_1 = __importDefault(require("@notesmith/common/Logger"));
const YJS_1 = require("@notesmith/common/YJS");
const callback_js_1 = require("./callback.js");
const usernames_js_1 = require("./usernames.js");
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
const _gcEnabled = process.env.GC !== "false" && process.env.GC !== "0";
exports.docs = new Map();
const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2
exports.saveDoc = (0, lodash_debounce_1.default)((doc, userId) => {
    doc.redis.rpc("App", "SaveDoc", {
        slug: doc.name,
        userId: userId,
        content: Array.from((0, YJS_1.encodeYDocContent)(doc)),
    }, {
        ignoreResponse: true,
    });
}, 1000, { maxWait: 5000 });
class WSSharedDoc extends Y.Doc {
    /**
     * Maps from conn to set of controlled client ids. Delete all client ids from awareness when this conn is closed
     */
    // conns: Map<WebSocket, Set<number>>;
    conns;
    allowEveryoneToEdit;
    creatorId;
    redis;
    name;
    awareness;
    constructor(redis, name, initialContent, allowEveryoneToEdit, creatorId) {
        super({ gc: true });
        this.redis = redis;
        this.name = name;
        this.allowEveryoneToEdit = allowEveryoneToEdit;
        this.creatorId = creatorId;
        this.conns = new Map();
        this.awareness = new YJS_1.CustomAwareness(this);
        this.awareness.setLocalState(null);
        const awarenessChangeHandler = ({ added, updated, removed, }, conn) => {
            const addId = added[0];
            // const updatedId = added[0];
            const removedId = removed[0];
            const changedClients = added.concat(updated, removed);
            if (conn !== null) {
                const connDescriptor = this.conns.get(conn);
                if (!connDescriptor) {
                    Logger_1.default.warn("No conn descriptor found!");
                    return;
                }
                if (addId) {
                    connDescriptor.clientInfo.clientId = addId;
                }
                if (removedId &&
                    removedId === connDescriptor.clientInfo.clientId) {
                    connDescriptor.clientInfo.clientId = undefined;
                }
                if (addId || removedId) {
                    this.broadcastPresenceUpdate();
                }
            }
            // broadcast awareness update
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageAwareness);
            encoding.writeVarUint8Array(encoder, (0, YJS_1.encodeAwarenessUpdate)(this.awareness, changedClients));
            const buff = encoding.toUint8Array(encoder);
            this.conns.forEach((_, c) => {
                this.send(c, buff);
            });
        };
        this.awareness.on("update", awarenessChangeHandler);
        this.on("update", this.updateHandler);
        if (callback_js_1.isCallbackSet) {
            this.on("update", (0, lodash_debounce_1.default)(callback_js_1.callbackHandler, CALLBACK_DEBOUNCE_WAIT, {
                maxWait: CALLBACK_DEBOUNCE_MAXWAIT,
            }));
        }
        (0, yjs_1.applyUpdateV2)(this, Buffer.from(initialContent));
    }
    get connCount() {
        return this.conns.size;
    }
    updateHandler = (update, origin) => {
        const isFromServer = origin === null;
        const user = this.conns.get(origin);
        if (!isFromServer) {
            if (!user) {
                Logger_1.default.warn("No user found in updateHandler");
                return;
            }
            const canEdit = this.allowEveryoneToEdit || user.userId === this.creatorId;
            if (!canEdit) {
                Logger_1.default.warn("Edit attempt by user who can not edit");
                return;
            }
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);
        if (!isFromServer && user) {
            (0, exports.saveDoc)(this, user.userId);
        }
        this.conns.forEach((_, conn) => this.send(conn, message));
    };
    broadcastPresenceUpdate() {
        this.broadcastAll({
            type: "presencesUpdated",
            users: [...this.conns.values()].map((val) => val.clientInfo),
        });
    }
    messageListener = (conn, message) => {
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
                    (0, YJS_1.applyAwarenessUpdate)(this.awareness, decoding.readVarUint8Array(decoder), conn);
                    break;
                }
            }
        }
        catch (err) {
            console.error(err);
            this.emit("error", [err]);
        }
    };
    addConnection(conn, userId) {
        this.conns.set(conn, {
            userId,
            clientInfo: {
                name: (0, usernames_js_1.getUsername)([...this.conns.values()].map((val) => val.clientInfo.name)),
                color: hexColors[this.connCount % hexColors.length],
                clientId: undefined,
            },
        });
        conn.on("message", (message) => this.messageListener(conn, new Uint8Array(message)));
        // Check if connection is still alive
        let pongReceived = true;
        const pingInterval = setInterval(() => {
            if (!pongReceived) {
                if (this.conns.has(conn)) {
                    this.closeConn(conn);
                }
                clearInterval(pingInterval);
            }
            else if (this.conns.has(conn)) {
                pongReceived = false;
                try {
                    conn.ping();
                }
                catch (e) {
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
                encoding.writeVarUint8Array(encoder, (0, YJS_1.encodeAwarenessUpdate)(this.awareness, Array.from(awarenessStates.keys())));
                this.send(conn, encoding.toUint8Array(encoder));
            }
        }
        this.broadcastPresenceUpdate();
    }
    broadcastAll(message) {
        for (const ws of this.conns.keys()) {
            this.send(ws, superjson_1.default.stringify(message));
        }
    }
    send(conn, m) {
        if (conn.readyState !== wsReadyStateConnecting &&
            conn.readyState !== wsReadyStateOpen) {
            this.closeConn(conn);
        }
        try {
            conn.send(m, (err) => {
                err != null && this.closeConn(conn);
            });
        }
        catch (e) {
            this.closeConn(conn);
        }
    }
    closeConn = (conn) => {
        if (this.conns.has(conn)) {
            const controlledId = this.conns.get(conn)?.clientInfo?.clientId;
            this.conns.delete(conn);
            if (this.conns.size === 0) {
                exports.docs.delete(this.name);
            }
            if (controlledId) {
                (0, YJS_1.removeAwarenessStates)(this.awareness, [controlledId], null);
            }
            this.broadcastPresenceUpdate();
        }
        conn.close();
    };
}
exports.WSSharedDoc = WSSharedDoc;
/**
 * Gets a Y.Doc by name, whether in memory or on disk
 *
 * @param docname - the name of the Y.Doc to find or create
 * @param gc - whether to allow gc on the doc (applies only when created)
 */
const getOrCreateYDoc = async (docname, redis) => {
    const existingDoc = exports.docs.get(docname);
    if (existingDoc) {
        return existingDoc;
    }
    const [storedDoc, permissions] = await Promise.all([
        redis.rpc("App", "GetDoc", {
            slug: docname,
        }),
        redis.rpc("App", "GetNotePermissions", {
            slug: docname,
        }),
    ]);
    const newDoc = new WSSharedDoc(redis, docname, storedDoc.content, permissions.allowAnyoneToEdit, permissions.creatorId);
    exports.docs.set(docname, newDoc);
    return newDoc;
};
exports.getOrCreateYDoc = getOrCreateYDoc;
const pingTimeout = 5000;
