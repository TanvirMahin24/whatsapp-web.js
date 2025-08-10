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
app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        credentials: true,
    })
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../dist/client")));

// Store WhatsApp client instance
let client = null;
let qrCodeData = null;
let isAuthenticated = false;
let isReady = false;

// Store pinned messages for each chat
let pinnedMessages = new Map();

// Store media gallery for each chat
let chatMedia = new Map();

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
            isGroup: contact.isGroup || false,
            isBusiness: contact.isBusiness || false,
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
        const formattedChats = await Promise.all(
            chats.map(async (chat) => {
                try {
                    // Get the latest message for this chat
                    const messages = await chat.fetchMessages({ limit: 1 });
                    const latestMessage =
                        messages.length > 0 ? messages[0] : null;

                    return {
                        id: chat.id._serialized,
                        name: chat.name || "Unknown",
                        isGroup: chat.isGroup,
                        unreadCount: chat.unreadCount,
                        lastMessage: latestMessage ? latestMessage.body : "",
                        timestamp: latestMessage
                            ? new Date(
                                  latestMessage.timestamp * 1000
                              ).toLocaleString()
                            : "",
                        hasProfilePic: false, // Will be updated separately
                    };
                } catch (error) {
                    console.error(
                        `Error fetching latest message for chat ${chat.id._serialized}:`,
                        error
                    );
                    return {
                        id: chat.id._serialized,
                        name: chat.name || "Unknown",
                        isGroup: chat.isGroup,
                        unreadCount: chat.unreadCount,
                        lastMessage: "",
                        timestamp: "",
                        hasProfilePic: false, // Will be updated separately
                    };
                }
            })
        );

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
        const { beforeId, limit } = req.query;
        console.log(
            `[API] Getting messages for chat ${chatId}, beforeId: ${beforeId}, limit: ${limit}`
        );
        const chat = await client.getChatById(chatId);

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        const pageSize = Math.min(parseInt(limit || "50", 10), 100);

        // If beforeId is provided, we need to use a different strategy
        // Fetch many more messages to ensure we get messages older than what's already loaded
        let messages;
        if (beforeId) {
            console.log(`[API] Fetching older messages before:`, beforeId);

            // Try fetching a very large number of messages to get a full conversation history
            // WhatsApp Web.js will automatically load earlier messages as needed
            const fetchSize = 500; // Fetch many messages to ensure we get older ones
            const allMessages = await chat.fetchMessages({
                limit: fetchSize,
                fromMe: undefined, // Get messages from all senders
            });
            console.log(
                `[API] Fetched ${allMessages.length} total messages for filtering`
            );
            console.log(
                `[API] First 3 message IDs:`,
                allMessages.slice(0, 3).map((m) => m.id._serialized)
            );
            console.log(
                `[API] Last 3 message IDs:`,
                allMessages.slice(-3).map((m) => m.id._serialized)
            );
            console.log(
                `[API] Message timestamps range:`,
                allMessages.length > 0
                    ? {
                          newest: allMessages[0].timestamp,
                          oldest: allMessages[allMessages.length - 1].timestamp,
                      }
                    : "no messages"
            );

            // Find the beforeId message in the fetched messages
            const beforeIndex = allMessages.findIndex(
                (msg) => msg.id._serialized === beforeId
            );
            console.log(`[API] Found beforeId at index:`, beforeIndex);

            if (beforeIndex >= 0) {
                console.log(
                    `[API] BeforeId message timestamp:`,
                    allMessages[beforeIndex].timestamp
                );
            }

            if (beforeIndex >= 0) {
                // Check if messages are actually newest-first or oldest-first by comparing timestamps
                const isNewestFirst =
                    allMessages.length > 1 &&
                    allMessages[0].timestamp >
                        allMessages[allMessages.length - 1].timestamp;

                console.log(
                    `[API] Message order detected: ${
                        isNewestFirst ? "newest-first" : "oldest-first"
                    }`
                );

                let startIndex, endIndex;
                if (isNewestFirst) {
                    // Messages are newest-first, so older messages are AFTER the beforeIndex
                    startIndex = beforeIndex + 1;
                    endIndex = Math.min(
                        startIndex + pageSize,
                        allMessages.length
                    );
                } else {
                    // Messages are oldest-first, so older messages are BEFORE the beforeIndex
                    endIndex = beforeIndex;
                    startIndex = Math.max(0, endIndex - pageSize);
                }

                // Check if there are actually older messages
                if (startIndex < endIndex && startIndex < allMessages.length) {
                    messages = allMessages.slice(startIndex, endIndex);
                    console.log(
                        `[API] Filtered to ${
                            messages.length
                        } older messages (indexes ${startIndex}-${
                            endIndex - 1
                        })`
                    );
                    console.log(
                        `[API] Sample older message IDs:`,
                        messages.slice(0, 3).map((m) => m.id._serialized)
                    );
                    console.log(
                        `[API] Sample older timestamps:`,
                        messages.slice(0, 3).map((m) => m.timestamp)
                    );
                } else {
                    console.log(`[API] No older messages available`);
                    messages = [];
                }

                // If we didn't get enough messages, try to load even more
                if (
                    messages.length < pageSize &&
                    endIndex === allMessages.length
                ) {
                    console.log(
                        `[API] Not enough older messages found, trying to load more...`
                    );
                    const moreFetchSize = 1000;
                    const moreMessages = await chat.fetchMessages({
                        limit: moreFetchSize,
                        fromMe: undefined,
                    });
                    console.log(
                        `[API] Fetched ${moreMessages.length} messages on second attempt`
                    );

                    const newBeforeIndex = moreMessages.findIndex(
                        (msg) => msg.id._serialized === beforeId
                    );

                    if (
                        newBeforeIndex >= 0 &&
                        newBeforeIndex < moreMessages.length - 1
                    ) {
                        const newStartIndex = newBeforeIndex + 1;
                        const newEndIndex = Math.min(
                            newStartIndex + pageSize,
                            moreMessages.length
                        );
                        messages = moreMessages.slice(
                            newStartIndex,
                            newEndIndex
                        );
                        console.log(
                            `[API] Second attempt: Filtered to ${
                                messages.length
                            } older messages (indexes ${newStartIndex}-${
                                newEndIndex - 1
                            })`
                        );
                    }
                }
            } else {
                console.log(
                    `[API] BeforeId not found or no older messages available`
                );
                messages = [];
            }
        } else {
            messages = await chat.fetchMessages({ limit: pageSize });
        }
        console.log(
            `[API] Fetched ${messages.length} messages, first 3 IDs:`,
            messages.slice(0, 3).map((m) => m.id._serialized)
        );
        const formattedMessages = [];
        for (const msg of messages) {
            const base = {
                id: msg.id._serialized,
                body: msg.body,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                from: msg.from,
                to: msg.to,
                hasMedia: !!msg.hasMedia,
                mediaType: msg.type,
            };
            if (msg.hasMedia && msg.type === "image") {
                try {
                    const media = await msg.downloadMedia();
                    if (media && media.data && media.mimetype) {
                        formattedMessages.push({
                            ...base,
                            mediaUrl: `data:${media.mimetype};base64,${media.data}`,
                        });
                        continue;
                    }
                } catch (e) {
                    // fallthrough to base
                }
            }
            formattedMessages.push(base);
        }

        // Return in chronological order (oldest first)
        res.json({ messages: formattedMessages.reverse() });
    } catch (error) {
        console.error("Error getting chat messages:", error);
        res.status(500).json({ error: "Failed to get chat messages" });
    }
});

