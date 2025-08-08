const express = require("express");
const cors = require("cors");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../dist/client")));

// Store WhatsApp client instance
let client = null;
let qrCodeData = null;
let isAuthenticated = false;
let isReady = false;

// Initialize WhatsApp client
function initializeWhatsApp() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
            ],
        },
    });

    client.on("qr", async (qr) => {
        console.log("QR Code received");
        qrCodeData = await qrcode.toDataURL(qr);
        isAuthenticated = false;
        isReady = false;

        // Emit QR code to connected clients
        io.emit("qr", qrCodeData);
        io.emit("status", { isAuthenticated, isReady });
    });

    client.on("authenticated", () => {
        console.log("Client authenticated");
        isAuthenticated = true;
        qrCodeData = null;
        io.emit("qr", null);
        io.emit("status", { isAuthenticated, isReady });
    });

    client.on("auth_failure", (msg) => {
        console.error("Authentication failure:", msg);
        isAuthenticated = false;
        isReady = false;
        io.emit("status", { isAuthenticated, isReady });
    });

    client.on("ready", () => {
        console.log("Client is ready!");
        isReady = true;
        qrCodeData = null;
        io.emit("qr", null);
        io.emit("status", { isAuthenticated, isReady });
    });

    client.on("message", async (msg) => {
        console.log("Message received:", msg.body);
        io.emit("message", {
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
        });
    });

    client.initialize();
}

// API Routes
app.get("/api/status", (req, res) => {
    res.json({
        isAuthenticated,
        isReady,
        qrCode: qrCodeData,
    });
});

app.post("/api/send-message", async (req, res) => {
    try {
        const { number, message } = req.body;

        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        if (!number || !message) {
            return res
                .status(400)
                .json({ error: "Number and message are required" });
        }

        const formattedNumber = number.includes("@c.us")
            ? number
            : `${number}@c.us`;
        await client.sendMessage(formattedNumber, message);

        res.json({ success: true, message: "Message sent successfully" });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});

app.get("/api/contacts", async (req, res) => {
    try {
        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        const contacts = await client.getContacts();
        const formattedContacts = contacts.map((contact) => ({
            id: contact.id._serialized,
            name: contact.name || contact.pushname || "Unknown",
            number: contact.number,
        }));

        res.json({ contacts: formattedContacts });
    } catch (error) {
        console.error("Error getting contacts:", error);
        res.status(500).json({ error: "Failed to get contacts" });
    }
});

app.get("/api/chats", async (req, res) => {
    try {
        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        const chats = await client.getChats();
        const formattedChats = chats.map((chat) => ({
            id: chat.id._serialized,
            name: chat.name || "Unknown",
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
        }));

        res.json({ chats: formattedChats });
    } catch (error) {
        console.error("Error getting chats:", error);
        res.status(500).json({ error: "Failed to get chats" });
    }
});

app.get("/api/chat-messages/:chatId", async (req, res) => {
    try {
        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        const { chatId } = req.params;
        const chat = await client.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        const messages = await chat.fetchMessages({ limit: 50 });
        const formattedMessages = messages.map((msg) => ({
            id: msg.id._serialized,
            body: msg.body,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            from: msg.from,
            to: msg.to,
        }));

        res.json({ messages: formattedMessages.reverse() });
    } catch (error) {
        console.error("Error getting chat messages:", error);
        res.status(500).json({ error: "Failed to get chat messages" });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        whatsapp: {
            isAuthenticated,
            isReady,
        },
    });
});

// Serve React app for all other routes
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../../dist/client/index.html"));
});

// Socket.IO connection handling
io.on("connection", (socket) => {
    console.log("Client connected");

    // Send current status to new client
    socket.emit("status", { isAuthenticated, isReady });
    if (qrCodeData) {
        socket.emit("qr", qrCodeData);
    }

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`WhatsApp Web Interface running on port ${PORT}`);
    console.log(`Access the application at: http://localhost:${PORT}`);

    // Initialize WhatsApp client
    initializeWhatsApp();
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("Shutting down server...");
    if (client) {
        client.destroy();
    }
    server.close(() => {
        process.exit(0);
    });
});
