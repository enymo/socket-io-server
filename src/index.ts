#!/usr/bin/env node
import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import Logger from "./Logger";
import { requireEnv } from "./functions";

dotenv.config();

const logger = new Logger(process.env.DEBUG === "true");

if (!process.env.API_SECRET) {
    console.log("WARNING: No API secret set. Authentication disabled.");
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
    serveClient: process.env.SERVE_CLIENT === "true",
    cors: {
        origin: process.env.CORS_ORIGINS?.split(",")
    }
});

io.use(async (socket, next) => {
    const clientLogger = logger.withId(socket.id);
    if (socket.handshake.auth.token) {
        try {
            const response = await axios.get(requireEnv("AUTH_ENDPOINT"), {
                headers: {
                    Authorization: `Bearer ${socket.handshake.auth.token}`
                }
            });
            clientLogger.log("connection authenticated", response.data);
            socket.join(response.data);
            next();
        }
        catch (e) {
            if (e instanceof AxiosError) {
                clientLogger.log("authentication failed");
                next(new Error("authentication failed"));
            }
            else {
                clientLogger.log("unknown error during authentication");
                next(new Error("unknown error"));
            }
        }
    }
    else if (process.env.ALLOW_UNAUTH === "true") {
        clientLogger.log("unauthenticated connection");
        next();
    }
    else {
        clientLogger.log("unauthenticated connection rejected");
        next(new Error("authentication required"));
    }
});

app.use(express.json());
app.post("/emit", (req, res) => {
    if (!process.env.API_SECRET || process.env.API_SECRET === req.header("authorization")) {
        logger.log("emitting", req.body);
        const {to, event, payload} = req.body;
        if (process.env.ACK_ENDPOINT) {
            io.timeout(Number(process.env.ACK_TIMEOUT ?? 1000)).to(to).emit(event, payload, (_: Error | null, responses: any[]) => {
                logger.log("acknowledgements collected", responses);
                axios.post(process.env.ACK_ENDPOINT!, responses, {
                    headers: {
                        Authorization: process.env.API_SECRET ? `Bearer ${process.env.API_SECRET}` : undefined
                    }
                });
            });
        }
        else {
            io.to(to).emit(event, payload);
        }
        res.status(202).end();
    }
    else {
        res.status(401).end();
    }
});

server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1");