// Get profile picture for a contact or chat
app.get("/api/profile-picture/:chatId", async (req, res) => {
    try {
        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        const { chatId } = req.params;
        let profilePicUrl = null;
        try {
            const chat = await client.getChatById(chatId);
            if (chat) {
                profilePicUrl = await chat.getProfilePicUrl();
            }
        } catch (e) {}

        if (!profilePicUrl) {
            try {
                const contact = await client.getContactById(chatId);
                if (contact) {
                    profilePicUrl = await contact.getProfilePicUrl();
                }
            } catch (e) {}
        }

        res.json({ profilePicUrl: profilePicUrl || null });
    } catch (error) {
        console.error("Error getting profile picture:", error);
        res.status(500).json({ error: "Failed to get profile picture" });
    }
});

// Proxy profile picture image bytes to the frontend to avoid CORS/auth issues
app.get("/api/profile-picture/:chatId/image", async (req, res) => {
    try {
        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        const { chatId } = req.params;
        let profilePicUrl = null;
        try {
            const chat = await client.getChatById(chatId);
            if (chat) profilePicUrl = await chat.getProfilePicUrl();
        } catch (e) {}
        if (!profilePicUrl) {
            try {
                const contact = await client.getContactById(chatId);
                if (contact) profilePicUrl = await contact.getProfilePicUrl();
            } catch (e) {}
        }
        if (!profilePicUrl) {
            return res.status(404).json({ error: "No profile picture" });
        }

        try {
            const response = await fetch(profilePicUrl);
            if (!response.ok) {
                return res
                    .status(502)
                    .json({ error: "Failed to fetch profile picture" });
            }
            const contentType =
                response.headers.get("content-type") || "image/jpeg";
            const buffer = Buffer.from(await response.arrayBuffer());
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutes
            return res.send(buffer);
        } catch (error) {
            console.error("Error proxying profile picture:", error);
            return res
                .status(500)
                .json({ error: "Failed to proxy profile picture" });
        }
    } catch (error) {
        console.error("Error getting profile picture (proxy):", error);
        res.status(500).json({ error: "Failed to get profile picture" });
    }
});

