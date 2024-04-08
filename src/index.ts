#!/usr/bin/env node
import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { version } from "../package.json";
import Logger from "./Logger";
import { requireEnv } from "./functions";

dotenv.config();

const logger = new Logger(process.env.SOCKET_DEBUG === "true");

if (!process.env.SOCKET_API_SECRET) {
    console.log("WARNING: No API secret set. Authentication disabled.");
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
    serveClient: process.env.SOCKET_SERVE_CLIENT === "true",
    cors: {
        origin: process.env.SOCKET_CORS_ORIGINS?.split(",")
    }
});

io.use(async (socket, next) => {
    const clientLogger = logger.withId(socket.id);
    if (socket.handshake.auth.token) {
        try {
            const response = await axios.get(requireEnv("SOCKET_AUTH_ENDPOINT"), {
                headers: {
                    Authorization: `Bearer ${socket.handshake.auth.token}`
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
                if (process.env.SOCKET_UNAUTH_FALLBACK !== "true") {
                    next(new Error("authentication_failed"));
                    return;
                }
            }
            else {
                clientLogger.log("unknown error during authentication");
                if (process.env.SOCKET_UNAUTH_FALLBACK !== "true") {
                    next(new Error("unknown_error"));
                    return;
                }
            }
            
        }
    }

    if (process.env.SOCKET_ALLOW_UNAUTH === "true") {
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
app.post("/emit", (req, res) => {
    if (!process.env.SOCKET_API_SECRET || `Bearer ${process.env.SOCKET_API_SECRET}` === req.header("authorization")) {
        logger.log("emitting", req.body);
        const {to, event, payload} = req.body;
        if (process.env.SOCKET_ACK_ENDPOINT) {
            io.timeout(Number(process.env.SOCKET_ACK_TIMEOUT ?? 1000)).to(to).emit(event, payload, (_: Error | null, responses: any[]) => {
                logger.log("acknowledgements collected", responses);
                axios.post(process.env.SOCKET_ACK_ENDPOINT!, responses, {
                    headers: {
                        Authorization: process.env.SOCKET_API_SECRET ? `Bearer ${process.env.SOCKET_API_SECRET}` : undefined
                    }
                });
            });
        }
        else {
            io.to(to).emit(event, payload);
        }
        res.status(204).end();
    }
    else {
        logger.log("unauthenticated emit rejected");
        res.status(401).end();
    }
});

server.listen(Number(process.env.SOCKET_PORT ?? 3000), process.env.SOCKET_HOST ?? "127.0.0.1");
console.log(`Socket IO Server Version ${version} - Copyright © 2023 enymo GmbH`);