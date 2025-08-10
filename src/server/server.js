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
// Increase body size limit for audio messages
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "../../dist/client")));

// Store WhatsApp client instance
let client = null;
let qrCodeData = null;
let isAuthenticated = false;
let isReady = false;
let clientState = "INITIALIZING"; // Track the actual client state

// Store pinned messages for each chat
let pinnedMessages = new Map();

// Store media gallery for each chat
let chatMedia = new Map();

// Initialize WhatsApp client
async function initializeWhatsApp() {
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
        clientState = "QR_RECEIVED"; // Set QR state

        // Emit QR code to connected clients
        io.emit("qr", qrCodeData);
        io.emit("status", { isAuthenticated, isReady, clientState });
    });

    client.on("authenticated", () => {
        console.log("Client authenticated");
        isAuthenticated = true;
        clientState = "AUTHENTICATED"; // Set initial state
        qrCodeData = null;
        io.emit("qr", null);
        io.emit("status", { isAuthenticated, isReady, clientState });
    });

    client.on("auth_failure", (msg) => {
        console.error("Authentication failure:", msg);
        isAuthenticated = false;
        isReady = false;
        clientState = "AUTH_FAILURE"; // Set failure state
        io.emit("status", { isAuthenticated, isReady, clientState });
    });

    client.on("ready", () => {
        console.log("Client is ready!");
        isReady = true;
        clientState = "READY"; // Set the state when client is ready
        qrCodeData = null;
        io.emit("qr", null);
        io.emit("status", { isAuthenticated, isReady, clientState });
    });

    client.on("disconnected", (reason) => {
        console.log("Client disconnected:", reason);
        isReady = false;
        isAuthenticated = false;
        clientState = "DISCONNECTED"; // Set disconnected state
        qrCodeData = null;
        io.emit("qr", null);
        io.emit("status", { isAuthenticated, isReady, clientState });
    });

    client.on("change_state", (state) => {
        console.log("Client state changed:", state);
        clientState = state; // Store the actual state

        // Update our local state based on the new state
        if (state === "READY") {
            isReady = true;
        } else if (state === "CONFLICT" || state === "UNLAUNCHED") {
            isReady = false;
            isAuthenticated = false;
        }

        // Log the current state for debugging
        console.log("[STATE] Current client state:", {
            state: state,
            clientState: clientState,
            isReady: isReady,
            isAuthenticated: isAuthenticated,
        });

        io.emit("status", { isAuthenticated, isReady, clientState });
    });

    client.on("loading_screen", (percent, message) => {
        console.log("Loading screen:", percent + "%", message);
        // Emit loading progress to frontend
        io.emit("loading", { percent, message });
    });

    client.on("message", async (msg) => {
        console.log("Message received:", msg.body);

        // Prepare message data
        const messageData = {
            id: msg.id._serialized,
            text: msg.body,
            timestamp: new Date(msg.timestamp * 1000).toLocaleString(),
            timestampSec: msg.timestamp,
            sender: msg.from,
            status: "delivered",
            fromMe: msg.fromMe,
            chatId: msg.from, // For individual chats, chatId is the same as sender
            hasMedia: msg.hasMedia,
            mediaType: msg.type,
            mediaUrl: null,
            mediaMimeType: null,
        };

        // If this is a group message, the chatId should be the group ID
        if (msg._data && msg._data.isGroupMsg) {
            messageData.chatId = msg._data.chat.id._serialized;
        }

        // If message has media, try to download it
        if (msg.hasMedia && msg.type === "ptt") {
            // ptt = push to talk (voice message)
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    messageData.mediaUrl = `data:${media.mimetype};base64,${media.data}`;
                    messageData.mediaMimeType = media.mimetype;
                }
            } catch (mediaError) {
                console.error(
                    "Error downloading voice message media:",
                    mediaError
                );
            }
        } else if (msg.hasMedia && msg.type === "audio") {
            try {
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    messageData.mediaUrl = `data:${media.mimetype};base64,${media.data}`;
                    messageData.mediaMimeType = media.mimetype;
                }
            } catch (mediaError) {
                console.error("Error downloading audio media:", mediaError);
            }
        }

        io.emit("message", messageData);
    });

    try {
        console.log("[INIT] Starting WhatsApp client initialization...");
        await client.initialize();
        console.log("[INIT] WhatsApp client initialization completed");

        // Set up periodic health check to monitor client state
        setInterval(() => {
            if (client && clientState) {
                console.log("[HEALTH] Client state check:", {
                    state: clientState,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                });
            }
        }, 30000); // Check every 30 seconds
    } catch (error) {
        console.error("[INIT] Failed to initialize WhatsApp client:", error);
        isReady = false;
        isAuthenticated = false;
        io.emit("status", { isAuthenticated, isReady });
    }
}

