#!/usr/bin/env node
import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { version } from "../package.json";
import Logger from "./Logger";

dotenv.config();

const debug = process.env.SOCKET_DEBUG === "true";
const serveClient = process.env.SOCKET_SERVE_CLIENT === "true";
const corsOrigins = process.env.SOCKET_CORS_ORIGINS?.split(",");
const authEndpoint = process.env.SOCKET_AUTH_ENDPOINT;
const cookieAuth = process.env.SOCKET_COOKIE_AUTH === "true";
const allowUnauth = process.env.SOCKET_ALLOW_UNAUTH === "true";
const apiSecret = process.env.SOCKET_API_SECRET;
const host = process.env.SOCKET_HOST ?? "127.0.0.1";
const port = process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 3000;

const logger = new Logger(debug);

if (!process.env.SOCKET_API_SECRET) {
    console.log("WARNING: No API secret set. Authentication disabled.");
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
    serveClient,
    cors: {
        origin: corsOrigins
    }
});

io.use(async (socket, next) => {
    const clientLogger = logger.withId(socket.id);

    if (authEndpoint && (socket.handshake.auth.token || cookieAuth)) {
        try {
            const response = await axios.get(authEndpoint, {
                headers: {
                    Authorization: socket.handshake.auth.token ? `Bearer ${socket.handshake.auth.token}` : undefined,
                    Cookie: cookieAuth ? socket.handshake.headers.cookie : undefined
                }
            });
            clientLogger.log("connection authenticated", response.data);
            socket.join(response.data);
            next();
            return; 
        }
        catch (e) {
            if (e instanceof AxiosError) {
                clientLogger.log("authentication failed");
                if (!allowUnauth) {
                    next(new Error("authentication_failed"));
                    return;
                }
            }
            else {
                clientLogger.log("unknown error during authentication");
                next(new Error("unknown_error"));
                return;
            }
        }
    }
    
    if (allowUnauth) {
        clientLogger.log("unauthenticated connection");
        next();
    }
    else {
        clientLogger.log("unauthenticated connection rejected");
        next(new Error("authentication_required"));
    }
});

io.on("connection", socket => {
    const clientLogger = logger.withId(socket.id);
    socket.on("disconnect", reason => {
        clientLogger.log(`disconnected (${reason})`);
    });
});

app.use(express.json());
app.use((req, res, next) => {
    if (!apiSecret || `Bearer ${apiSecret}` === req.header("authorization")) {
        next();
    }
    else {
        logger.log("unauthenticated api call rejected");
        res.status(401).end();
    }
})
app.post("/emit", (req, res) => {
    logger.log("emitting", req.body);
    const {to, event, payload} = req.body;
    io.to(to).emit(event, payload);
    res.status(204).end();
});
app.post("/join", (req, res) => {
    logger.log("joining", req.body);
    const {id, rooms} = req.body;
    const socket = io.sockets.sockets.get(id);
    if (socket) {
        const clientLogger = logger.withId(socket.id);
        socket.join(rooms);
        clientLogger.log("joined", rooms);
    }
    else {
        logger.log("socket not found for joining", id);
    }
    res.status(204).end();
});

server.listen(port, host);
console.log(`Socket IO Server Version ${version} - Copyright © 2023 enymo GmbH`);