// Pin/Unpin a message
app.post("/api/pin-message", async (req, res) => {
    try {
        if (!isReady) {
            return res
                .status(400)
                .json({ error: "WhatsApp client is not ready" });
        }

        const { chatId, messageId, action } = req.body; // action: 'pin' or 'unpin'

        if (!chatId || !messageId || !action) {
            return res.status(400).json({
                error: "Chat ID, message ID, and action are required",
            });
        }

        if (!pinnedMessages.has(chatId)) {
            pinnedMessages.set(chatId, []);
        }

        const chatPinnedMessages = pinnedMessages.get(chatId);

        if (action === "pin") {
            // Check if message is already pinned
            if (!chatPinnedMessages.find((msg) => msg.id === messageId)) {
                // Get the message details
                const chat = await client.getChatById(chatId);
                const messages = await chat.fetchMessages({ limit: 100 });
                const message = messages.find(
                    (msg) => msg.id._serialized === messageId
                );

                if (message) {
                    const pinnedMessage = {
                        id: message.id._serialized,
                        text: message.body,
                        timestamp: message.timestamp,
                        sender: message.fromMe ? "me" : message.from,
                        fromMe: message.fromMe,
                    };
                    chatPinnedMessages.push(pinnedMessage);
                    pinnedMessages.set(chatId, chatPinnedMessages);
                }
            }
        } else if (action === "unpin") {
            const updatedPinnedMessages = chatPinnedMessages.filter(
                (msg) => msg.id !== messageId
            );
            pinnedMessages.set(chatId, updatedPinnedMessages);
        }

        res.json({
            success: true,
            pinnedMessages: pinnedMessages.get(chatId) || [],
            message: `Message ${action}ed successfully`,
        });
    } catch (error) {
        console.error("Error pinning/unpinning message:", error);
        res.status(500).json({ error: "Failed to pin/unpin message" });
    }
});

// Get pinned messages for a chat
app.get("/api/pinned-messages/:chatId", async (req, res) => {
    try {
        const { chatId } = req.params;
        const chatPinnedMessages = pinnedMessages.get(chatId) || [];
        res.json({ pinnedMessages: chatPinnedMessages });
    } catch (error) {
        console.error("Error getting pinned messages:", error);
        res.status(500).json({ error: "Failed to get pinned messages" });
    }
});

// Get media gallery for a chat
app.get("/api/chat-media/:chatId", async (req, res) => {
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

        // Get messages with media (limit to reduce payload)
        const messages = await chat.fetchMessages({ limit: 50 });
        const mediaMessages = messages.filter(
            (msg) =>
                msg.hasMedia &&
                (msg.type === "image" ||
                    msg.type === "video" ||
                    msg.type === "document")
        );

        // Build gallery with embedded data URLs for images (lightweight preview)
        const mediaGallery = [];
        for (const msg of mediaMessages) {
            const base = {
                id: msg.id._serialized,
                type: msg.type,
                timestamp: msg.timestamp,
                sender: msg.fromMe ? "me" : msg.from,
                fromMe: msg.fromMe,
                caption: msg.body || "",
                hasMedia: true,
            };

            if (msg.type === "image") {
                try {
                    const media = await msg.downloadMedia();
                    if (media && media.data && media.mimetype) {
                        mediaGallery.push({
                            ...base,
                            mediaUrl: `data:${media.mimetype};base64,${media.data}`,
                        });
                        continue;
                    }
                } catch (e) {
                    console.warn("Failed to download image media", e);
                }
            }

            // Fallback for videos/documents or failed downloads: metadata only
            mediaGallery.push(base);
            // Stop if too many items to avoid huge payloads
            if (mediaGallery.length >= 24) break;
        }

        res.json({ mediaGallery });
    } catch (error) {
        console.error("Error getting chat media:", error);
        res.status(500).json({ error: "Failed to get chat media" });
    }
});

// Mark chat as seen/read
app.post("/api/mark-chat-seen/:chatId", async (req, res) => {
    try {
        if (!isReady) {
            return res.status(503).json({ error: "WhatsApp not ready" });
        }

        const { chatId } = req.params;
        console.log(`[API] Marking chat ${chatId} as seen`);

        // Use the sendSeen method to mark the chat as read
        const result = await client.sendSeen(chatId);

        if (result) {
            console.log(`[API] Successfully marked chat ${chatId} as seen`);
            res.json({ success: true, message: "Chat marked as seen" });
        } else {
            console.warn(`[API] Failed to mark chat ${chatId} as seen`);
            res.status(500).json({ error: "Failed to mark chat as seen" });
        }
    } catch (error) {
        console.error(`[API] Error marking chat ${chatId} as seen:`, error);
        res.status(500).json({ error: "Failed to mark chat as seen" });
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