// API Routes
app.get("/api/status", (req, res) => {
    const statusInfo = {
        isAuthenticated,
        isReady,
        qrCode: qrCodeData,
        client: {
            exists: !!client,
            type: typeof client,
            state: clientState,
            hasStateProperty: client && "state" in client,
            hasGetStateMethod: client && typeof client.getState === "function",
            methods: client
                ? Object.getOwnPropertyNames(client).filter(
                      (name) => typeof client[name] === "function"
                  )
                : [],
            properties: client ? Object.keys(client) : [],
        },
    };

    console.log("[STATUS] Status request:", statusInfo);
    res.json(statusInfo);
});

app.post("/api/send-message", async (req, res) => {
    try {
        const { number, message, audioData, isVoiceMessage, mimeType } =
            req.body;

        if (!client) {
            console.error("[API] WhatsApp client is null or undefined");
            return res.status(400).json({
                error: "WhatsApp client is not initialized. Please wait for the service to start.",
                details: {
                    clientExists: false,
                    isReady: false,
                    isAuthenticated: false,
                    clientState: "N/A",
                },
            });
        }

        if (!isReady || !isAuthenticated) {
            console.error(
                "[API] WhatsApp client not ready or not authenticated:",
                {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    clientState: clientState,
                    clientType: typeof client,
                }
            );
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    clientState: clientState,
                    isAuthenticated: isAuthenticated,
                    clientType: typeof client,
                },
            });
        }

        if (!number || (!message && !audioData && !req.body.attachmentData)) {
            return res
                .status(400)
                .json({ error: "Number and message content are required" });
        }

        const formattedNumber = number.includes("@c.us")
            ? number
            : `${number}@c.us`;

        if (isVoiceMessage && audioData) {
            // Handle voice message
            console.log("[API] Sending voice message to", formattedNumber);
            console.log("[API] Audio data length:", audioData.length);
            console.log(
                "[API] Audio data preview:",
                audioData.substring(0, 100)
            );
            console.log("[API] MIME type received:", mimeType);
            console.log("[API] Request body keys:", Object.keys(req.body));

            // Check if WhatsApp client is ready and authenticated
            if (!client || !isReady || !isAuthenticated) {
                console.error(
                    "[API] WhatsApp client not ready for voice message:",
                    {
                        clientExists: !!client,
                        isReady: isReady,
                        isAuthenticated: isAuthenticated,
                        state: clientState,
                    }
                );
                return res.status(400).json({
                    error: "WhatsApp client is not ready. Please wait for authentication.",
                    details: {
                        clientExists: !!client,
                        isReady: isReady,
                        isAuthenticated: isAuthenticated,
                        state: clientState,
                    },
                });
            }

            // Additional check: ensure client is in a good state
            // Since isReady and isAuthenticated are both true, we can proceed
            // even if clientState is not explicitly set
            if (!client) {
                console.error("[API] WhatsApp client is null or undefined:", {
                    clientExists: !!client,
                    clientType: typeof client,
                    clientState: clientState,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                });

                return res.status(400).json({
                    error: "WhatsApp client is not properly initialized",
                    details: {
                        clientExists: !!client,
                        clientType: typeof client,
                        clientState: clientState,
                        isReady: isReady,
                        isAuthenticated: isAuthenticated,
                    },
                });
            }

            // If clientState is available, check if it's READY
            // Otherwise, trust the isReady flag
            if (clientState && clientState !== "READY") {
                console.error(
                    "[API] WhatsApp client not in READY state:",
                    clientState
                );
                return res.status(400).json({
                    error:
                        "WhatsApp client not in ready state. Current state: " +
                        clientState,
                    details: {
                        state: clientState,
                        isReady: isReady,
                        isAuthenticated: isAuthenticated,
                    },
                });
            }

            // If clientState is not set but client is ready and authenticated,
            // set it to READY as a fallback
            if (!clientState && isReady && isAuthenticated) {
                console.log("[API] Setting clientState to READY as fallback");
                clientState = "READY";
            }

            // Log the current state for debugging
            console.log("[API] Voice message endpoint - Current state:", {
                clientExists: !!client,
                isReady: isReady,
                isAuthenticated: isAuthenticated,
                clientState: clientState,
            });

            // Check if audio data is too large (base64 is ~33% larger than binary)
            const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
            if (audioData.length > maxSizeBytes) {
                console.error(
                    "[API] Audio data too large:",
                    audioData.length,
                    "bytes"
                );
                return res.status(413).json({
                    error: "Audio file too large. Please record a shorter message.",
                    maxSize: "10MB",
                });
            }

            try {
                // Create MessageMedia object from base64 audio data
                const { MessageMedia } = require("whatsapp-web.js");
                console.log("[API] MessageMedia imported successfully");
                console.log(
                    "[API] MessageMedia constructor:",
                    typeof MessageMedia
                );
                console.log(
                    "[API] WhatsApp Web.js version:",
                    require("whatsapp-web.js/package.json").version
                );

                // Clean up the MIME type - remove codec information and use standard formats
                let cleanMimeType = mimeType || "audio/webm";
                console.log("[API] Original MIME type:", mimeType);
                console.log("[API] MIME type includes check:", {
                    hasWebm: mimeType?.includes("webm"),
                    hasMp4: mimeType?.includes("mp4"),
                    hasM4a: mimeType?.includes("m4a"),
                    hasWav: mimeType?.includes("wav"),
                    hasOgg: mimeType?.includes("ogg"),
                    hasMp3: mimeType?.includes("mp3"),
                });

                // Remove codec information and normalize to standard MIME types
                if (cleanMimeType.includes("webm")) {
                    cleanMimeType = "audio/webm";
                } else if (
                    cleanMimeType.includes("mp4") ||
                    cleanMimeType.includes("m4a")
                ) {
                    cleanMimeType = "audio/mp4";
                } else if (cleanMimeType.includes("wav")) {
                    cleanMimeType = "audio/wav";
                } else if (cleanMimeType.includes("ogg")) {
                    cleanMimeType = "audio/ogg";
                } else if (cleanMimeType.includes("mp3")) {
                    cleanMimeType = "audio/mpeg";
                } else {
                    // Default to WebM for better compatibility
                    cleanMimeType = "audio/webm";
                }

                // Set appropriate file extension based on MIME type
                let fileExtension;
                switch (cleanMimeType) {
                    case "audio/webm":
                        fileExtension = "webm";
                        break;
                    case "audio/mp4":
                        fileExtension = "m4a";
                        break;
                    case "audio/wav":
                        fileExtension = "wav";
                        break;
                    case "audio/ogg":
                        fileExtension = "ogg";
                        break;
                    case "audio/mpeg":
                        fileExtension = "mp3";
                        break;
                    default:
                        fileExtension = "mp3"; // Default to MP3 for better compatibility
                }

                console.log("[API] File extension:", fileExtension);
                console.log("[API] Final MIME type:", cleanMimeType);

                // Ensure the base64 data is properly formatted (remove any data URL prefix)
                let cleanAudioData = audioData;
                console.log(
                    "[API] Original audio data type:",
                    typeof audioData
                );
                console.log(
                    "[API] Original audio data starts with:",
                    audioData.substring(0, 50)
                );

                if (audioData.startsWith("data:")) {
                    cleanAudioData = audioData.split(",")[1];
                    console.log(
                        "[API] Removed data URL prefix, new length:",
                        cleanAudioData.length
                    );
                }

                // Validate base64 data
                if (!cleanAudioData || cleanAudioData.length === 0) {
                    throw new Error("Invalid audio data: empty or null");
                }

                // Check if the data looks like valid base64
                if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanAudioData)) {
                    throw new Error("Invalid audio data: not valid base64");
                }

                // Check if the data is too short (likely corrupted)
                if (cleanAudioData.length < 100) {
                    throw new Error(
                        "Invalid audio data: too short, likely corrupted"
                    );
                }

                // Check if the data is too long (likely corrupted)
                if (cleanAudioData.length > 50 * 1024 * 1024) {
                    // 50MB limit
                    throw new Error(
                        "Invalid audio data: too long, likely corrupted"
                    );
                }

                // Additional validation: ensure the base64 data can be properly decoded
                try {
                    const testBuffer = Buffer.from(cleanAudioData, "base64");
                    if (testBuffer.length === 0) {
                        throw new Error(
                            "Invalid audio data: base64 decoding results in empty buffer"
                        );
                    }
                    console.log(
                        "[API] Base64 validation passed - decoded buffer length:",
                        testBuffer.length
                    );
                } catch (decodeError) {
                    console.error(
                        "[API] Base64 decode test failed:",
                        decodeError.message
                    );
                    throw new Error(
                        `Invalid audio data: base64 decoding failed - ${decodeError.message}`
                    );
                }

                // Try to optimize the audio data for better compatibility
                let optimizedAudioData = cleanAudioData;
                let optimizedMimeType = cleanMimeType;

                // If the audio data is very large, try to optimize it
                if (cleanAudioData.length > 5 * 1024 * 1024) {
                    // 5MB
                    console.log(
                        "[API] Audio data is large, attempting optimization..."
                    );

                    try {
                        // For WebM files, try to use a more compatible format
                        if (cleanMimeType === "audio/webm") {
                            // WebM can sometimes cause issues, try MP4 instead
                            optimizedMimeType = "audio/mp4";
                            console.log(
                                "[API] Optimized MIME type from WebM to MP4 for better compatibility"
                            );
                        }

                        // If still too large, try to suggest compression
                        if (cleanAudioData.length > 10 * 1024 * 1024) {
                            // 10MB
                            console.log(
                                "[API] Audio data is very large, suggesting compression"
                            );
                            // Note: We can't compress here, but we can log a warning
                        }
                    } catch (optimizeError) {
                        console.log(
                            "[API] Audio optimization failed, using original data:",
                            optimizeError.message
                        );
                        // Continue with original data if optimization fails
                    }
                }

                console.log("[API] Audio data validation passed");
                console.log(
                    "[API] Audio data starts with:",
                    cleanAudioData.substring(0, 50)
                );
                console.log(
                    "[API] Audio data length after cleaning:",
                    cleanAudioData.length
                );
                console.log(
                    "[API] Base64 validation regex test result:",
                    /^[A-Za-z0-9+/]*={0,2}$/.test(cleanAudioData)
                );

                // Create MessageMedia with the cleaned MIME type
                console.log("[API] Creating MessageMedia with:");
                console.log("[API] - MIME type:", optimizedMimeType);
                console.log("[API] - File extension:", fileExtension);
                console.log(
                    "[API] - Audio data length:",
                    optimizedAudioData.length
                );

                let media;
                try {
                    media = new MessageMedia(
                        optimizedMimeType,
                        optimizedAudioData,
                        `voice-message.${fileExtension}`
                    );

                    console.log("[API] MessageMedia created successfully");
                    console.log("[API] MessageMedia object:", typeof media);
                    console.log(
                        "[API] MessageMedia properties:",
                        Object.keys(media)
                    );

                    // Validate the created media object
                    if (!media || typeof media !== "object") {
                        throw new Error(
                            "MessageMedia creation failed - invalid object returned"
                        );
                    }

                    if (!media.data || !media.mimetype) {
                        throw new Error(
                            "MessageMedia creation failed - missing required properties"
                        );
                    }

                    console.log("[API] MessageMedia validation passed");
                } catch (mediaCreationError) {
                    console.error(
                        "[API] Error creating MessageMedia:",
                        mediaCreationError
                    );

                    // Try to create with fallback MIME type
                    try {
                        console.log(
                            "[API] Attempting fallback MessageMedia creation with audio/mpeg..."
                        );
                        media = new MessageMedia(
                            "audio/mpeg",
                            optimizedAudioData,
                            "voice-message.mp3"
                        );
                        console.log(
                            "[API] Fallback MessageMedia created successfully"
                        );
                    } catch (fallbackMediaError) {
                        console.error(
                            "[API] Fallback MessageMedia creation also failed:",
                            fallbackMediaError
                        );
                        throw new Error(
                            `Failed to create MessageMedia: ${mediaCreationError.message}. Fallback also failed: ${fallbackMediaError.message}`
                        );
                    }
                }

                // Try different approaches to send the voice message
                let sent = false;
                let lastError = null;

                // Create a timeout promise to prevent hanging
                let timeoutId;
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(
                            new Error(
                                "Voice message sending timed out after 30 seconds"
                            )
                        );
                    }, 30000); // 30 second timeout
                });

                // Helper function to clear timeout
                const clearTimeoutId = () => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                };

                try {
                    // Method 1: Try sending as regular audio with voice message options
                    try {
                        console.log(
                            "[API] Attempting to send as voice message..."
                        );
                        console.log("[API] Target number:", formattedNumber);
                        console.log("[API] Media object type:", typeof media);
                        console.log(
                            "[API] Media object keys:",
                            Object.keys(media)
                        );
                        console.log("[API] Client ready state:", isReady);
                        console.log(
                            "[API] Client authenticated:",
                            isAuthenticated
                        );

                        // Try to send as a voice message with proper options
                        const messageOptions = {
                            sendAudioAsVoice: true,
                            // Add additional options to help with voice message detection
                            mimetype: optimizedMimeType,
                            filename: `voice-message.${fileExtension}`,
                            // Try to set voice message properties
                            voiceMessage: true,
                            ptt: true, // Push-to-talk flag
                        };

                        console.log("[API] Message options:", messageOptions);

                        // Race between sending and timeout
                        await Promise.race([
                            client.sendMessage(
                                formattedNumber,
                                media,
                                messageOptions
                            ),
                            timeoutPromise,
                        ]);

                        // Clear timeout since we succeeded
                        clearTimeoutId();

                        console.log(
                            "[API] Voice message sent successfully with voice options"
                        );
                        sent = true;
                    } catch (voiceError) {
                        console.log(
                            "[API] Voice message send failed:",
                            voiceError.message
                        );
                        console.log(
                            "[API] Voice error stack:",
                            voiceError.stack
                        );
                        console.log("[API] Voice error name:", voiceError.name);
                        lastError = voiceError;

                        // Method 2: Try sending as regular audio without voice options
                        try {
                            console.log(
                                "[API] Attempting to send as regular audio..."
                            );
                            await Promise.race([
                                client.sendMessage(formattedNumber, media),
                                timeoutPromise,
                            ]);
                            console.log(
                                "[API] Voice message sent successfully as regular audio"
                            );
                            sent = true;
                        } catch (audioError) {
                            console.log(
                                "[API] Regular audio send failed:",
                                audioError.message
                            );
                            console.log(
                                "[API] Audio error stack:",
                                audioError.stack
                            );
                            console.log(
                                "[API] Audio error name:",
                                audioError.name
                            );
                            lastError = audioError;

                            // Method 3: Try sending as document
                            try {
                                console.log(
                                    "[API] Attempting to send as document..."
                                );
                                console.log(
                                    "[API] Creating document media with clean audio data"
                                );
                                const documentMedia = new MessageMedia(
                                    "application/octet-stream",
                                    optimizedAudioData,
                                    `voice-message.${fileExtension}`
                                );

                                await Promise.race([
                                    client.sendMessage(
                                        formattedNumber,
                                        documentMedia
                                    ),
                                    timeoutPromise,
                                ]);
                                console.log(
                                    "[API] Voice message sent as document successfully"
                                );
                                sent = true;
                            } catch (documentError) {
                                console.log(
                                    "[API] Document send failed:",
                                    documentError.message
                                );
                                console.log(
                                    "[API] Document error stack:",
                                    documentError.stack
                                );
                                lastError = documentError;

                                // Method 4: Try with different MIME type
                                try {
                                    console.log(
                                        "[API] Attempting with fallback MIME type..."
                                    );
                                    console.log(
                                        "[API] Creating fallback media with MP3 MIME type"
                                    );
                                    const fallbackMedia = new MessageMedia(
                                        "audio/mpeg",
                                        optimizedAudioData,
                                        "voice-message.mp3"
                                    );

                                    await Promise.race([
                                        client.sendMessage(
                                            formattedNumber,
                                            fallbackMedia
                                        ),
                                        timeoutPromise,
                                    ]);
                                    console.log(
                                        "[API] Voice message sent with fallback MIME type"
                                    );
                                    sent = true;
                                } catch (fallbackError) {
                                    console.log(
                                        "[API] Fallback send failed:",
                                        fallbackError.message
                                    );
                                    console.log(
                                        "[API] Fallback error stack:",
                                        fallbackError.stack
                                    );
                                    lastError = fallbackError;

                                    // Method 5: Try with base64 data directly
                                    try {
                                        console.log(
                                            "[API] Attempting with base64 data..."
                                        );
                                        const base64Media = new MessageMedia(
                                            "text/plain",
                                            Buffer.from(
                                                optimizedAudioData,
                                                "base64"
                                            ).toString("base64"),
                                            "voice-message.txt"
                                        );

                                        await Promise.race([
                                            client.sendMessage(
                                                formattedNumber,
                                                base64Media
                                            ),
                                            timeoutPromise,
                                        ]);
                                        console.log(
                                            "[API] Voice message sent as base64 text"
                                        );
                                        sent = true;
                                    } catch (base64Error) {
                                        console.log(
                                            "[API] Base64 send failed:",
                                            base64Error.message
                                        );
                                        lastError = base64Error;

                                        // Method 6: Final fallback - send text message about failure
                                        try {
                                            console.log(
                                                "[API] Attempting final fallback - sending failure notification..."
                                            );
                                            const failureMessage = `🎤 Voice message could not be sent. Please try recording a shorter message or check your connection.`;

                                            await Promise.race([
                                                client.sendMessage(
                                                    formattedNumber,
                                                    failureMessage
                                                ),
                                                timeoutPromise,
                                            ]);
                                            console.log(
                                                "[API] Failure notification sent successfully"
                                            );

                                            // Return success but with a note about the fallback
                                            return res.json({
                                                success: true,
                                                message:
                                                    "Voice message could not be sent as audio, but failure notification was delivered",
                                                method: "fallback notification",
                                                warning:
                                                    "The voice message could not be sent as audio. Please try recording a shorter message.",
                                                details: {
                                                    originalError:
                                                        lastError?.message,
                                                    mimeType: optimizedMimeType,
                                                    dataLength:
                                                        optimizedAudioData.length,
                                                },
                                            });
                                        } catch (finalError) {
                                            console.log(
                                                "[API] Final fallback also failed:",
                                                finalError.message
                                            );
                                            lastError = finalError;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (sent) {
                        res.json({
                            success: true,
                            message: "Voice message sent successfully",
                            method: "voice message",
                        });
                        return;
                    } else {
                        // All methods failed - provide detailed error information
                        console.error(
                            "[API] All voice message sending methods failed. Final analysis:"
                        );
                        console.error("[API] MIME type:", cleanMimeType);
                        console.error("[API] File extension:", fileExtension);
                        console.error(
                            "[API] Audio data length:",
                            cleanAudioData.length
                        );
                        console.error(
                            "[API] Audio data preview:",
                            cleanAudioData.substring(0, 100)
                        );
                        console.error("[API] Client ready state:", isReady);
                        console.error(
                            "[API] Client authenticated:",
                            isAuthenticated
                        );
                        console.error("[API] Client info:", {
                            isReady: isReady,
                            isAuthenticated: isAuthenticated,
                            state: clientState,
                        });
                        console.error(
                            "[API] Last error encountered:",
                            lastError
                        );

                        // Return a more helpful error response
                        const errorMessage = lastError
                            ? `Failed to send voice message: ${lastError.message}`
                            : "Failed to send voice message: All sending methods failed";

                        const suggestions = [
                            "Check if the audio format is supported by WhatsApp",
                            "Try recording a shorter message (under 1 minute)",
                            "Ensure the audio file is not corrupted",
                            "Check WhatsApp Web connection status",
                        ];

                        return res.status(500).json({
                            success: false,
                            error: errorMessage,
                            suggestions: suggestions,
                            details: {
                                mimeType: cleanMimeType,
                                fileExtension: fileExtension,
                                dataLength: cleanAudioData.length,
                                clientReady: isReady,
                                clientAuthenticated: isAuthenticated,
                                lastError: lastError
                                    ? {
                                          message: lastError.message,
                                          name: lastError.name,
                                          stack: lastError.stack,
                                      }
                                    : null,
                            },
                        });
                    }
                } catch (mediaError) {
                    console.error(
                        "[API] Error creating MessageMedia:",
                        mediaError
                    );
                    console.error("[API] Error name:", mediaError.name);
                    console.error("[API] Error stack:", mediaError.stack);
                    console.error("[API] Audio data type:", typeof audioData);
                    console.error("[API] Audio data length:", audioData.length);
                    console.error("[API] Client state:", {
                        isReady: isReady,
                        isAuthenticated: isAuthenticated,
                        state: clientState,
                    });

                    // If MessageMedia creation fails, it's likely a format issue
                    res.status(500).json({
                        error: "Failed to create audio message. The audio format may not be supported.",
                        details: mediaError.message,
                        suggestions: [
                            "Try recording a shorter message",
                            "Ensure the audio format is WebM, MP4, WAV, or OGG",
                            "Check if WhatsApp Web is up to date",
                        ],
                    });
                } finally {
                    // Always clear the timeout to prevent memory leaks
                    clearTimeoutId();
                }
            } catch (error) {
                console.error("Error sending message:", error);
                res.status(500).json({ error: "Failed to send message" });
            }
        } else if (req.body.attachmentData && req.body.attachmentType) {
            // Handle file attachment
            const { attachmentData, attachmentType, attachmentName, caption } =
                req.body;

            console.log("[API] Sending file attachment to", formattedNumber);
            console.log("[API] Attachment type:", attachmentType);
            console.log("[API] Attachment name:", attachmentName);
            console.log("[API] Caption:", caption);
            console.log("[API] Data length:", attachmentData.length);

            try {
                // Create MessageMedia object from base64 attachment data
                const { MessageMedia } = require("whatsapp-web.js");

                // Clean up the base64 data (remove any data URL prefix)
                let cleanAttachmentData = attachmentData;
                if (attachmentData.startsWith("data:")) {
                    cleanAttachmentData = attachmentData.split(",")[1];
                }

                // Validate base64 data
                if (!cleanAttachmentData || cleanAttachmentData.length === 0) {
                    throw new Error("Invalid attachment data: empty or null");
                }

                // Check if the data looks like valid base64
                if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanAttachmentData)) {
                    throw new Error(
                        "Invalid attachment data: not valid base64"
                    );
                }

                // Create MessageMedia with the attachment data
                const media = new MessageMedia(
                    attachmentType,
                    cleanAttachmentData,
                    attachmentName || "attachment"
                );

                console.log(
                    "[API] MessageMedia created successfully for attachment"
                );

                // Send the attachment with optional caption
                if (caption) {
                    await client.sendMessage(formattedNumber, media, {
                        caption,
                    });
                } else {
                    await client.sendMessage(formattedNumber, media);
                }

                res.json({
                    success: true,
                    message: "File attachment sent successfully",
                    type: attachmentType,
                    name: attachmentName,
                });
            } catch (attachmentError) {
                console.error(
                    "[API] Error sending attachment:",
                    attachmentError
                );
                res.status(500).json({
                    error: "Failed to send attachment",
                    details: attachmentError.message,
                    suggestions: [
                        "Check if the file format is supported by WhatsApp",
                        "Ensure the file is not corrupted",
                        "Try with a smaller file size",
                        "Check WhatsApp Web connection status",
                    ],
                });
            }
        } else {
            // Handle regular text message
            await client.sendMessage(formattedNumber, message);
            res.json({ success: true, message: "Message sent successfully" });
        }
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});

app.get("/api/contacts", async (req, res) => {
    try {
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(400).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
        if (!isReady || !isAuthenticated) {
            return res.status(503).json({
                error: "WhatsApp client is not ready. Please wait for authentication.",
                details: {
                    clientExists: !!client,
                    isReady: isReady,
                    isAuthenticated: isAuthenticated,
                    state: clientState,
                },
            });
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
            clientState: clientState,
            clientExists: !!client,
        },
    });
});

// Test client endpoint
app.get("/api/test-client", async (req, res) => {
    try {
        if (!client) {
            return res.status(400).json({
                error: "Client not initialized",
                details: { clientExists: false },
            });
        }

        const clientInfo = {
            type: typeof client,
            hasState: "state" in client,
            state: clientState,
            hasGetState: typeof client.getState === "function",
            methods: Object.getOwnPropertyNames(client).filter(
                (name) => typeof client[name] === "function"
            ),
            properties: Object.keys(client),
        };

        res.json({
            success: true,
            clientInfo,
            isReady,
            isAuthenticated,
        });
    } catch (error) {
        res.status(500).json({
            error: "Error testing client",
            details: error.message,
        });
    }
});

// Serve React app for all other routes
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../../dist/client/index.html"));
});

// Socket.IO connection handling
io.on("connection", (socket) => {
    console.log("Client connected");

    // Send current status to new client
    socket.emit("status", { isAuthenticated, isReady, clientState });
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
    initializeWhatsApp().catch((error) => {
        console.error("Failed to initialize WhatsApp client:", error);
    });
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
